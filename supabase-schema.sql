create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null check (role in ('artist', 'customer')),
  specialty text not null default '',
  description text not null default '',
  "socialLink" text not null default '',
  "profileViews" integer not null default 0 check ("profileViews" >= 0),
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table public.profiles_private (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null
);

create table public.artworks (
  id text primary key,
  "artistId" uuid not null references public.profiles(id) on delete cascade,
  artist text not null,
  title text not null check (length(title) between 1 and 180),
  detail text not null default '',
  price numeric(12, 2) not null check (price > 0),
  category text not null,
  image text not null,
  "createdAt" timestamptz not null default now()
);

create table public."artistRates" (
  id uuid primary key default gen_random_uuid(),
  "artistId" uuid not null references public.profiles(id) on delete cascade,
  type text not null check (length(type) between 1 and 60),
  description text not null default '' check (length(description) <= 400),
  price numeric(12, 2) not null check (price between 1 and 10000000),
  "createdAt" timestamptz not null default now()
);

create table public.commissions (
  id text primary key,
  "artistId" uuid not null references public.profiles(id),
  "clientId" uuid not null references public.profiles(id),
  "artistName" text not null,
  "clientName" text not null,
  title text not null,
  description text not null default '',
  "referenceImage" text not null default '',
  status text not null default 'pending' check (status in ('pending', 'active', 'done', 'declined')),
  "currentStage" smallint not null default 0 check ("currentStage" between 0 and 4),
  "stageStatus" jsonb not null default '[false,false,false,false,false]'::jsonb,
  "clientApproval" jsonb not null default '[false,false,false,false,false]'::jsonb,
  "stageData" jsonb not null default '[{"uploads":[],"note":null,"comments":[]},{"uploads":[],"note":null,"comments":[]},{"uploads":[],"note":null,"comments":[]},{"uploads":[],"note":null,"comments":[]},{"uploads":[],"note":null,"comments":[]}]'::jsonb,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  check ("artistId" <> "clientId"),
  check (jsonb_typeof("stageStatus") = 'array' and jsonb_array_length("stageStatus") = 5),
  check (jsonb_typeof("clientApproval") = 'array' and jsonb_array_length("clientApproval") = 5),
  check (jsonb_typeof("stageData") = 'array' and jsonb_array_length("stageData") = 5)
);

create table public.commission_messages (
  id uuid primary key default gen_random_uuid(),
  "commissionId" text not null references public.commissions(id) on delete cascade,
  "senderId" uuid not null references public.profiles(id),
  "senderName" text not null,
  "senderRole" text not null check ("senderRole" in ('artist', 'customer')),
  message text not null check (length(message) > 0),
  "isRead" boolean not null default false,
  "createdAt" timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  "userId" uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  "commissionId" text references public.commissions(id) on delete cascade,
  text text not null,
  "isRead" boolean not null default false,
  "createdAt" timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'commission_messages'
  ) then
    alter publication supabase_realtime add table public.commission_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'commissions'
  ) then
    alter publication supabase_realtime add table public.commissions;
  end if;
end;
$$;

