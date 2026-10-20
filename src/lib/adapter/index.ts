import type { DataAdapter } from './adapter';

export type AdapterMode = 'supabase' | 'local';

/**
 * Decide which adapter to use based on env presence (Req 23).
 * If both Supabase client vars are set → cloud; otherwise → local fallback.
 */
export function resolveAdapterMode(
  env: Record<string, string | undefined> = readEnv(),
): AdapterMode {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  return url && key ? 'supabase' : 'local';
}

function readEnv(): Record<string, string | undefined> {
  // Works in both Vite (import.meta.env) and Node (process.env) contexts.
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  if (meta) return meta;
  return typeof process !== 'undefined' ? process.env : {};
}

let cached: DataAdapter | null = null;

/** Lazily build and memoize the adapter for the current runtime. */
export async function getAdapter(): Promise<DataAdapter> {
  if (cached) return cached;
  const mode = resolveAdapterMode();
  if (mode === 'supabase') {
    const { SupabaseAdapter } = await import('./supabase');
    cached = new SupabaseAdapter();
  } else {
    const { LocalAdapter } = await import('./local');
    cached = new LocalAdapter();
  }
  return cached;
}

/** Test helper to inject/override the adapter. */
export function __setAdapter(adapter: DataAdapter | null): void {
  cached = adapter;
}

export type { DataAdapter } from './adapter';
export type {
  CompanyFormA,
  RoleFormB,
  SyncResult,
  PendingQueue,
  PendingCompany,
  PendingRole,
  ListingReport,
  MapMarker,
  MapMarkerRole,
} from './adapter';
