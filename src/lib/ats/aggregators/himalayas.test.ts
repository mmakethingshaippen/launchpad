// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { checkHimalayasJob, createHimalayasClient, himalayasJobUrl } from './himalayas';

const NOW = new Date('2026-11-17T12:00:00Z');
const GUID = 'https://himalayas.app/companies/acme/jobs/data-intern';
const job = (changes = {}) => ({
  guid: GUID, title: 'Data Science Intern', companyName: 'Acme', employmentType: 'Intern',
  applicationLink: `${GUID}?utm_source=api&campaign=original`,
  description: '<p>Work with data.</p>', locationRestrictions: ['United States', 'Canada'], timezoneRestrictions: [-5, -8],
  expiryDate: Date.parse('2027-01-01T12:00:00Z') / 1000,
  minSalary: 25, maxSalary: 35, salaryPeriod: 'hourly', currency: 'USD', ...changes,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const options = { now: NOW, requestDelayMs: 0 };

describe('Himalayas feed', () => {
  it('preserves Apply links, pay units, restrictions and source attribution, and deduplicates overlapping searches', async () => {
    const urls: string[] = [];
    const client = createHimalayasClient(async url => {
      urls.push(url);
      return json({ jobs: new URL(url).searchParams.get('page') === '1' ? [job()] : [] });
    }, options);
    const postings = await client.fetchEarlyCareer();
    expect(postings).toHaveLength(1);
    expect(postings[0]).toMatchObject({
      source: 'himalayas', sourceUrl: GUID, applyUrl: job().applicationLink,
      country: 'United States, Canada', workArrangement: 'Remote',
      pay: { min: 25, max: 35, currency: 'USD', period: 'hourly' },
    });
    expect(postings[0].externalJobId).toMatch(/^himalayas-[0-9a-f]{24}$/);
    expect(postings[0].descriptionHtml).toContain('Eligible UTC offsets: -5, -8');
    expect(urls).toHaveLength(8);
    expect(client.feedWasComplete?.()).toBe(true);
    expect(client.exhaustiveInventory).toBe(false);
  });

  it('reads past short pages and an inaccurate totalCount until an empty page', async () => {
    const client = createHimalayasClient(async url => {
      const page = Number(new URL(url).searchParams.get('page'));
      return json({ totalCount: 1, jobs: page < 3 ? [job({ guid: `${GUID}-${page}` })] : [] });
    }, options);
    expect(await client.fetchEarlyCareer()).toHaveLength(2);
    expect(client.feedReport?.()).toMatchObject({ complete: true, pagesRead: 12 });
  });

  it('drops expired, missing-expiry, invalid-URL and senior jobs', async () => {
    const client = createHimalayasClient(async url => json({ jobs: new URL(url).searchParams.get('page') === '1' ? [
      job({ title: 'Senior Data Scientist Intern' }), job({ expiryDate: 1 }), job({ expiryDate: null }),
      job({ applicationLink: 'javascript:alert(1)' }), job({ guid: 'https://himalayas.app.evil.test/companies/a/jobs/b' }), job(),
    ] : [] }), options);
    expect(await client.fetchEarlyCareer()).toHaveLength(1);
  });

  it('preserves earlier pages and stops without retrying a rate limit', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ jobs: [job()] })).mockResolvedValue(new Response('', { status: 429 }));
    const client = createHimalayasClient(fetchImpl, options);
    expect(await client.fetchEarlyCareer()).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(client.feedReport?.()).toMatchObject({ complete: false, stopReason: expect.stringContaining('429') });
  });

  it('reports a challenge with its host so fallback can avoid a second blocked crawl', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } }));
    const client = createHimalayasClient(fetchImpl, options);
    expect(await client.fetchEarlyCareer()).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(client.feedReport?.()).toMatchObject({ complete: false, blocked: { host: 'himalayas.app' } });
  });

  it('stops repeated pages as incomplete', async () => {
    const fetchImpl = vi.fn(async () => json({ jobs: [job()] }));
    const client = createHimalayasClient(fetchImpl, options);
    expect(await client.fetchEarlyCareer()).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(client.feedReport?.().complete).toBe(false);
  });

  it('does not report a malformed response as an empty complete feed', async () => {
    const client = createHimalayasClient(async () => json({ error: 'oops' }), options);
    expect(await client.fetchEarlyCareer()).toEqual([]);
    expect(client.feedReport?.()).toMatchObject({ complete: false, stopReason: expect.stringContaining('no jobs array') });
  });

  it('stops on an aborted signal without starting a request', async () => {
    const fetchImpl = vi.fn();
    const client = createHimalayasClient(fetchImpl, options);
    await client.fetchEarlyCareer(AbortSignal.abort());
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(client.feedWasComplete?.()).toBe(false);
  });
});

describe('Himalayas per-job verification', () => {
  const role = { applyUrl: job().applicationLink, title: job().title, companyName: 'Acme' };
  it('uses the official job API and requires matching job identity', async () => {
    const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => json({ job: job() }));
    expect(await checkHimalayasJob(role, fetchImpl, NOW)).toMatchObject({ kind: 'live' });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://himalayas.app/jobs/api/companies/acme/jobs/data-intern');
    expect(await checkHimalayasJob(role, async () => json({ job: job({ guid: `${GUID}-other` }) }), NOW)).toMatchObject({ kind: 'unreadable' });
    expect(await checkHimalayasJob(role, async () => json({ job: job({ title: 'Senior Engineer' }) }), NOW)).toMatchObject({ kind: 'unreadable' });
  });
  it.each([[410, 'closed'], [404, 'unreadable'], [429, 'failed'], [503, 'failed']] as const)('handles API %i as %s', async (status, kind) => {
    expect(await checkHimalayasJob(role, async () => json({}, status), NOW)).toMatchObject({ kind });
  });
  it('does not close a job because a redirected destination returned 410', async () => {
    const response = json({}, 410);
    Object.defineProperty(response, 'redirected', { value: true });
    expect(await checkHimalayasJob(role, async () => response, NOW)).toMatchObject({ kind: 'unreadable' });
  });
  it('can use the source URL when the original Apply link points elsewhere', async () => {
    expect(await checkHimalayasJob({ ...role, applyUrl: 'https://employer.test/apply', sourceUrl: GUID }, async () => json({ job: job() }), NOW)).toMatchObject({ kind: 'live' });
  });
  it('does not request arbitrary hosts or non-job paths', async () => {
    const fetchImpl = vi.fn();
    expect(himalayasJobUrl('https://himalayas.app@evil.test/companies/a/jobs/b')).toBeNull();
    expect(await checkHimalayasJob({ ...role, applyUrl: 'https://evil.test/jobs/x' }, fetchImpl, NOW)).toMatchObject({ kind: 'unreadable' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
