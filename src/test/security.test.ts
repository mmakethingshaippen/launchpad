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
  it('service_role key is referenced only in server-side api/sync.ts', () => {
    const files = ['src/lib/supabaseClient.ts', 'src/lib/adapter/supabase.ts', 'src/main.tsx'];
    for (const f of files) {
      expect(read(f), f).not.toContain('SERVICE_ROLE');
    }
    expect(read('api/sync.ts')).toContain('SUPABASE_SERVICE_ROLE_KEY');
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
