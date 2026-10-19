import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function env(key: string): string | undefined {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  if (meta && meta[key] != null) return meta[key];
  return typeof process !== 'undefined' ? process.env[key] : undefined;
}

let client: SupabaseClient | null = null;

/** Browser client using the anon key. RLS enforces all authorization. */
export function getSupabaseClient(): SupabaseClient {
  if (client) return client;
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    throw new Error('Supabase client requested without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
  }
  client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}
