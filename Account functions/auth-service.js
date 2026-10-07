import { supabase } from '../supabase-config.js';

export async function logoutUser() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}