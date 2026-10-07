import { supabase } from './supabase-config.js';

const sessionKey = 'vicom-session';

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fail(error, status = 400) {
  throw Object.assign(new Error(error?.message || String(error)), { status });
}

function unwrap(result) {
  if (result.error) fail(result.error);
  return result.data;
}

async function currentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) fail('Sign in to continue.', 401);
  return data.user;
}

async function currentProfile() {
  const user = await currentUser();
  const profile = unwrap(await supabase.from('profiles').select('*').eq('id', user.id).single());
  return { user, profile };
}

function currency(value) {
  return `₱${Number(value || 0).toFixed(2)}`;
}

async function loadArtworks() {
  const rows = unwrap(await supabase.from('artworks').select('*').order('createdAt', { ascending: false }));
  const artistIds = [...new Set(rows.map((row) => row.artistId))];
  const artists = artistIds.length
    ? unwrap(await supabase.from('profiles').select('id,name').in('id', artistIds))
    : [];
  const names = new Map(artists.map((artist) => [artist.id, artist.name]));
  return rows.map((row) => ({ ...row, artist: row.artist || names.get(row.artistId) || 'Artist', price: currency(row.price) }));
}

async function loadArtist(artistId) {
  const artist = unwrap(await supabase.from('profiles').select('*').eq('id', artistId).eq('role', 'artist').single());
  const [artworks, rates] = await Promise.all([
    supabase.from('artworks').select('*').eq('artistId', artistId).order('createdAt', { ascending: false }),
    supabase.from('artistRates').select('*').eq('artistId', artistId).order('createdAt', { ascending: true }),
  ]);
  return {
    artist,
    artworks: unwrap(artworks).map((work) => ({ ...work, price: currency(work.price) })),
    rates: unwrap(rates),
  };
}

async function loadCommissions(role) {
  const { user, profile } = await currentProfile();
  const column = role === 'artist' ? 'artistId' : 'clientId';
  if (profile.role !== role && !(role === 'customer' && profile.role === 'customer')) fail('You cannot access these commissions.', 403);
  const rows = unwrap(await supabase.from('commissions').select('*').eq(column, user.id).order('updatedAt', { ascending: false }));
  const order = { pending: 0, active: 1, done: 2, declined: 3 };
  return rows.sort((left, right) => order[left.status] - order[right.status]);
}

async function createNotification(notification) {
  if (!notification?.userId || !notification?.type || !notification?.text) return;
  unwrap(await supabase.from('notifications').insert({
    userId: notification.userId,
    type: notification.type,
    commissionId: notification.commissionId || null,
    text: notification.text,
  }));
}

