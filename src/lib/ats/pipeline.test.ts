// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runStages, type PipelineStage } from './pipeline';

describe('isolated pipeline stages', () => {
  it('runs aggregator ingestion and verification even when an ATS stage throws', async () => {
    const ran: string[] = [];
    const stages: PipelineStage[] = [
      { name: 'ats-sync', group: 'ats', run: async () => { ran.push('ats-sync'); throw new Error('ATS exploded'); } },
      { name: 'aggregator-ingest', group: 'aggregators', run: async () => { ran.push('aggregator-ingest'); return true; } },
      { name: 'aggregator-verify', group: 'aggregators', run: async () => { ran.push('aggregator-verify'); return true; } },
    ];
    const outcomes = await runStages(stages);
    expect(ran).toEqual(['ats-sync', 'aggregator-ingest', 'aggregator-verify']);
    expect(outcomes.map((o) => o.status)).toEqual(['threw', 'succeeded', 'succeeded']);
    expect(outcomes[0].error).toBe('ATS exploded');
  });

  it('runs aggregator verification when an ATS stage hangs past its timeout', async () => {
    const ran: string[] = [];
    const stages: PipelineStage[] = [
      { name: 'ats-sync', group: 'ats', timeoutMs: 20, run: () => new Promise<boolean>(() => undefined) },
      { name: 'aggregator-verify', group: 'aggregators', run: async () => { ran.push('aggregator-verify'); return true; } },
    ];
    const outcomes = await runStages(stages);
    expect(ran).toEqual(['aggregator-verify']);
    expect(outcomes[0]).toMatchObject({ status: 'timed-out', ok: false });
    expect(outcomes[1].ok).toBe(true);
  });

  it('still verifies when aggregator ingestion fails, and reports that stage as not clean', async () => {
    const ran: string[] = [];
    const outcomes = await runStages([
      { name: 'aggregator-ingest', group: 'aggregators', run: async () => { throw new Error('feed down'); } },
      { name: 'aggregator-verify', group: 'aggregators', run: async () => { ran.push('verify'); return true; } },
    ]);
    expect(ran).toEqual(['verify']);
    expect(outcomes.map((o) => o.ok)).toEqual([false, true]);
  });

  it('reports a stage that returns false as failed without stopping later stages', async () => {
    const outcomes = await runStages([
      { name: 'a', group: 'ats', run: async () => false },
      { name: 'b', group: 'aggregators', run: async () => true },
    ]);
    expect(outcomes.map((o) => o.status)).toEqual(['failed', 'succeeded']);
  });

  it('does not crash when an abandoned stage rejects after its timeout', async () => {
    const outcomes = await runStages([
      {
        name: 'slow', group: 'ats', timeoutMs: 10,
        run: () => new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error('late')), 30)),
      },
      { name: 'next', group: 'aggregators', run: async () => { await new Promise((r) => setTimeout(r, 50)); return true; } },
    ]);
    expect(outcomes.map((o) => o.status)).toEqual(['timed-out', 'succeeded']);
  });
});