create or replace function public.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, role, specialty)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    case when new.raw_user_meta_data ->> 'role' = 'artist' then 'artist' else 'customer' end,
    coalesce(new.raw_user_meta_data ->> 'specialty', '')
  );
  insert into public.profiles_private (id, email) values (new.id, coalesce(new.email, ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.create_profile_for_auth_user();

create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    perform set_config('app.sync_profile_email', 'true', true);
    update public.profiles_private set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.sync_profile_email();

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.role <> old.role
    or (new."profileViews" <> old."profileViews"
      and current_setting('app.allow_profile_views', true) is distinct from 'true') then
    raise exception 'Protected profile fields cannot be changed directly';
  end if;
  new."updatedAt" := now();
  return new;
end;
$$;

create trigger protect_profile_fields_before_update
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

create or replace function public.increment_artist_views(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.allow_profile_views', 'true', true);
  update public.profiles
  set "profileViews" = "profileViews" + 1
  where id = target_id and role = 'artist';
end;
$$;

grant execute on function public.increment_artist_views(uuid) to anon, authenticated;

create or replace function public.protect_commission_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  stage_index integer;
  revision_count integer := 0;
begin
  if actor = old."artistId" then
    if new."artistId" <> old."artistId" or new."clientId" <> old."clientId"
      or new."artistName" <> old."artistName" or new."clientName" <> old."clientName"
      or new.title <> old.title or new.description <> old.description
      or new."referenceImage" <> old."referenceImage"
      or new."clientApproval" <> old."clientApproval"
      or new."currentStage" <> old."currentStage"
      or new."createdAt" <> old."createdAt" then
      raise exception 'Artist cannot change commission ownership or client approval';
    end if;
    if new.status <> old.status and (old.status <> 'pending' or new.status not in ('active', 'declined')) then
      raise exception 'Invalid artist commission status transition';
    end if;
    for stage_index in 0..4 loop
      if old."stageStatus" -> stage_index = 'true'::jsonb
        and new."stageStatus" -> stage_index <> 'true'::jsonb then
        raise exception 'Submitted stages cannot be unset';
      end if;
      if old."clientApproval" -> stage_index = 'true'::jsonb
        and new."stageData" -> stage_index <> old."stageData" -> stage_index then
        raise exception 'Approved stage data cannot be changed';
      end if;
    end loop;
  elsif actor = old."clientId" then
    if new."artistId" <> old."artistId" or new."clientId" <> old."clientId"
      or new."artistName" <> old."artistName" or new."clientName" <> old."clientName"
      or new.title <> old.title or new.description <> old.description
      or new."referenceImage" <> old."referenceImage" or new."stageData" <> old."stageData"
      or new."createdAt" <> old."createdAt" then
      raise exception 'Client cannot change commission request or artist work';
    end if;
    for stage_index in 0..4 loop
      if (new."stageStatus" -> stage_index) is distinct from (old."stageStatus" -> stage_index) then
        revision_count := revision_count + 1;
        if stage_index <> old."currentStage"
          or old."stageStatus" -> stage_index <> 'true'::jsonb
          or new."stageStatus" -> stage_index <> 'false'::jsonb
          or old."clientApproval" -> stage_index = 'true'::jsonb then
          raise exception 'Clients can only request a revision for the current unapproved submitted stage';
        end if;
      end if;
      if old."clientApproval" -> stage_index = 'true'::jsonb
        and new."clientApproval" -> stage_index <> 'true'::jsonb then
        raise exception 'Stage approvals cannot be revoked';
      end if;
      if new."clientApproval" -> stage_index = 'true'::jsonb
        and old."clientApproval" -> stage_index <> 'true'::jsonb
        and old."stageStatus" -> stage_index <> 'true'::jsonb then
        raise exception 'Only submitted stages can be approved';
      end if;
    end loop;
    if revision_count > 0 and (revision_count <> 1
      or new."clientApproval" <> old."clientApproval"
      or new."currentStage" <> old."currentStage"
      or new.status <> old.status) then
      raise exception 'A revision request can only reset one submitted stage';
    end if;
    if new."currentStage" < old."currentStage" or new."currentStage" > old."currentStage" + 1
      or new."currentStage" > 4 then
      raise exception 'Invalid commission stage transition';
    end if;
    if new."currentStage" > old."currentStage"
      and new."clientApproval" -> old."currentStage" <> 'true'::jsonb then
      raise exception 'Approve the current stage before advancing';
    end if;
    if new.status <> old.status and (old.status <> 'active' or new.status <> 'done') then
      raise exception 'Invalid client commission status transition';
    end if;
    if new.status = 'done' and new."clientApproval" <> '[true,true,true,true,true]'::jsonb then
      raise exception 'Every stage must be approved before completion';
    end if;
  else
    raise exception 'Only commission participants can update this commission';
  end if;
  new."updatedAt" := now();
  return new;
end;
$$;

create trigger protect_commission_update_before_update
  before update on public.commissions
  for each row execute function public.protect_commission_update();

create or replace function public.protect_message_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new."commissionId" <> old."commissionId"
    or new."senderId" <> old."senderId" or new."senderName" <> old."senderName"
    or new."senderRole" <> old."senderRole" or new.message <> old.message
    or new."createdAt" <> old."createdAt" or old."isRead" or not new."isRead"
    or auth.uid() = old."senderId" then
    raise exception 'Only message recipients may mark a message read';
  end if;
  return new;
end;
$$;

create trigger protect_message_update_before_update
  before update on public.commission_messages
  for each row execute function public.protect_message_update();

create or replace function public.protect_message_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  sender public.profiles%rowtype;
begin
  select * into sender from public.profiles where id = auth.uid();
  if new."senderId" <> auth.uid() or new."senderRole" <> sender.role
    or new."senderName" <> sender.name or new."isRead" then
    raise exception 'Message sender fields must match the signed-in profile';
  end if;
  return new;
end;
$$;

create trigger protect_message_insert_before_insert
  before insert on public.commission_messages
  for each row execute function public.protect_message_insert();

create or replace function public.protect_notification_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new."userId" <> old."userId" or new.type <> old.type
    or new."commissionId" is distinct from old."commissionId" or new.text <> old.text
    or new."createdAt" <> old."createdAt" or old."isRead" or not new."isRead" then
    raise exception 'Notifications can only be marked read';
  end if;
  return new;
end;
$$;

create trigger protect_notification_update_before_update
  before update on public.notifications
  for each row execute function public.protect_notification_update();

alter table public.profiles enable row level security;
alter table public.profiles_private enable row level security;
alter table public.artworks enable row level security;
alter table public."artistRates" enable row level security;
alter table public.commissions enable row level security;
alter table public.commission_messages enable row level security;
alter table public.notifications enable row level security;

create policy "Artists and owners can read profiles" on public.profiles
  for select to anon, authenticated using (role = 'artist' or id = (select auth.uid()));
create policy "Users can read their private profile" on public.profiles_private
  for select to authenticated using (id = (select auth.uid()));
create policy "Users can update their own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "Anyone can read artworks" on public.artworks
  for select to anon, authenticated using (true);
create policy "Artists can create their own artworks" on public.artworks
  for insert to authenticated with check (
    "artistId" = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'artist')
  );
create policy "Artists can update their own artworks" on public.artworks
  for update to authenticated using ("artistId" = (select auth.uid()))
  with check ("artistId" = (select auth.uid()));
create policy "Artists can delete their own artworks" on public.artworks
  for delete to authenticated using ("artistId" = (select auth.uid()));

create policy "Anyone can read artist rates" on public."artistRates"
  for select to anon, authenticated using (true);
create policy "Artists can manage their own rates" on public."artistRates"
  for all to authenticated using ("artistId" = (select auth.uid()))
  with check (
    "artistId" = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'artist')
  );

create policy "Participants can read commissions" on public.commissions
  for select to authenticated using ((select auth.uid()) in ("artistId", "clientId"));
create policy "Customers can create commission requests" on public.commissions
  for insert to authenticated with check (
    "clientId" = (select auth.uid())
    and status = 'pending'
    and "currentStage" = 0
    and exists (select 1 from public.profiles p where p.id = "artistId" and p.role = 'artist')
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'customer')
  );