async function dispatch(action, params, body) {
  if (action === 'register') {
    const { email, password, name, role, specialty = '' } = body;
    const result = unwrap(await supabase.auth.signUp({
      email,
      password,
      options: { data: { name, role: role === 'artist' ? 'artist' : 'customer', specialty } },
    }));
    return { user: { id: result.user.id, email, name, role, specialty, emailVerificationSent: !result.session } };
  }

  if (action === 'login') {
    const { email, password } = body;
    const result = unwrap(await supabase.auth.signInWithPassword({ email, password }));
    const profile = unwrap(await supabase.from('profiles').select('*').eq('id', result.user.id).single());
    return { user: { ...profile, email: result.user.email } };
  }

  if (action === 'artworks') return { artworks: await loadArtworks() };

  if (action === 'create_artwork') {
    const { user, profile } = await currentProfile();
    if (profile.role !== 'artist') fail('Only artist accounts can publish artwork.', 403);
    unwrap(await supabase.from('artworks').insert({ ...body, artistId: user.id }));
    return { status: 'created' };
  }

  if (action === 'artist') {
    const artistId = params.get('id');
    if (!artistId) fail('Artist id is required.', 422);
    unwrap(await supabase.rpc('increment_artist_views', { target_id: artistId }));
    return loadArtist(artistId);
  }

  if (action === 'artist_stats') {
    const artist = unwrap(await supabase.from('profiles').select('profileViews').eq('id', params.get('id')).eq('role', 'artist').single());
    return artist;
  }

  if (action === 'profile') {
    const { user } = await currentProfile();
    const id = params.get('id');
    if (id !== user.id) fail('You can only read your own profile here.', 403);
    return { user: { ...unwrap(await supabase.from('profiles').select('*').eq('id', id).single()), email: user.email } };
  }

  if (action === 'update_profile') {
    const { user } = await currentProfile();
    const updates = {};
    for (const key of ['name', 'specialty', 'description', 'socialLink']) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    const authUpdates = {};
    if (body.email && body.email !== user.email) authUpdates.email = body.email;
    if (body.password) authUpdates.password = body.password;
    let email = user.email;
    if (Object.keys(authUpdates).length) {
      const updatedAuth = unwrap(await supabase.auth.updateUser(authUpdates));
      email = updatedAuth.user.email;
    }
    const profile = Object.keys(updates).length
      ? unwrap(await supabase.from('profiles').update(updates).eq('id', user.id).select('*').single())
      : unwrap(await supabase.from('profiles').select('*').eq('id', user.id).single());
    return { user: { ...profile, email } };
  }

  if (action === 'artist_rates') {
    const result = unwrap(await supabase.from('artistRates').select('*').eq('artistId', params.get('id')).order('createdAt'));
    return { rates: result };
  }

  if (action === 'save_artist_rate') {
    const { user, profile } = await currentProfile();
    if (profile.role !== 'artist') fail('Only artists can manage rates.', 403);
    const values = { type: body.type, description: body.description || '', price: Number(body.price) };
    const result = body.id
      ? await supabase.from('artistRates').update(values).eq('id', body.id).eq('artistId', user.id).select('*').single()
      : await supabase.from('artistRates').insert({ ...values, artistId: user.id }).select('*').single();
    return { rate: unwrap(result) };
  }

  if (action === 'delete_artist_rate') {
    const { user } = await currentProfile();
    unwrap(await supabase.from('artistRates').delete().eq('id', body.id).eq('artistId', user.id));
    return { status: 'deleted' };
  }

  if (action === 'create_commission') {
    const { user, profile } = await currentProfile();
    if (profile.role !== 'customer') fail('Sign in as a customer to request a commission.', 403);
    const artist = unwrap(await supabase.from('profiles').select('id,name,role').eq('id', body.artistId).eq('role', 'artist').single());
    const commission = unwrap(await supabase.from('commissions').insert({
      id: body.id || crypto.randomUUID(),
      artistId: artist.id,
      clientId: user.id,
      artistName: artist.name,
      clientName: profile.name,
      title: body.title,
      description: body.description || '',
      referenceImage: body.referenceImage || '',
    }).select('id,status').single());
    await createNotification({
      userId: artist.id,
      commissionId: commission.id,
      type: 'new_commission',
      text: `${profile.name} sent you a commission request: "${body.title}"`,
    });
    return { commission };
  }

  if (action === 'commissions') {
    return { commissions: await loadCommissions(params.get('role')) };
  }

  if (action === 'commission') {
    return { commission: unwrap(await supabase.from('commissions').select('*').eq('id', params.get('id')).single()) };
  }

  if (action === 'update_commission_status') {
    const { user } = await currentProfile();
    const commission = unwrap(await supabase.from('commissions').update({ status: body.status }).eq('id', body.id).eq('artistId', user.id).select('*').single());
    const accepted = body.status === 'active';
    await createNotification({
      userId: commission.clientId,
      commissionId: commission.id,
      type: accepted ? 'commission_accepted' : 'commission_declined',
      text: `${commission.artistName} ${accepted ? 'accepted' : 'declined'} your commission request: "${commission.title}"`,
    });
    return { status: 'updated' };
  }

  if (action === 'update_commission_stage') {
    const { user } = await currentProfile();
    const updates = {};
    for (const key of ['currentStage', 'stageStatus', 'clientApproval', 'stageData', 'status']) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    if (!Object.keys(updates).length) fail('Nothing to update.', 422);
    unwrap(await supabase.from('commissions').update(updates).eq('id', body.id).select('id').single());
    if (body.notify) await createNotification({ ...body.notify, commissionId: body.id });
    return { status: 'updated' };
  }

  if (action === 'messages') {
    const result = unwrap(await supabase.from('commission_messages').select('*').eq('commissionId', params.get('commissionId')).order('createdAt'));
    return { messages: result };
  }

  if (action === 'send_message') {
    const { user, profile } = await currentProfile();
    if (body.senderId !== user.id) fail('Message sender does not match your signed-in account.', 403);
    const message = unwrap(await supabase.from('commission_messages').insert({
      commissionId: body.commissionId,
      senderId: user.id,
      senderName: profile.name,
      senderRole: profile.role,
      message: body.message,
    }).select('id').single());
    const commission = unwrap(await supabase.from('commissions').select('*').eq('id', body.commissionId).single());
    await createNotification({
      userId: profile.role === 'artist' ? commission.clientId : commission.artistId,
      commissionId: commission.id,
      type: 'new_message',
      text: `${profile.name} sent a message on "${commission.title}"`,
    });
    return { message: { ...message, status: 'sent' } };
  }

  if (action === 'mark_messages_read') {
    const { user } = await currentProfile();
    unwrap(await supabase.from('commission_messages').update({ isRead: true })
      .eq('commissionId', body.commissionId).neq('senderId', user.id).eq('isRead', false));
    return { status: 'marked' };
  }

  if (action === 'dashboard_counts') {
    const { user, profile } = await currentProfile();
    const column = profile.role === 'artist' ? 'artistId' : 'clientId';
    const commissions = unwrap(await supabase.from('commissions').select('id,status').eq(column, user.id));
    const commissionIds = commissions.map((item) => item.id);
    const [messagesResult, notificationsResult] = await Promise.all([
      commissionIds.length
        ? supabase.from('commission_messages').select('id', { count: 'exact', head: true }).in('commissionId', commissionIds).neq('senderId', user.id).eq('isRead', false)
        : Promise.resolve({ count: 0, error: null }),
      supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('userId', user.id).eq('isRead', false),
    ]);
    if (messagesResult.error) fail(messagesResult.error);
    if (notificationsResult.error) fail(notificationsResult.error);
    return {
      active: commissions.filter((item) => item.status === 'active').length,
      pending: commissions.filter((item) => item.status === 'pending').length,
      unreadMessages: messagesResult.count || 0,
      notifications: notificationsResult.count || 0,
    };
  }

  if (action === 'notifications') {
    const { user } = await currentProfile();
    if (params.get('userId') !== user.id) fail('You can only read your own notifications.', 403);
    return { notifications: unwrap(await supabase.from('notifications').select('*').eq('userId', user.id).order('createdAt', { ascending: false }).limit(30)) };
  }

  if (action === 'mark_notifications_read') {
    const { user } = await currentProfile();
    if (body.userId !== user.id) fail('You can only update your own notifications.', 403);
    unwrap(await supabase.from('notifications').update({ isRead: true }).eq('userId', user.id).eq('isRead', false));
    return { status: 'marked' };
  }

  fail(`Unsupported Supabase action: ${action}`, 404);
}

export async function apiFetch(input, init = {}) {
  const rawUrl = typeof input === 'string' ? input : input.url;
  const url = new URL(rawUrl, window.location.href);
  const params = url.searchParams;
  const action = params.get('action');
  let body = {};
  try {
    const rawBody = init.body ?? (input instanceof Request ? await input.clone().text() : null);
    if (rawBody) body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
    return response(await dispatch(action, params, body));
  } catch (error) {
    return response({ error: error.message || 'Supabase request failed.' }, error.status || 400);
  }
}

export async function listenForMessages(commissionId, onMessages, onError = console.error) {
  const refresh = async () => {
    const { data, error } = await supabase.from('commission_messages')
      .select('*').eq('commissionId', commissionId).order('createdAt');
    if (error) onError(error);
    else onMessages(data || []);
  };

  await refresh();
  const channel = supabase.channel(`commission-messages-${commissionId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'commission_messages',
      filter: `commissionId=eq.${commissionId}`,
    }, refresh)
    .subscribe((status, error) => {
      if (status === 'CHANNEL_ERROR' && error) onError(error);
    });

  return () => { supabase.removeChannel(channel); };
}
