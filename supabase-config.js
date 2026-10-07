import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const SUPABASE_URL = 'https://iupypaqynuttqlvdpend.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_4EwEsQMmAyXMhaUbPYhlqA_QVod5kFY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});