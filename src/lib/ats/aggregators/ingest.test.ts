// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AggregatedPosting, AggregatorClient, AggregatorSource } from './types';
import { aggregatorRunSucceeded, ingestAggregators } from './ingest';

type Row = Record<string, unknown> & { id: string };

function posting(overrides: Partial<AggregatedPosting> = {}): AggregatedPosting {
  return {
    source: 'remotive',
    companyName: 'Acme Labs',
    title: 'Software Engineering Intern',
    descriptionHtml: '<p>Internship</p>',
    applyUrl: 'https://jobs.acme.test/intern',
    externalJobId: 'remotive-1',
    city: 'Seattle',
    state: 'WA',
    country: 'USA',
    workArrangement: 'Onsite',
    ...overrides,
  };
}

function client(
  source: AggregatorSource,
  postings: AggregatedPosting[] | Error,
  complete = false,
): AggregatorClient {
  return {
    source,
    feedWasComplete: () => complete,
    fetchEarlyCareer: vi.fn(async () => {
      if (postings instanceof Error) throw postings;
      return postings;
    }),
  };
}

function createDb(options: {
  companies?: Row[];
  roles?: Row[];
  pageSize?: number;
  failPreflight?: string;
  failRoleBatch?: boolean;
  failExternalIds?: string[];
  failUpdates?: boolean;
} = {}) {
  const state = {
    companies: [...(options.companies ?? [])],
    roles: [...(options.roles ?? [])],
    pageSize: options.pageSize ?? 1000,
    failPreflight: options.failPreflight,
    failRoleBatch: options.failRoleBatch ?? false,
    failExternalIds: new Set(options.failExternalIds ?? []),
    failUpdates: options.failUpdates ?? false,
    companyUpserts: [] as string[],
    roleUpsertSizes: [] as number[],
    roleUpdates: [] as string[][],
    updateFilters: [] as string[],
  };

  function project(rows: Row[], columns: string): Row[] {
    const fields = columns.split(',').map((field) => field.trim());
    return rows.map((row) => {
      const copy: Row = { id: row.id };
      for (const field of fields) copy[field] = row[field];
      return copy;
    });
  }

  function from(table: string) {
    const op: {
      action: 'select' | 'upsert' | 'update';
      columns: string;
      payload: unknown;
      filters: Array<{ type: 'eq' | 'gt' | 'in'; col: string; val: unknown }>;
      limit: number | null;
    } = { action: 'select', columns: '*', payload: null, filters: [], limit: null };

    const builder = {
      select(columns: string) {
        op.columns = columns;
        return builder;
      },
      upsert(payload: unknown) {
        op.action = 'upsert';
        op.payload = payload;
        return builder;
      },
      update(payload: unknown) {
        op.action = 'update';
        op.payload = payload;
        return builder;
      },
      eq(col: string, val: unknown) {
        op.filters.push({ type: 'eq', col, val });
        return builder;
      },
      gt(col: string, val: unknown) {
        op.filters.push({ type: 'gt', col, val });
        return builder;
      },
      in(col: string, val: unknown) {
        op.filters.push({ type: 'in', col, val });
        return builder;
      },
      order() { return builder; },
      limit(value: number) { op.limit = value; return builder; },
      maybeSingle() { return builder; },
      single() { return builder; },
      then(resolve: (value: { data: unknown; error: { message: string } | null }) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(execute()).then(resolve, reject);
      },
    };

    function matches(row: Row): boolean {
      return op.filters.every((filter) => {
        if (filter.type === 'eq') return row[filter.col] === filter.val;
        if (filter.type === 'gt') return String(row[filter.col]) > String(filter.val);
        return Array.isArray(filter.val) && filter.val.includes(row[filter.col]);
      });
    }

    function execute(): { data: unknown; error: { message: string } | null } {
      if (op.action === 'select' && table === 'roles' && op.columns === 'id') {
        if (state.failPreflight) return { data: null, error: { message: state.failPreflight } };
        return { data: [{ id: 'ok' }], error: null };
      }
      if (op.action === 'select') {
        const sourceRows = table === 'roles' ? state.roles : state.companies;
        const page = sourceRows
          .filter((row) => matches(row))
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, state.pageSize);
        return { data: project(page, op.columns), error: null };
      }
      if (op.action === 'upsert' && table === 'companies') {
        const row = op.payload as Row;
        state.companyUpserts.push(String(row.slug));
        let existing = state.companies.find((company) => company.slug === row.slug);
        if (!existing) {
          existing = { ...row, id: `co-${row.slug}` };
          state.companies.push(existing);
        }
        return { data: { id: existing.id }, error: null };
      }
      if (op.action === 'upsert' && table === 'roles') {
        const batch = op.payload as Row[];
        state.roleUpsertSizes.push(batch.length);
        if (state.failRoleBatch && batch.length > 1) {
          return { data: null, error: { message: 'batch rejected' } };
        }
        for (const row of batch) {
          if (batch.length === 1 && state.failExternalIds.has(String(row.external_job_id))) {
            return { data: null, error: { message: `bad ${row.external_job_id}` } };
          }
          const existing = state.roles.find((role) =>
            role.company_id === row.company_id && role.external_job_id === row.external_job_id);
          if (existing) Object.assign(existing, row, { id: existing.id });
          else state.roles.push({ ...row, id: `role-${state.roles.length + 1}` });
        }
        return { data: null, error: null };
      }
      if (op.action === 'update' && table === 'roles') {
        const ids = op.filters.find((filter) => filter.type === 'in')?.val as string[];
        state.roleUpdates.push(ids);
        state.updateFilters.push(op.filters.map((filter) => `${filter.type}:${filter.col}=${filter.val}`).join('|'));
        if (state.failUpdates) return { data: null, error: { message: 'verify unavailable' } };
        const patch = op.payload as Row;
        for (const role of state.roles) {
          if (!matches(role)) continue;
          Object.assign(role, patch);
        }
        return { data: null, error: null };
      }
      return { data: null, error: { message: `unhandled ${op.action} on ${table}` } };
    }

    return builder;
  }

  return { db: { from } as unknown as SupabaseClient, state };
}

