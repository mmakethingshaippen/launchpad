/**
 * Server-side only. Runs independent pipeline stages so one stage's failure,
 * exception or hang cannot stop the stages after it.
 *
 * Aggregator ingestion + fallback verification and slow ATS processing are
 * separate groups. Callers order aggregator stages first and run them in their
 * own CI job; this runner is the second line of defence when both groups share
 * a process (for example a local full run).
 */

export type StageGroup = 'aggregators' | 'ats';
/** Handled source outages are distinct from program/database failures. */
export type StageRunResult = boolean | { status: 'incomplete'; reason: string };

export interface PipelineStage {
  name: string;
  group: StageGroup;
  /** Resolves true on a clean run, false when the stage finished with recorded problems. */
  run: () => Promise<StageRunResult>;
  /** The stage is abandoned (not cancelled) after this long; later stages still run. */
  timeoutMs?: number;
}

export type StageStatus = 'succeeded' | 'incomplete' | 'failed' | 'threw' | 'timed-out';

export interface StageOutcome {
  name: string;
  group: StageGroup;
  status: StageStatus;
  ok: boolean;
  error?: string;
  durationMs: number;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function runStages(
  stages: PipelineStage[],
  log: (message: string) => void = () => undefined,
): Promise<StageOutcome[]> {
  const outcomes: StageOutcome[] = [];
  for (const stage of stages) {
    const started = Date.now();
    let status: StageStatus;
    let error: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const work = stage.run();
      const timeout = stage.timeoutMs === undefined
        ? null
        : new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), stage.timeoutMs);
        });
      const settled = timeout ? await Promise.race([work, timeout]) : await work;
      if (settled === 'timeout') {
        status = 'timed-out';
        error = `Stage exceeded ${stage.timeoutMs}ms and was abandoned.`;
        // The abandoned promise may still reject later; never let that crash the process.
        work.catch(() => undefined);
      } else {
        if (typeof settled === 'object') {
          status = 'incomplete';
          error = settled.reason;
        } else status = settled ? 'succeeded' : 'failed';
      }
    } catch (caught) {
      status = 'threw';
      error = errorMessage(caught);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const outcome: StageOutcome = {
      name: stage.name,
      group: stage.group,
      status,
      ok: status === 'succeeded',
      error,
      durationMs: Date.now() - started,
    };
    outcomes.push(outcome);
    log(
      `Stage ${stage.name} [${stage.group}]: ${status}` +
      `${error ? ` (${error})` : ''} in ${(outcome.durationMs / 1000).toFixed(1)}s`,
    );
  }
  return outcomes;
}

export function hasFatalStages(outcomes: StageOutcome[]): boolean {
  return outcomes.some(outcome => !outcome.ok && outcome.status !== 'incomplete');
}
