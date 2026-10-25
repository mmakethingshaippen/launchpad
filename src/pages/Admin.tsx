
import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Check,
  X,
  RefreshCw,
  Flag,
  MapPin,
} from 'lucide-react';

import { useAdapter } from '../hooks/useAdapter';
import { RequireAdmin } from '../components/RequireAdmin';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingBlock } from '../components/ui/Spinner';
import type { SyncResult } from '../lib/adapter';

// Include optional backend warnings without changing adapter.ts.
type DisplaySyncResult = SyncResult & {
  warnings?: string[];
};

const BATCH_SIZE = 8;
const MAX_ATTEMPTS = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function Admin() {
  return (
    <RequireAdmin>
      <AdminDashboard />
    </RequireAdmin>
  );
}

function AdminDashboard() {
  const adapter = useAdapter();
  const qc = useQueryClient();

  const [syncResults, setSyncResults] =
    useState<DisplaySyncResult[] | null>(null);

  const [syncing, setSyncing] = useState(false);

  const [syncError, setSyncError] =
    useState<string | null>(null);

  const [syncProgress, setSyncProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);

  const pending = useQuery({
    queryKey: ['admin', 'pending'],
    queryFn: () => adapter.listPending!(),
  });

  const reports = useQuery({
    queryKey: ['admin', 'reports'],
    queryFn: () => adapter.listReports!(),
  });

  const moderateCompany = useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: 'Approved' | 'Rejected';
    }) => adapter.moderateCompany!(id, action),

    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['admin', 'pending'],
      }),
  });

  const moderateRole = useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: 'Approved' | 'Rejected';
    }) => adapter.moderateRole!(id, action),

    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['admin', 'pending'],
      }),
  });

  const resolveReport = useMutation({
    mutationFn: (id: string) =>
      adapter.resolveReport!(id),

    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['admin', 'reports'],
      }),
  });

  const runSync = async (companyId?: string) => {
    if (syncing) return;

    setSyncing(true);
    setSyncError(null);
    setSyncResults(null);
    setSyncProgress(
      companyId ? null : { completed: 0, total: 0 },
    );

    const results = new Map<string, DisplaySyncResult>();
    const failed = new Map<string, DisplaySyncResult>();

    try {
      if (!adapter.syncBatch) {
        const legacy = await adapter.sync!(companyId);
        setSyncResults(legacy);
        return;
      }

      const request = async (
        options: Parameters<
          NonNullable<typeof adapter.syncBatch>
        >[0],
      ) => {
        let error: unknown;

        for (
          let attempt = 1;
          attempt <= MAX_ATTEMPTS;
          attempt++
        ) {
          try {
            return await adapter.syncBatch!(options);
          } catch (caught) {
            error = caught;

            if (attempt < MAX_ATTEMPTS) {
              await delay(1000 * attempt * attempt);
            }
          }
        }

        throw error instanceof Error
          ? error
          : new Error('Sync request failed');
      };

      let offset = 0;
      let done = false;

      while (!done) {
        const batch = await request({
          companyId,
          offset,
          limit: BATCH_SIZE,
          timeBudgetMs: 45000,
        });

        for (const result of batch.results) {
          results.set(result.companyId, result);

          if (result.errors.length > 0) {
            failed.set(result.companyId, result);
          } else {
            failed.delete(result.companyId);
          }
        }

        setSyncResults([...results.values()]);

        done = batch.done;

        const completed = done
          ? batch.totalCompanies
          : batch.nextOffset ??
            offset + batch.syncedCount;

        setSyncProgress({
          completed,
          total: batch.totalCompanies,
        });

        if (!done) {
          if (
            batch.nextOffset == null ||
            batch.nextOffset <= offset
          ) {
            throw new Error(
              'Server returned no forward progress.',
            );
          }

          offset = batch.nextOffset;

          // Small gap between batches reduces API load.
          await delay(500);
        }
      }

      // Retry companies that returned sync errors.
      for (
        let attempt = 2;
        attempt <= MAX_ATTEMPTS;
        attempt++
      ) {
        if (failed.size === 0) break;

        const retryIds = [...failed.keys()];

        for (const id of retryIds) {
          await delay(1000 * (attempt - 1));

          try {
            const retryBatch = await request({
              companyId: id,
              offset: 0,
              limit: 1,
              timeBudgetMs: 45000,
            });

            const latest = retryBatch.results[0];

            if (!latest) {
              continue;
            }

            results.set(id, latest);

            if (latest.errors.length === 0) {
              failed.delete(id);
            } else {
              failed.set(id, latest);
            }

            setSyncResults([...results.values()]);
          } catch (error) {
            console.error(
              'Company retry failed:',
              id,
              error,
            );
          }
        }
      }

      setSyncResults([...results.values()]);

      if (failed.size > 0) {
        setSyncError(
          `${failed.size} companies still have errors. ` +
          'See the results below.',
        );
      }

      await qc.invalidateQueries();
    } catch (error) {
      setSyncResults([...results.values()]);

      setSyncError(
        error instanceof Error
          ? error.message
          : 'Synchronization failed.',
      );
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const summary = syncResults
    ? {
        total: syncResults.length,
        succeeded: syncResults.filter(
          (r) => r.errors.length === 0,
        ).length,
        failed: syncResults.filter(
          (r) => r.errors.length > 0,
        ).length,
        imported: syncResults.reduce(
          (n, r) => n + r.imported,
          0,
        ),
        updated: syncResults.reduce(
          (n, r) => n + r.updated,
          0,
        ),
        closed: syncResults.reduce(
          (n, r) => n + r.closed,
          0,
        ),
      }
    : null;

  return (
    <div>
      <Helmet>
        <title>Admin — Launchpad</title>
      </Helmet>

      <h1 className="mb-6 text-2xl font-bold text-navy">
        Admin Dashboard
      </h1>

      {/* Live sync controls */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-navy">
          Live ATS Sync
        </h2>

        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => runSync()}
              disabled={syncing}
            >
              <RefreshCw
                className={
                  'h-4 w-4 ' +
                  (syncing ? 'animate-spin' : '')
                }
                aria-hidden="true"
              />

              {syncing
                ? 'Syncing…'
                : 'Sync all companies'}
            </Button>

            <p className="text-sm text-slate-500">
              Refreshes configured ATS sources in
              batches. Keep this page open until the
              synchronization finishes.
            </p>
          </div>

          {/* Progress indicator */}
          {syncing && syncProgress && (
            <div
              className="mt-4"
              role="status"
              aria-live="polite"
            >
              <p className="text-sm font-medium text-navy">
                Companies processed:{' '}
                {syncProgress.completed.toLocaleString()}
                {' / '}
                {syncProgress.total
                  ? syncProgress.total.toLocaleString()
                  : '…'}
              </p>

              {syncProgress.total > 0 && (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full bg-blue-600 transition-all"
                    style={{
                      width: `${
                        (syncProgress.completed /
                          syncProgress.total) *
                        100
                      }%`,
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Error display */}
          {syncError && (
            <p
              className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
              role="alert"
            >
              {syncError}
            </p>
          )}

          {/* Sync summary */}
          {summary && (
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
              <div>
                <strong>{summary.total}</strong>
                <p>Companies processed</p>
              </div>

              <div>
                <strong>{summary.succeeded}</strong>
                <p>Successful</p>
              </div>

              <div>
                <strong>{summary.failed}</strong>
                <p>With errors</p>
              </div>

              <div>
                <strong>{summary.imported}</strong>
                <p>Jobs imported</p>
              </div>

              <div>
                <strong>{summary.updated}</strong>
                <p>Jobs updated</p>
              </div>

              <div>
                <strong>{summary.closed}</strong>
                <p>Jobs closed</p>
              </div>
            </div>
          )}

          {/* Per-company results */}
          {syncResults && syncResults.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-400">
                  <tr>
                    <th className="py-2">Company</th>
                    <th>Imported</th>
                    <th>Updated</th>
                    <th>Closed</th>
                    <th>Status</th>
                  </tr>
                </thead>

                <tbody>
                  {syncResults.map((r) => (
                    <tr
                      key={r.companyId}
                      className="border-t border-slate-100"
                    >
                      <td className="py-2 font-medium text-navy">
                        {r.company || r.companyId}
                      </td>

                      <td>{r.imported}</td>
                      <td>{r.updated}</td>
                      <td>{r.closed}</td>

                      <td>
                        {r.errors.length === 0 ? (
                          <span className="text-green-600">
                            Success
                          </span>
                        ) : (
                          <div className="text-red-600">
                            <p>
                              {r.errors.length} error(s)
                            </p>

                            <ul className="mt-1 max-w-md space-y-1 text-xs">
                              {r.errors.map(
                                (error: string, index: number) => (
                                  <li key={index}>
                                    {error}
                                  </li>
                                ),
                              )}
                            </ul>
                          </div>
                        )}

                        {(r.warnings ?? []).length > 0 && (
                          <ul className="mt-1 text-xs text-amber-700">
                            {r.warnings?.map(
                              (warning: string, index: number) => (
                                <li key={index}>
                                  {warning}
                                </li>
                              ),
                            )}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      {/* Pending moderation queue */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-navy">
          Pending review
        </h2>

        {pending.isLoading ? (
          <LoadingBlock />
        ) : (pending.data?.companies.length ?? 0) +
            (pending.data?.roles.length ?? 0) ===
          0 ? (
          <EmptyState
            title="Nothing pending"
            description="New community submissions will appear here."
          />
        ) : (
          <div className="space-y-6">
            {pending.data!.companies.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-500">
                  Companies
                </h3>

                <div className="space-y-2">
                  {pending.data!.companies.map((c) => (
                    <Card
                      key={c.id}
                      className="flex items-center justify-between p-4"
                    >
                      <div>
                        <p className="font-medium text-navy">
                          {c.name}
                        </p>

                        <p className="text-sm text-slate-500">
                          {c.companyType} · {c.websiteUrl}
                        </p>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            moderateCompany.mutate({
                              id: c.id,
                              action: 'Approved',
                            })
                          }
                        >
                          <Check
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                          Approve
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            moderateCompany.mutate({
                              id: c.id,
                              action: 'Rejected',
                            })
                          }
                        >
                          <X
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                          Reject
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {pending.data!.roles.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-500">
                  Roles
                </h3>

                <div className="space-y-2">
                  {pending.data!.roles.map((r) => (
                    <Card
                      key={r.id}
                      className="flex items-center justify-between p-4"
                    >
                      <div>
                        <p className="font-medium text-navy">
                          {r.title}
                        </p>

                        <p className="text-sm text-slate-500">
                          {r.companyName} · {r.field} ·{' '}
                          {r.seasons.join(', ')}
                        </p>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() =>
                            moderateRole.mutate({
                              id: r.id,
                              action: 'Approved',
                            })
                          }
                        >
                          <Check
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                          Approve
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            moderateRole.mutate({
                              id: r.id,
                              action: 'Rejected',
                            })
                          }
                        >
                          <X
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                          Reject
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Reported listings */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-navy">
          <Flag className="h-5 w-5" />
          Reported listings
        </h2>

        {reports.isLoading ? (
          <LoadingBlock />
        ) : (
          <div className="space-y-2">
            {reports.data
              ?.filter((r) => !r.resolved)
              .map((r) => (
                <Card
                  key={r.id}
                  className="flex items-center justify-between p-4"
                >
                  <div>
                    <p className="font-medium text-navy">
                      <Badge tone="muted">
                        {r.reason}
                      </Badge>{' '}
                      {r.details}
                    </p>

                    <p className="text-sm text-slate-500">
                      Role {r.roleId}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => runSync()}
                      disabled={syncing}
                    >
                      <MapPin className="h-4 w-4" />
                      Re-verify
                    </Button>

                    <Button
                      size="sm"
                      onClick={() =>
                        resolveReport.mutate(r.id)
                      }
                    >
                      <Check className="h-4 w-4" />
                      Resolve
                    </Button>
                  </div>
                </Card>
              ))}

            {(reports.data?.filter((r) => !r.resolved)
              .length ?? 0) === 0 && (
              <EmptyState title="No open reports" />
            )}
          </div>
        )}
      </section>
    </div>
  );
}
