import { describe, it, expect } from 'vitest';
import type { FetchLike } from './types';
import { createSimplifyClient } from './simplify';

/** A fetch impl returning distinct payloads per repo URL. */
function routed(byRepo: Record<string, unknown>): FetchLike {
  return async (input) => {
    const repo = Object.keys(byRepo).find((r) => input.includes(`/${r}/`));
    const payload = repo ? byRepo[repo] : [];
    return { ok: true, status: 200, json: async () => payload };
  };
}

const openIntern = {
  id: 'a1',
  company_name: 'Acme Corp',
  company_url: 'https://simplify.jobs/c/Acme',
  title: 'Software Engineer Intern',
  url: 'https://acme.com/jobs/1',
  active: true,
  is_visible: true,
  locations: ['San Jose, CA'],
  terms: ['Summer 2026'],
};

describe('SimplifyJobs connector', () => {
  it('keeps active + visible early-career roles and attaches company + location', async () => {
    const client = createSimplifyClient(
      routed({ 'Summer2026-Internships': [openIntern] }),
    );
    const out = await client.fetchEarlyCareer();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: 'simplify',
      companyName: 'Acme Corp',
      companyWebsite: 'https://simplify.jobs/c/Acme',
      applyUrl: 'https://acme.com/jobs/1',
      city: 'San Jose',
      state: 'CA',
    });
    // Season term is folded into the title so the shared extractor can read it.
    expect(out[0].title).toContain('Summer 2026');
  });

  it('drops inactive and hidden listings', async () => {
    const client = createSimplifyClient(
      routed({
        'Summer2026-Internships': [
          { ...openIntern, id: 'closed', active: false },
          { ...openIntern, id: 'hidden', is_visible: false },
          openIntern,
        ],
      }),
    );
    const out = await client.fetchEarlyCareer();
    expect(out).toHaveLength(1);
    expect(out[0].externalJobId).toBe('simplify-a1');
  });

  it('flags remote locations and excludes senior titles', async () => {
    const client = createSimplifyClient(
      routed({
        'New-Grad-Positions': [
          {
            id: 'ng1',
            company_name: 'Beta Inc',
            title: 'Software Engineer, New Grad',
            url: 'https://beta.com/jobs/ng1',
            active: true,
            is_visible: true,
            locations: ['Remote in USA'],
          },
          {
            id: 'ng2',
            company_name: 'Beta Inc',
            title: 'Senior Software Engineer',
            url: 'https://beta.com/jobs/ng2',
            active: true,
            is_visible: true,
            locations: ['New York, NY'],
          },
        ],
      }),
    );
    const out = await client.fetchEarlyCareer();
    expect(out.map((o) => o.title)).toEqual(['Software Engineer, New Grad']);
    expect(out[0].workArrangement).toBe('Remote');
  });

  it('dedupes the same listing id across repos', async () => {
    const client = createSimplifyClient(
      routed({
        'Summer2026-Internships': [openIntern],
        'Summer2027-Internships': [openIntern],
        'New-Grad-Positions': [openIntern],
      }),
    );
    const out = await client.fetchEarlyCareer();
    expect(out).toHaveLength(1);
  });
});