create policy "Participants can update commissions" on public.commissions
  for update to authenticated using ((select auth.uid()) in ("artistId", "clientId"))
  with check ((select auth.uid()) in ("artistId", "clientId"));

create policy "Participants can read commission messages" on public.commission_messages
  for select to authenticated using (
    exists (select 1 from public.commissions c where c.id = "commissionId"
      and (select auth.uid()) in (c."artistId", c."clientId"))
  );
create policy "Participants can send commission messages" on public.commission_messages
  for insert to authenticated with check (
    "senderId" = (select auth.uid())
    and exists (select 1 from public.commissions c where c.id = "commissionId"
      and (select auth.uid()) in (c."artistId", c."clientId"))
  );
create policy "Recipients can mark commission messages read" on public.commission_messages
  for update to authenticated using (
    "senderId" <> (select auth.uid())
    and exists (select 1 from public.commissions c where c.id = "commissionId"
      and (select auth.uid()) in (c."artistId", c."clientId"))
  ) with check ("senderId" <> (select auth.uid()));

create policy "Users can read their notifications" on public.notifications
  for select to authenticated using ("userId" = (select auth.uid()));
create policy "Commission participants can create notifications" on public.notifications
  for insert to authenticated with check (
    exists (select 1 from public.commissions c where c.id = "commissionId"
      and (select auth.uid()) in (c."artistId", c."clientId")
      and "userId" in (c."artistId", c."clientId"))
  );
create policy "Users can mark their notifications read" on public.notifications
  for update to authenticated using ("userId" = (select auth.uid()))
  with check ("userId" = (select auth.uid()));