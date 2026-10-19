import { describe, it, expect } from 'vitest';
import { resolveAdapterMode } from '@/lib/adapter';

describe('smoke', () => {
  it('defaults to local adapter mode when no Supabase env is set', () => {
    expect(resolveAdapterMode({})).toBe('local');
  });

  it('selects supabase when both client vars are present', () => {
    expect(
      resolveAdapterMode({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' }),
    ).toBe('supabase');
  });
});