const NOW = new Date('2026-10-25T18:00:00Z');

describe('aggregator ingestion', () => {
  it('inserts a new listing once and reuses the feed on a second run', async () => {
    const fake = createDb();
    const feed = client('remotive', [posting(), posting({
      applyUrl: 'https://jobs.acme.test/intern?utm_source=newsletter',
    })]);
    const first = await ingestAggregators(fake.db, { now: NOW, clients: [feed] });
    expect(first[0]).toMatchObject({
      rolesUpserted: 1,
      refreshed: 0,
      duplicatesSkipped: 1,
      companiesUpserted: 1,
      errors: [],
    });
    expect(fake.state.roles).toHaveLength(1);
    expect(fake.state.roles[0]).toMatchObject({
      source: 'aggregator',
      listing_status: 'Active',
      last_verified_at: NOW.toISOString(),
      title: 'Software Engineering Intern',
    });
    expect(feed.fetchEarlyCareer).toHaveBeenCalledTimes(1);

    const again = await ingestAggregators(fake.db, {
      now: NOW,
      clients: [client('remotive', [posting()])],
    });
    expect(again[0]).toMatchObject({ rolesUpserted: 0, refreshed: 1, duplicatesSkipped: 0, companiesUpserted: 0 });
    expect(fake.state.roles).toHaveLength(1);
    expect(fake.state.companyUpserts).toEqual(['acme-labs']);
  });

  it('refreshes an observed aggregator role without overwriting its stored fields', async () => {
    const fake = createDb({
      pageSize: 1,
      companies: [{ id: 'co-b', slug: 'acme-labs', name: 'Acme Labs', ats_provider: 'greenhouse' }],
      roles: [
        {
          id: 'role-a', company_id: 'co-b', external_job_id: 'remotive-9',
          apply_url: 'https://jobs.acme.test/other', source: 'aggregator', listing_status: 'Active',
          title: 'Keep me', last_verified_at: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'role-b', company_id: 'co-b', external_job_id: 'remotive-1',
          apply_url: 'https://jobs.acme.test/intern', source: 'aggregator', listing_status: 'Active',
          title: 'Original title', city: 'Austin', last_verified_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const results = await ingestAggregators(fake.db, {
      now: NOW,
      clients: [client('remotive', [posting({ title: 'Software Engineering Intern', descriptionHtml: '<p>thinner feed</p>' })])],
    });
    expect(results[0]).toMatchObject({ rolesUpserted: 0, refreshed: 1, duplicatesSkipped: 0, errors: [] });
    expect(fake.state.companyUpserts).toEqual([]);
    expect(fake.state.roles.find((role) => role.id === 'role-b')).toMatchObject({
      title: 'Original title',
      city: 'Austin',
      last_verified_at: NOW.toISOString(),
    });
    expect(fake.state.roles.find((role) => role.id === 'role-a')?.last_verified_at).toBe('2026-01-01T00:00:00.000Z');
    expect(fake.state.updateFilters[0]).toContain('eq:source=aggregator');
    expect(fake.state.updateFilters[0]).toContain('eq:listing_status=Active');
  });

  it('does not stamp or duplicate an ATS role that shares an application URL', async () => {
    const fake = createDb({
      companies: [{ id: 'co-ats', slug: 'acme-labs', ats_provider: 'greenhouse' }],
      roles: [{
        id: 'ats-1', company_id: 'co-ats', external_job_id: 'gh-1',
        apply_url: 'https://jobs.acme.test/intern', source: 'ats', listing_status: 'Active',
        title: 'ATS title', last_verified_at: '2026-02-02T00:00:00.000Z',
      }],
    });
    const results = await ingestAggregators(fake.db, { now: NOW, clients: [client('themuse', [posting({ source: 'themuse' })])] });
    expect(results[0]).toMatchObject({ rolesUpserted: 0, refreshed: 0, duplicatesSkipped: 1, errors: [] });
    expect(fake.state.roles).toHaveLength(1);
    expect(fake.state.roles[0]).toMatchObject({ source: 'ats', last_verified_at: '2026-02-02T00:00:00.000Z', title: 'ATS title' });
    expect(fake.state.roleUpdates).toEqual([]);
  });

  it('matches a changed URL by stable id and does not insert a second row', async () => {
    const fake = createDb({
      companies: [{ id: 'co-b', slug: 'acme-labs' }],
      roles: [{
        id: 'role-b', company_id: 'co-b', external_job_id: 'remotive-1',
        apply_url: 'https://jobs.acme.test/old', source: 'aggregator', listing_status: 'Active',
        title: 'Original title', last_verified_at: '2026-01-01T00:00:00.000Z',
      }],
    });
    const results = await ingestAggregators(fake.db, {
      now: NOW,
      clients: [client('remotive', [posting({ applyUrl: 'https://jobs.acme.test/new-link' })])],
    });
    expect(results[0]).toMatchObject({ rolesUpserted: 0, refreshed: 1 });
    expect(fake.state.roles).toHaveLength(1);
    expect(fake.state.roles[0]).toMatchObject({ title: 'Original title', apply_url: 'https://jobs.acme.test/old' });
  });

  it('does not refresh a timestamp for an expired or invalid posting', async () => {
    const fake = createDb({
      companies: [{ id: 'co-b', slug: 'acme-labs' }],
      roles: [{
        id: 'role-b', company_id: 'co-b', external_job_id: 'remotive-1',
        apply_url: 'https://jobs.acme.test/intern', source: 'aggregator', listing_status: 'Active',
        title: 'Original title', last_verified_at: '2026-01-01T00:00:00.000Z',
      }],
    });
    const results = await ingestAggregators(fake.db, {
      now: NOW,
      clients: [client('remotive', [
        posting({ title: 'Summer 2024 Intern', deadline: '2024-08-01' }),
        posting({ title: 'Senior Engineer', externalJobId: 'remotive-2', applyUrl: 'https://jobs.acme.test/senior' }),
        posting({ applyUrl: 'notaurl', externalJobId: 'remotive-3' }),
        posting({ companyName: 'Google', title: 'Software Engineer New Grad', externalJobId: 'remotive-4', applyUrl: 'https://jobs.google.test/ng' }),
      ])],
    });
    expect(results[0]).toMatchObject({
      rolesUpserted: 0,
      refreshed: 0,
      skippedExpired: 1,
      skippedInvalid: 3,
      errors: [],
    });
    expect(fake.state.roles[0].last_verified_at).toBe('2026-01-01T00:00:00.000Z');
    expect(fake.state.companies.find((company) => company.slug === 'google')).toBeUndefined();
  });

  it('continues after a feed failure and does not report that run as clean', async () => {
    const fake = createDb();
    const broken = client('simplify', new Error('timeout'));
    const healthy = client('remotive', [posting()]);
    const results = await ingestAggregators(fake.db, { now: NOW, clients: [broken, healthy] });
    expect(results[0].errors[0]).toContain('timeout');
    expect(results[0].fetched).toBe(0);
    expect(results[1].rolesUpserted).toBe(1);
    expect(aggregatorRunSucceeded(results)).toBe(false);
    expect(broken.fetchEarlyCareer).toHaveBeenCalledTimes(1);
    expect(healthy.fetchEarlyCareer).toHaveBeenCalledTimes(1);
  });

  it('stops before downloading feeds when the database rejects the preflight', async () => {
    const fake = createDb({ failPreflight: 'invalid api key' });
    const feed = client('remotive', [posting()]);
    await expect(ingestAggregators(fake.db, { now: NOW, clients: [feed] })).rejects.toThrow('invalid api key');
    expect(feed.fetchEarlyCareer).not.toHaveBeenCalled();
  });

  it('isolates a bad insert without dropping the rest of the batch or marking it verified', async () => {
    const fake = createDb({ failRoleBatch: true, failExternalIds: ['remotive-bad'] });
    const results = await ingestAggregators(fake.db, {
      now: NOW,
      clients: [client('remotive', [
        posting({ externalJobId: 'remotive-bad', applyUrl: 'https://jobs.acme.test/bad' }),
        posting({ externalJobId: 'remotive-ok', applyUrl: 'https://jobs.acme.test/ok' }),
      ])],
    });
    expect(results[0].rolesUpserted).toBe(1);
    expect(results[0].errors.join(' ')).toContain('remotive-bad');
    expect(fake.state.roleUpsertSizes).toEqual([2, 1, 1]);
    expect(fake.state.roles.map((role) => role.external_job_id)).toEqual(['remotive-ok']);
    expect(aggregatorRunSucceeded(results)).toBe(false);
  });

  it('records a verification write failure instead of counting those roles refreshed', async () => {
    const fake = createDb({
      failUpdates: true,
      companies: [{ id: 'co-b', slug: 'acme-labs' }],
      roles: [{
        id: 'role-b', company_id: 'co-b', external_job_id: 'remotive-1',
        apply_url: 'https://jobs.acme.test/intern', source: 'aggregator', listing_status: 'Active',
        title: 'Original title', last_verified_at: '2026-01-01T00:00:00.000Z',
      }],
    });
    const results = await ingestAggregators(fake.db, { now: NOW, clients: [client('remotive', [posting()])] });
    expect(results[0].refreshed).toBe(0);
    expect(results[0].errors[0]).toContain('verify unavailable');
    expect(fake.state.roles[0].last_verified_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('refreshes a repeated listing once when two sources return it', async () => {
    const fake = createDb({
      companies: [{ id: 'co-b', slug: 'acme-labs' }],
      roles: [{
        id: 'role-b', company_id: 'co-b', external_job_id: 'remotive-1',
        apply_url: 'https://jobs.acme.test/intern', source: 'aggregator', listing_status: 'Active',
        title: 'Original title',
      }],
    });
    const results = await ingestAggregators(fake.db, {
      now: NOW,
      clients: [
        client('remotive', [posting()]),
        client('themuse', [posting({ source: 'themuse', externalJobId: 'muse-1' })]),
      ],
    });
    expect(results.map((result) => result.refreshed)).toEqual([1, 0]);
    expect(results[1].duplicatesSkipped).toBe(1);
    expect(fake.state.roleUpdates).toEqual([['role-b']]);
  });

  it('closes listings missing from a completed feed and leaves other sources alone', async () => {
    const fake = createDb({
      companies: [{ id: 'co-b', slug: 'acme-labs' }],
      roles: [
        {
          id: 'role-live', company_id: 'co-b', external_job_id: 'amazon-1',
          apply_url: 'https://www.amazon.jobs/live', source: 'aggregator', listing_status: 'Active',
        },
        {
          id: 'role-old', company_id: 'co-b', external_job_id: 'amazon-9',
          apply_url: 'https://www.amazon.jobs/old', source: 'aggregator', listing_status: 'Active',
        },
        {
          id: 'role-muse', company_id: 'co-b', external_job_id: 'muse-9',
          apply_url: 'https://www.themuse.com/jobs/old', source: 'aggregator', listing_status: 'Active',
        },
      ],
    });
    const results = await ingestAggregators(fake.db, {
      now: NOW,
      clients: [client('amazon', [posting({
        source: 'amazon',
        companyName: 'Amazon',
        externalJobId: 'amazon-1',
        applyUrl: 'https://www.amazon.jobs/live',
      })], true)],
    });
    expect(results[0].closed).toBe(1);
    expect(results[0].errors).toEqual([]);
    expect(fake.state.roles.find((role) => role.id === 'role-old')?.listing_status).toBe('Closed');
    expect(fake.state.roles.find((role) => role.id === 'role-live')?.listing_status).toBe('Active');
    expect(fake.state.roles.find((role) => role.id === 'role-muse')?.listing_status).toBe('Active');
  });

  it('does not close listings when the feed stopped early', async () => {
    const fake = createDb({
      companies: [{ id: 'co-b', slug: 'acme-labs' }],
      roles: [{
        id: 'role-old', company_id: 'co-b', external_job_id: 'amazon-9',
        apply_url: 'https://www.amazon.jobs/old', source: 'aggregator', listing_status: 'Active',
      }],
    });
    const results = await ingestAggregators(fake.db, {
      now: NOW,
      clients: [client('amazon', [], false)],
    });
    expect(results[0].closed).toBe(0);
    expect(fake.state.roles[0].listing_status).toBe('Active');
  });
});
