# ViCom Supabase setup

The browser app uses Supabase Auth and Postgres through the Supabase JavaScript client. `supabase-api.js` translates the existing page actions into Supabase queries; the old Firebase config and Firestore rules are no longer used.

## Configure the project

1. Create a Supabase project and enable Email auth.
2. In `supabase-config.js`, replace `YOUR_PROJECT_ID` and `YOUR_SUPABASE_ANON_KEY` with the project's URL and anon/publishable key. Never put a service-role key in browser code.
3. Run `supabase-schema.sql` in the Supabase SQL Editor.
4. Enable Realtime for `commission_messages` in Database > Publications so commission chat updates live.
5. Serve the workspace from a web server such as XAMPP Apache. Do not use `file://` URLs.

## Data and security

The schema creates public profiles, private account emails, artworks, artist rates, commissions, commission messages, and notifications. Auth sign-up creates the profile rows. Row Level Security limits private profile access, artwork/rate ownership, commission access, messages, and notifications. Commission triggers protect approved stage data and enforce participant transitions.

Artwork, reference, and stage images currently remain in text/JSON fields as data URLs to preserve the existing page format. Supabase Storage is a separate follow-up if images should be moved out of Postgres.

## Existing records

`vicom_database.sql` is a MariaDB export and is not directly executable in Supabase. Convert/import its records separately. Existing password hashes and non-UUID user IDs cannot be reused as Supabase Auth users as-is; create Supabase accounts and map old records to their new Auth UUIDs before importing related records.

The old MySQL/PHP API and MariaDB export are retained as migration references only.