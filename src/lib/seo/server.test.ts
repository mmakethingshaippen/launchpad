// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { handleSeoRequest, SITE_ORIGIN } from './server';

const shell = '<html><head><title>Generic</title><meta name="description" content="Generic"><meta name="google-site-verification" content="keep-me"><script type="module" src="/assets/app.js"></script></head><body><div id="root"><div>Loading shell</div></div></body></html>';
const now = new Date('2026-11-21T12:00:00Z');
const config = { shell, now, supabaseUrl: 'https://public.example', anonKey: 'public-anon' };
const job = { id: 'j1', slug: 'engineering-intern', title: 'Engineering Intern', description: '<p>Build useful things.</p><script>alert(1)</script>',
  last_verified_at: '2026-11-21T10:00:00Z', apply_url: 'https://employer.example/job/1', city: 'Boise', country: 'US', opportunity_type: 'Internship', companies: { name: 'Example', slug: 'example' } };
const json = (data: unknown, total?: number) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', ...(total !== undefined ? { 'content-range': `0-0/${total}` } : {}) } });

describe('public search rendering', () => {
  it('includes the approved creator content, real portrait and identity in initial HTML without a database', async () => {
    const fetchImpl = vi.fn();
    const page = await handleSeoRequest('/api/seo?__path=/about', { shell, fetchImpl });
    expect(page.status).toBe(200);
    expect(page.body).toContain('Make the first career step easier to find.');
    expect(page.body).toContain('Maxim Culbeaux');
    expect(page.body).toContain('src="/maxim-culbeaux.jpg"');
    expect(page.body).toContain('"@type":"Person"');
    expect(page.body).toContain(`href="${SITE_ORIGIN}/about"`);
    expect(page.body).toContain('google-site-verification');
    expect(page.body).toContain('/assets/app.js');
    expect(page.body).not.toContain('Loading shell');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('serves the actual resource guide, rather than identical loading HTML for every route', async () => {
    const page = await handleSeoRequest('/resources/internship-resume-tips', { shell });
    expect(page.status).toBe(200);
    expect(page.body).toContain('Lead with impact, not duties');
    expect(page.body).toContain('Internship Resume Tips');
    expect(page.body).not.toContain('Loading shell');
  });

  it('reads only public job fields with the public key and returns distinct escaped job content', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      expect((init?.headers as Record<string, string>).apikey).toBe('public-anon');
      return json([{ ...job, title: 'Intern <img src=x onerror=alert(1)>' }]);
    });
    const page = await handleSeoRequest('/roles/engineering-intern', { ...config, fetchImpl });
    expect(page.status).toBe(200);
    expect(page.body).toContain('Build useful things.');
    expect(page.body).toContain('Intern &lt;img');
    expect(page.body).not.toContain('<img src=x');
    expect(page.body).not.toContain('<script>alert');
    expect(page.body).toContain('https://employer.example/job/1');
    const request = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(request.pathname).toBe('/rest/v1/public_roles');
    expect(request.searchParams.get('last_verified_at')).toBe('gte.2026-11-14T12:00:00.000Z');
    expect(request.searchParams.get('select')).not.toMatch(/verification_failure|external_job_id|users/);
  });

  it.each([null, '2026-11-01T00:00:00Z'])('never publishes an unverified or stale job (%s)', async last_verified_at => {
    const page = await handleSeoRequest('/roles/engineering-intern', { ...config, fetchImpl: async () => json([{ ...job, last_verified_at }]) });
    expect(page.status).toBe(404);
    expect(page.headers['X-Robots-Tag']).toContain('noindex');
    expect(page.body).not.toContain('href="https://employer.example/job/1"');
  });

  it('preserves source credit and the existing Himalayas Apply route in initial HTML', async () => {
    const source_url = 'https://himalayas.app/companies/example/jobs/engineering-intern';
    const page = await handleSeoRequest('/roles/engineering-intern', { ...config, fetchImpl: async () => json([{ ...job, source_url }]) });
    expect(page.status).toBe(200);
    expect(page.body).toContain('Apply via Himalayas');
    expect(page.body).toContain(`href="${source_url}"`);
    expect(page.body).toContain('>Himalayas</a>');
    expect(page.body).not.toContain('href="https://employer.example/job/1"');
  });

  it('returns 503 for a failed public database request, not a misleading empty page or 404', async () => {
    const page = await handleSeoRequest('/roles/engineering-intern', { ...config, fetchImpl: async () => new Response('', { status: 500 }) });
    expect(page.status).toBe(503);
    expect(page.headers['Cache-Control']).toBe('no-store');
    expect(page.headers['Retry-After']).toBe('300');
    expect(page.headers['X-Robots-Tag']).toBeUndefined();
    expect(page.body).not.toContain('noindex');
  });

  it('keeps private pages out of the index and gives unknown URLs a real 404', async () => {
    for (const path of ['/admin', '/applications', '/signin', '/reset-password', '/submit']) {
      const result = await handleSeoRequest(path, { shell });
      expect(result.status).toBe(200);
      expect(result.headers['X-Robots-Tag']).toContain('noindex');
    }
    expect((await handleSeoRequest('/not-a-real-page', { shell })).status).toBe(404);
    expect((await handleSeoRequest('/about/', { shell })).headers.Location).toBe('/about');
  });

  it('serves the public Map without a database and excludes filtered Map variants', async () => {
    const fetchImpl = vi.fn();
    const main = await handleSeoRequest('/api/seo?__path=/map', { shell, fetchImpl });
    const filtered = await handleSeoRequest('/api/seo?__path=/map&company=example', { shell, fetchImpl });
    expect(main.status).toBe(200);
    expect(main.body).toContain('Explore by location');
    expect(main.body).toContain(`href="${SITE_ORIGIN}/map"`);
    expect(main.headers['X-Robots-Tag']).toBeUndefined();
    expect(filtered.headers['X-Robots-Tag']).toContain('noindex');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('indexes the main Browse page, while canonicalizing filtered variants without indexing them', async () => {
    const fetchImpl: typeof fetch = async () => json([job]);
    const main = await handleSeoRequest('/browse', { ...config, fetchImpl });
    const filtered = await handleSeoRequest('/browse?q=engineering&page=2', { ...config, fetchImpl });
    expect(main.status).toBe(200);
    expect(main.headers['X-Robots-Tag']).toBeUndefined();
    expect(filtered.headers['X-Robots-Tag']).toContain('noindex');
    expect(filtered.body).toContain(`href="${SITE_ORIGIN}/browse"`);
  });
});

describe('live sitemap coverage', () => {
  it('creates sitemap chunks beyond the first 1000 jobs and includes the About page and guides', async () => {
    const fetchImpl: typeof fetch = async input => json([{ id: '1' }], String(input).includes('/public_roles?') ? 2001 : 1001);
    const index = await handleSeoRequest('/sitemap.xml', { ...config, fetchImpl });
    expect(index.status).toBe(200);
    expect(index.body).toContain('/sitemaps/jobs-3.xml');
    expect(index.body).toContain('/sitemaps/companies-2.xml');
    const pages = await handleSeoRequest('/sitemap-pages.xml', { shell });
    expect(pages.body).toContain(`${SITE_ORIGIN}/about`);
    expect(pages.body).toContain('/resources/internship-resume-tips');
    expect(pages.body).not.toContain('/applications');
    expect(pages.body).not.toContain('<lastmod>');
  });

  it('requests page two explicitly, from public_roles with freshness filters', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json([{ id: 'j1001', slug: 'new-opportunity' }]));
    const response = await handleSeoRequest('/sitemaps/jobs-2.xml', { ...config, fetchImpl });
    expect(response.headers['Content-Type']).toContain('application/xml');
    expect(response.body).toContain('/roles/new-opportunity');
    const request = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(request.pathname).toBe('/rest/v1/public_roles');
    expect(request.searchParams.get('offset')).toBe('1000');
    expect(request.searchParams.get('limit')).toBe('1000');
    expect(request.searchParams.get('last_verified_at')).toBeTruthy();
    expect((await handleSeoRequest('/sitemaps/jobs-0.xml', { ...config, fetchImpl })).status).toBe(404);
  });
});
