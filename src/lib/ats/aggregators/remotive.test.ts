// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRemotiveClient } from './remotive';
import type { FetchLike } from '../types';

const job = (id: number, title: string) => ({ id, title, company_name: 'Acme', url: `https://remotive.com/remote-jobs/x/${id}`, job_type: 'full_time' });
const reply = (body: unknown, init: ResponseInit = { status: 200, headers: { 'content-type': 'application/json' } }) =>
  (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), init)) as unknown as FetchLike;

describe('Remotive client', () => {
  it('treats an API answer with no early-career jobs as a valid empty result and says so', async () => {
    // Production, Nov 2026: the API returned 16 jobs (job-count 16, total-job-count 16), none early-career.
    const jobs = Array.from({ length: 16 }, (_, i) => job(i, 'Senior Backend Engineer'));
    const client = createRemotiveClient(reply({ 'job-count': 16, 'total-job-count': 16, jobs }));
    expect(await client.fetchEarlyCareer()).toEqual([]);
    expect(client.feedWasComplete?.()).toBe(true);
    expect(client.feedReport?.()).toMatchObject({ complete: true, stopReason: 'API returned 16 job(s) (total-job-count 16); 0 early-career' });
  });

  it('keeps early-career jobs', async () => {
    const client = createRemotiveClient(reply({ jobs: [job(1, 'Software Engineering Intern'), job(2, 'Staff Engineer')] }));
    expect((await client.fetchEarlyCareer()).map((p) => p.externalJobId)).toEqual(['remotive-1']);
  });

  it('fails clearly on HTML or a missing jobs array instead of reporting zero jobs', async () => {
    await expect(createRemotiveClient(reply('<html><head><title>Maintenance</title></head></html>', { status: 200, headers: { 'content-type': 'text/html' } })).fetchEarlyCareer())
      .rejects.toThrow('Remotive: maintenance');
    await expect(createRemotiveClient(reply({ message: 'moved' })).fetchEarlyCareer()).rejects.toThrow('no jobs array');
  });
});