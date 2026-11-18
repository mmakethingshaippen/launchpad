import { describe, expect, it } from 'vitest';
import { aggregatorIngestOutcome, aggregatorVerificationOutcome, atsDownloadsOutcome, employerConfirmationOutcome, workdayVerificationOutcome } from './syncHealth';
import type { AggregatorResult } from './aggregators/ingest';
import type { StaleSweepResult } from './aggregators/staleSweep';
import type { WorkdayRecheckResult, EmployerConfirmResult } from './verifyChecks';

const feed = (changes: Partial<AggregatorResult> = {}): AggregatorResult => ({
  source: 'themuse', coverage: 'complete', errors: [], refreshWriteFailures: 0, ...changes,
} as AggregatorResult);
const sweep = (changes: Partial<StaleSweepResult> = {}): StaleSweepResult => ({
  pagination: { complete: true, pages: 2, stopReason: 'empty page reached' }, summaryPersisted: true,
  cycleComplete: true, backlog: 0, writeFailures: 0, hostBlockedSkipped: 0, deferred: 0, ...changes,
} as StaleSweepResult);

describe('sync execution versus data coverage', () => {
  it('treats explicit Muse refusal as handled incomplete coverage without changing the input', () => {
    const source = feed({ coverage: 'blocked', errors: ['Access challenge from themuse (HTTP 403); unread jobs were not verified.'] });
    const before = JSON.stringify(source);
    expect(aggregatorIngestOutcome([source, feed({ source: 'himalayas' })])).toMatchObject({ status: 'incomplete' });
    expect(JSON.stringify(source)).toBe(before);
  });

  it('does not hide write errors alongside a blocked feed or mislabel unknown failures', () => {
    expect(aggregatorIngestOutcome([feed({ coverage: 'blocked', errors: ['Access challenge from themuse', 'Batch write: database unavailable'] })])).toBe(false);
    expect(aggregatorIngestOutcome([feed({ refreshWriteFailures: 1 })])).toBe(false);
    expect(aggregatorIngestOutcome([feed({ coverage: 'failed', errors: ['Feed fetch: unexpected programming error'] })])).toBe(false);
    expect(aggregatorIngestOutcome([feed()])).toBe(true);
  });

  it('keeps unresolved jobs incomplete even if every ready request was attempted', () => {
    expect(aggregatorVerificationOutcome(sweep({ backlog: 1238 }))).toMatchObject({ status: 'incomplete' });
    expect(aggregatorVerificationOutcome(sweep({ cycleComplete: false, backlog: 1238, hostBlockedSkipped: 1199 }))).toMatchObject({ status: 'incomplete' });
    expect(aggregatorVerificationOutcome(sweep())).toBe(true);
  });

  it('fails incomplete database scans, lost writes, and missing run summaries', () => {
    expect(aggregatorVerificationOutcome(sweep({ pagination: { complete: false, pages: 1, stopReason: 'database error' } }))).toBe(false);
    expect(aggregatorVerificationOutcome(sweep({ writeFailures: 1 }))).toBe(false);
    expect(aggregatorVerificationOutcome(sweep({ summaryPersisted: false }))).toBe(false);
  });

  it('distinguishes a blocked ATS fetch from a write failure or programming error', () => {
    const result = { company: 'Example', companyId: 'c1', imported: 0, updated: 0, closed: 0,
      coverage: { status: 'blocked' as const, reason: 'access-challenge: blocked:cloudflare-challenge' },
      errors: ['Workday example: access-challenge: blocked:cloudflare-challenge on the first page'] };
    expect(atsDownloadsOutcome([result])).toMatchObject({ status: 'incomplete' });
    expect(atsDownloadsOutcome([{ ...result, errors: ['bulk upsert: database error'] }])).toBe(false);
    expect(atsDownloadsOutcome([{ ...result, errors: ['Cannot read properties of undefined'] }])).toBe(false);
    expect(atsDownloadsOutcome([{ ...result, coverage: { status: 'blocked', reason: '' }, errors: ['Cannot read properties of undefined'] }])).toBe(false);
    expect(atsDownloadsOutcome([{ ...result, coverage: { status: 'partial', reason: 'page limit' }, errors: [] }])).toMatchObject({ status: 'incomplete' });
  });

  it('keeps employer and Workday access problems distinct from database failures', () => {
    const workday = { coverage: { complete: true }, writeFailures: 0, clean: false, unmapped: 10 } as WorkdayRecheckResult;
    const employer = { coverage: { complete: true }, writeFailures: 0, clean: false, boardsFailed: 2 } as EmployerConfirmResult;
    expect(workdayVerificationOutcome(workday)).toMatchObject({ status: 'incomplete' });
    expect(employerConfirmationOutcome(employer)).toMatchObject({ status: 'incomplete' });
    expect(workdayVerificationOutcome({ ...workday, writeFailures: 1 })).toBe(false);
    expect(employerConfirmationOutcome({ ...employer, coverage: { complete: false, pages: 0, stopReason: 'database error' } })).toBe(false);
  });
});
