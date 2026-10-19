import { describe, it, expect } from 'vitest';
import type { FetchLike } from '../types';
import { createGreenhouseClient } from './greenhouse';
import { createAshbyClient } from './ashby';
import { createLeverClient } from './lever';
import greenhouseFixture from '../../../test/fixtures/greenhouse.json';
import ashbyFixture from '../../../test/fixtures/ashby.json';
import leverFixture from '../../../test/fixtures/lever.json';

function fakeFetch(payload: unknown, status = 200): FetchLike {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  });
}

describe('Greenhouse provider', () => {
  it('fetches and normalizes jobs, decoding HTML entities', async () => {
    const client = createGreenhouseClient(fakeFetch(greenhouseFixture));
    const raw = await client.fetchPostings('acme');
    expect(raw).toHaveLength(3);

    const intern = client.toNormalized(raw[0]);
    expect(intern).toMatchObject({
      externalJobId: '101',
      title: 'Software Engineering Intern - Summer 2027',
      applyUrl: 'https://boards.greenhouse.io/acme/jobs/101',
      city: 'San Francisco',
      state: 'CA',
      country: 'USA',
    });
    expect(intern?.descriptionHtml).toContain('<strong>Summer 2027</strong>');
  });

  it('throws on non-200', async () => {
    const client = createGreenhouseClient(fakeFetch({}, 404));
    await expect(client.fetchPostings('missing')).rejects.toThrow(/HTTP 404/);
  });
});

describe('Ashby provider', () => {
  it('normalizes only listed postings and extracts hourly compensation', async () => {
    const client = createAshbyClient(fakeFetch(ashbyFixture));
    const raw = await client.fetchPostings('startup');
    expect(raw).toHaveLength(3);

    const listed = client.toNormalized(raw[0]);
    expect(listed).toMatchObject({
      externalJobId: 'a-1',
      title: 'Product Design Intern',
      workArrangement: 'Hybrid',
      employmentTypeRaw: 'Intern',
    });
    expect(listed?.pay).toMatchObject({ min: 30, max: 40, currency: 'USD', period: 'hour' });

    // isListed === false must be dropped (Req 17.3)
    expect(client.toNormalized(raw[1])).toBeNull();
  });
});

describe('Lever provider', () => {
  it('normalizes array of postings with salary range', async () => {
    const client = createLeverClient(fakeFetch(leverFixture));
    const raw = await client.fetchPostings('widget');
    expect(raw).toHaveLength(3);

    const newGrad = client.toNormalized(raw[0]);
    expect(newGrad).toMatchObject({
      externalJobId: 'l-1',
      title: 'New Grad Software Engineer',
      workArrangement: 'Remote',
      city: 'Seattle',
      state: 'WA',
    });
    expect(newGrad?.pay).toMatchObject({ min: 90000, max: 110000, currency: 'USD', period: 'year' });
  });
});
