import { describe, it, expect, vi } from 'vitest';
import type { FetchLike } from '../types';
import { createSmartRecruitersClientFor } from './smartrecruiters';
import { createWorkableClient } from './workable';

function fakeFetch(payload: unknown, status = 200): FetchLike {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  });
}

const SR_FIXTURE = {
  content: [
    {
      id: 'abc123',
      name: 'Data Analyst Intern',
      releasedDate: '2026-09-01T00:00:00Z',
      location: { city: 'Seattle', region: 'WA', country: 'us', remote: false },
      department: { label: 'Data' },
      typeOfEmployment: { label: 'Intern' },
    },
    {
      id: 'def456',
      name: 'Remote Software Intern',
      location: { city: 'Austin', region: 'TX', country: 'us', remote: true },
      typeOfEmployment: { label: 'Intern' },
    },
  ],
};

describe('SmartRecruiters provider', () => {
  it('normalizes postings and builds token-bound apply URLs', async () => {
    const client = createSmartRecruitersClientFor('Visa', fakeFetch(SR_FIXTURE));
    const raw = await client.fetchPostings('Visa');
    expect(raw).toHaveLength(2);

    const first = client.toNormalized(raw[0]);
    expect(first).toMatchObject({
      externalJobId: 'abc123',
      title: 'Data Analyst Intern',
      city: 'Seattle',
      state: 'WA',
      country: 'USA',
      applyUrl: 'https://jobs.smartrecruiters.com/Visa/abc123',
    });

    const second = client.toNormalized(raw[1]);
    expect(second?.workArrangement).toBe('Remote');
  });

  it('throws on non-200', async () => {
    const client = createSmartRecruitersClientFor('Nope', fakeFetch({}, 404));
    await expect(client.fetchPostings('Nope')).rejects.toThrow(/HTTP 404/);
  });
});

const WORKABLE_WIDGET = {
  jobs: [
    {
      shortcode: 'AB12CD',
      title: 'Junior Backend Engineer',
      url: 'https://apply.workable.com/acme/j/AB12CD',
      location: { city: 'New York', region: 'NY', country: 'USA', telecommuting: false },
      department: 'Engineering',
      employment_type: 'Full-time',
      created_at: '2026-09-02T00:00:00Z',
    },
    {
      shortcode: 'EF34GH',
      title: 'Remote Data Intern',
      location: { telecommuting: true },
    },
  ],
};

describe('Workable provider', () => {
  it('normalizes widget jobs with apply URLs and remote detection', async () => {
    const client = createWorkableClient(fakeFetch(WORKABLE_WIDGET));
    const raw = await client.fetchPostings('acme');
    expect(raw).toHaveLength(2);

    const first = client.toNormalized(raw[0]);
    expect(first).toMatchObject({
      externalJobId: 'AB12CD',
      title: 'Junior Backend Engineer',
      city: 'New York',
      applyUrl: 'https://apply.workable.com/acme/j/AB12CD',
    });

    const second = client.toNormalized(raw[1]);
    expect(second?.workArrangement).toBe('Remote');
  });

  it('falls back to the v3 POST API when the widget returns no jobs', async () => {
    // First call (widget) returns empty; second call (v3 POST) returns results.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ jobs: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            { shortcode: 'V3JOB', title: 'New Grad Analyst', url: 'https://apply.workable.com/x/j/V3JOB', locations: [{ city: 'Chicago' }], remote: false },
          ],
        }),
      });
    const client = createWorkableClient(fetchImpl as unknown as FetchLike);
    const raw = await client.fetchPostings('acme');
    expect(raw).toHaveLength(1);
    expect(client.toNormalized(raw[0])).toMatchObject({ externalJobId: 'V3JOB', city: 'Chicago' });
    // Verify the second call used POST.
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({ method: 'POST' });
  });
});
