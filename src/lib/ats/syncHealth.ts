import type { AggregatorResult } from './aggregators/ingest';
import type { StaleSweepResult } from './aggregators/staleSweep';
import type { SyncResult } from './sync';
import type { EmployerConfirmResult, WorkdayRecheckResult } from './verifyChecks';
import type { StageRunResult } from './pipeline';

const incomplete = (reason: string): StageRunResult => ({ status: 'incomplete', reason });

/** Only explicitly classified availability problems may avoid a hard failure. */
export function aggregatorIngestOutcome(results: AggregatorResult[]): StageRunResult {
  const outstanding: string[] = [];
  for (const result of results) {
    if (result.refreshWriteFailures) return false;
    const challengeOnly = result.coverage === 'blocked' && result.errors.every(error => error.startsWith('Access challenge from '));
    if (result.errors.length && !challengeOnly) return false;
    if (result.coverage === 'complete' || result.coverage === 'disabled') continue;
    if (result.coverage !== 'blocked' && result.coverage !== 'partial') return false;
    outstanding.push(`${result.source}: ${result.coverage}`);
  }
  return outstanding.length ? incomplete(outstanding.join('; ')) : true;
}

export function atsDownloadsOutcome(results: SyncResult[]): StageRunResult {
  const outstanding: string[] = [];
  for (const result of results) {
    const coverage = result.coverage;
    if (result.errors.length) {
      // A first-page access challenge is wrapped with the tenant name. Never
      // excuse persistence, cancellation or unclassified programming errors.
      const accessOnly = coverage?.status === 'blocked' && Boolean(coverage.reason.trim()) && result.errors.every(error =>
        error.includes(coverage.reason) && !/^(?:bulk upsert:|upsert |closeMissing:|Sync stopped)/.test(error));
      if (!accessOnly) return false;
    }
    if (coverage?.status === 'blocked' || coverage?.status === 'partial') outstanding.push(`${result.company}: ${coverage.status}`);
  }
  return outstanding.length ? incomplete(outstanding.join('; ')) : true;
}

export function aggregatorVerificationOutcome(result: StaleSweepResult): StageRunResult {
  if (!result.pagination.complete || result.writeFailures || !result.summaryPersisted) return false;
  return result.cycleComplete && result.backlog === 0 ? true :
    incomplete(`${result.backlog} jobs remain unverified; ${result.hostBlockedSkipped} skipped on blocked hosts; ${result.deferred} deferred. Retry dates are preserved.`);
}

export function workdayVerificationOutcome(result: WorkdayRecheckResult): StageRunResult {
  if (!result.coverage.complete || result.writeFailures) return false;
  return result.clean && !result.unmapped ? true : incomplete('Some Workday jobs are blocked, unmapped or waiting for another check.');
}

export function employerConfirmationOutcome(result: EmployerConfirmResult): StageRunResult {
  if (!result.coverage.complete || result.writeFailures) return false;
  return result.clean ? true : incomplete(`${result.boardsFailed} employer boards could not be read; their jobs remain unverified.`);
}
