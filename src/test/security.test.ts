import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sanitizeHtml } from '../lib/sanitize';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel: string) {
  return readFileSync(path.join(root, rel), 'utf8');
}

// These guard the security invariants from Req 21 & 27 at source level so a
// regression is caught in CI even without a live environment.
describe('security invariants', () => {
  it('service_role key is referenced only in server-side code, never in browser modules', () => {
    // Browser-reachable modules must never touch the service role key.
    const browserFiles = [
      'src/lib/supabaseClient.ts',
      'src/lib/adapter/supabase.ts',
      'src/lib/adapter/local.ts',
      'src/main.tsx',
    ];
    for (const f of browserFiles) {
      expect(read(f), f).not.toContain('SERVICE_ROLE');
    }
    // The service role lives only in the server-side sink used by scripts + the
    // serverless function (api/_src/sync.ts is bundled to api/sync.js).
    expect(read('src/lib/ats/supabaseSink.ts')).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(read('api/_src/sync.ts')).toContain('createServiceClient');
  });

  it('the server-side sink is never imported by browser UI code', () => {
    // UI goes through the DataAdapter (anon key); it must not import the sink.
    for (const f of ['src/lib/adapter/supabase.ts', 'src/lib/adapter/local.ts', 'src/main.tsx']) {
      expect(read(f), f).not.toContain('supabaseSink');
    }
  });

  it('the browser client uses only the anon key', () => {
    const client = read('src/lib/supabaseClient.ts');
    expect(client).toContain('VITE_SUPABASE_ANON_KEY');
    expect(client).not.toContain('SERVICE_ROLE');
  });

  it('RoleDetail sanitizes ATS HTML before rendering', () => {
    const detail = read('src/pages/RoleDetail.tsx');
    expect(detail).toContain('sanitizeHtml');
    expect(detail).toContain('dangerouslySetInnerHTML');
    // the value passed to dangerouslySetInnerHTML must be the sanitized output
    expect(detail).toMatch(/__html:\s*cleanDescription/);
  });

  it('DOMPurify strips scripts and inline handlers', () => {
    const clean = sanitizeHtml('<p>ok</p><script>steal()</script><a href="x" onclick="bad()">l</a>');
    expect(clean).toContain('<p>ok</p>');
    expect(clean).not.toMatch(/script/i);
    expect(clean).not.toMatch(/onclick/i);
  });

  it('public discovery reads go through the public_roles eligibility view', () => {
    const supa = read('src/lib/adapter/supabase.ts');
    expect(supa).toContain("from('public_roles')");
  });

  it('RLS migration forbids self-elevation to admin', () => {
    const rls = read('supabase/migrations/0002_rls.sql');
    expect(rls).toMatch(/profile_update[\s\S]*account_role = 'student'/);
  });
});
