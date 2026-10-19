import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, RefreshCw, Flag, MapPin } from 'lucide-react';
import { useAdapter } from '../hooks/useAdapter';
import { RequireAdmin } from '../components/RequireAdmin';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingBlock } from '../components/ui/Spinner';
import type { SyncResult } from '../lib/adapter';

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
  const [syncResults, setSyncResults] = useState<SyncResult[] | null>(null);
  const [syncing, setSyncing] = useState(false);

  const pending = useQuery({
    queryKey: ['admin', 'pending'],
    queryFn: () => adapter.listPending!(),
  });
  const reports = useQuery({
    queryKey: ['admin', 'reports'],
    queryFn: () => adapter.listReports!(),
  });

  const moderateCompany = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'Approved' | 'Rejected' }) =>
      adapter.moderateCompany!(id, action),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'pending'] }),
  });
  const moderateRole = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'Approved' | 'Rejected' }) =>
      adapter.moderateRole!(id, action),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'pending'] }),
  });
  const resolveReport = useMutation({
    mutationFn: (id: string) => adapter.resolveReport!(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'reports'] }),
  });

  const runSync = async (companyId?: string) => {
    setSyncing(true);
    try {
      const results = await adapter.sync!(companyId);
      setSyncResults(results);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <Helmet>
        <title>Admin — Launchpad</title>
      </Helmet>
      <h1 className="mb-6 text-2xl font-bold text-navy">Admin Dashboard</h1>

      {/* Sync controls */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-navy">Live ATS Sync</h2>
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => runSync()} disabled={syncing}>
              <RefreshCw className={'h-4 w-4 ' + (syncing ? 'animate-spin' : '')} aria-hidden="true" />
              {syncing ? 'Syncing…' : 'Sync all companies'}
            </Button>
            <p className="text-sm text-slate-500">
              Imports open early-career roles, verifies links, and closes roles removed from live feeds.
            </p>
          </div>
          {syncResults && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-400">
                  <tr>
                    <th className="py-1">Company</th>
                    <th>Imported</th>
                    <th>Updated</th>
                    <th>Closed</th>
                    <th>Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {syncResults.map((r) => (
                    <tr key={r.companyId} className="border-t border-slate-100">
                      <td className="py-1 font-medium text-navy">{r.company}</td>
                      <td>{r.imported}</td>
                      <td>{r.updated}</td>
                      <td>{r.closed}</td>
                      <td className={r.errors.length ? 'text-red-600' : ''}>{r.errors.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      {/* Pending queue */}
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-navy">Pending review</h2>
        {pending.isLoading ? (
          <LoadingBlock />
        ) : (pending.data?.companies.length ?? 0) + (pending.data?.roles.length ?? 0) === 0 ? (
          <EmptyState title="Nothing pending" description="New community submissions will appear here." />
        ) : (
          <div className="space-y-6">
            {pending.data!.companies.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-500">Companies</h3>
                <div className="space-y-2">
                  {pending.data!.companies.map((c) => (
                    <Card key={c.id} className="flex items-center justify-between p-4">
                      <div>
                        <p className="font-medium text-navy">{c.name}</p>
                        <p className="text-sm text-slate-500">
                          {c.companyType} · {c.websiteUrl}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => moderateCompany.mutate({ id: c.id, action: 'Approved' })}>
                          <Check className="h-4 w-4" aria-hidden="true" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => moderateCompany.mutate({ id: c.id, action: 'Rejected' })}>
                          <X className="h-4 w-4" aria-hidden="true" /> Reject
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
            {pending.data!.roles.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-slate-500">Roles</h3>
                <div className="space-y-2">
                  {pending.data!.roles.map((r) => (
                    <Card key={r.id} className="flex items-center justify-between p-4">
                      <div>
                        <p className="font-medium text-navy">{r.title}</p>
                        <p className="text-sm text-slate-500">
                          {r.companyName} · {r.field} · {r.seasons.join(', ')}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => moderateRole.mutate({ id: r.id, action: 'Approved' })}>
                          <Check className="h-4 w-4" aria-hidden="true" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => moderateRole.mutate({ id: r.id, action: 'Rejected' })}>
                          <X className="h-4 w-4" aria-hidden="true" /> Reject
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

      {/* Reports */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-navy">
          <Flag className="h-5 w-5" aria-hidden="true" /> Reported listings
        </h2>
        {reports.isLoading ? (
          <LoadingBlock />
        ) : (reports.data?.filter((r) => !r.resolved).length ?? 0) === 0 ? (
          <EmptyState title="No open reports" />
        ) : (
          <div className="space-y-2">
            {reports.data!
              .filter((r) => !r.resolved)
              .map((r) => (
                <Card key={r.id} className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium text-navy">
                      <Badge tone="muted">{r.reason}</Badge> {r.details}
                    </p>
                    <p className="text-sm text-slate-500">Role {r.roleId}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => runSync()}>
                      <MapPin className="h-4 w-4" aria-hidden="true" /> Re-verify
                    </Button>
                    <Button size="sm" onClick={() => resolveReport.mutate(r.id)}>
                      <Check className="h-4 w-4" aria-hidden="true" /> Resolve
                    </Button>
                  </div>
                </Card>
              ))}
          </div>
        )}
      </section>
    </div>
  );
}
