import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { Trash2, ExternalLink, CalendarClock, Plus } from 'lucide-react';
import { useSaved } from '../hooks/useSaved';
import { useApplications } from '../hooks/useApplications';
import { useAuth } from '../hooks/useAuth';
import { SignInForm } from '../components/auth/SignInForm';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingBlock } from '../components/ui/Spinner';
import { RoleCard } from '../components/cards/RoleCard';
import { followUpState } from '../lib/followUp';
import { APPLICATION_STATUSES, type Application, type ApplicationStatus } from '../lib/adapter/types';

type Tab = 'saved' | 'applications';

export function MyApplications() {
  const { saved, savedIds, toggleSave, isLoading: savedLoading } = useSaved();
  const { applications, isLoading: appsLoading, upsert, remove } = useApplications();
  const { user, isCloud } = useAuth();
  const [tab, setTab] = useState<Tab>('saved');
  const [adding, setAdding] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);

  return (
    <div>
      <Helmet>
        <title>My Applications — Launchpad</title>
      </Helmet>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-navy">My Applications</h1>
        {user && <span className="text-sm text-slate-500">Synced to {user.email}</span>}
      </div>

      {/* Anonymous users: offer inline sign-in to sync, without blocking the page. */}
      {isCloud && !user && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-gray-bg p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600">
              Your saved roles and applications are stored on this device. Sign in to sync them across devices.
            </p>
            <Button variant="outline" size="sm" onClick={() => setShowSignIn((v) => !v)}>
              {showSignIn ? 'Hide' : 'Sign in to sync'}
            </Button>
          </div>
          {showSignIn && (
            <div className="mt-4 max-w-md">
              <SignInForm compact />
            </div>
          )}
        </div>
      )}

      <div className="mb-6 inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'saved'}
          onClick={() => setTab('saved')}
          className={'rounded-md px-4 py-1.5 text-sm font-medium ' + (tab === 'saved' ? 'bg-navy text-white' : 'text-slate-600')}
        >
          Saved Opportunities ({saved.length})
        </button>
        <button
          role="tab"
          aria-selected={tab === 'applications'}
          onClick={() => setTab('applications')}
          className={'rounded-md px-4 py-1.5 text-sm font-medium ' + (tab === 'applications' ? 'bg-navy text-white' : 'text-slate-600')}
        >
          Tracked Applications ({applications.length})
        </button>
      </div>

      {tab === 'saved' ? (
        savedLoading ? (
          <LoadingBlock />
        ) : saved.length === 0 ? (
          <EmptyState
            title="No saved opportunities yet"
            description="Save roles while browsing to keep them here."
            action={
              <Link to="/browse">
                <Button variant="outline">Browse opportunities</Button>
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {saved.map((s) =>
              s.role ? (
                <RoleCard key={s.roleId} role={s.role} saved={savedIds.has(s.roleId)} onToggleSave={toggleSave} />
              ) : (
                <Card key={s.roleId} className="text-sm text-slate-500">
                  Saved role is no longer available.
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => toggleSave(s.roleId)}>
                    Remove
                  </Button>
                </Card>
              ),
            )}
          </div>
        )
      ) : (
        <div>
          <div className="mb-4">
            <Button variant="outline" size="sm" onClick={() => setAdding((v) => !v)}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Add manual application
            </Button>
          </div>
          {adding && (
            <ApplicationForm
              onSubmit={(input) => {
                upsert(input);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          )}
          {appsLoading ? (
            <LoadingBlock />
          ) : applications.length === 0 ? (
            <EmptyState
              title="No tracked applications yet"
              description="Track an application directly from any opportunity card, or add one manually above."
              action={
                <Link to="/browse">
                  <Button variant="outline">Browse opportunities</Button>
                </Link>
              }
            />
          ) : (
            <StatusBoard applications={applications} onStatusChange={upsert} onRemove={remove} />
          )}
        </div>
      )}
    </div>
  );
}

function StatusBoard({
  applications,
  onStatusChange,
  onRemove,
}: {
  applications: Application[];
  onStatusChange: (input: import('../lib/adapter/types').ApplicationInput) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {APPLICATION_STATUSES.map((status) => {
        const items = applications.filter((a) => a.status === status);
        return (
          <section key={status} aria-label={status}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-navy">
              {status}
              <Badge tone="muted">{items.length}</Badge>
            </h2>
            <div className="space-y-3">
              {items.map((a) => (
                <ApplicationCard key={a.id} app={a} onStatusChange={onStatusChange} onRemove={onRemove} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ApplicationCard({
  app,
  onStatusChange,
  onRemove,
}: {
  app: Application;
  onStatusChange: (input: import('../lib/adapter/types').ApplicationInput) => void;
  onRemove: (id: string) => void;
}) {
  const fu = followUpState(app.followUpDate);
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-navy">{app.roleTitle}</p>
          <p className="truncate text-sm text-slate-500">{app.companyName}</p>
        </div>
        <button onClick={() => onRemove(app.id)} aria-label="Remove application" className="text-slate-400 hover:text-red-500">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {app.followUpDate && (
        <p
          className={
            'mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ' +
            (fu === 'overdue'
              ? 'bg-red-100 text-red-700'
              : fu === 'today'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-slate-100 text-slate-600')
          }
        >
          <CalendarClock className="h-3 w-3" aria-hidden="true" />
          {fu === 'overdue' ? 'Follow-up overdue' : fu === 'today' ? 'Follow up today' : 'Follow up'} ·{' '}
          {new Date(app.followUpDate).toLocaleDateString()}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <label className="text-xs text-slate-500">
          <span className="sr-only">Status for {app.roleTitle}</span>
          <select
            value={app.status}
            onChange={(e) =>
              onStatusChange({
                roleId: app.roleId,
                companyName: app.companyName,
                roleTitle: app.roleTitle,
                status: e.target.value as ApplicationStatus,
              })
            }
            className="rounded border border-slate-300 px-2 py-1 text-xs outline-none focus:border-cyan"
          >
            {APPLICATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {app.applicationUrl && (
          <a
            href={app.applicationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-cyan hover:text-navy"
          >
            Open <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        )}
      </div>
    </Card>
  );
}

function ApplicationForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (input: import('../lib/adapter/types').ApplicationInput) => void;
  onCancel: () => void;
}) {
  const [companyName, setCompanyName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [status, setStatus] = useState<ApplicationStatus>('Applied');
  const [applicationUrl, setApplicationUrl] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');

  return (
    <Card className="mb-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!companyName || !roleTitle) return;
          onSubmit({
            companyName,
            roleTitle,
            status,
            applicationUrl: applicationUrl || null,
            followUpDate: followUpDate || null,
          });
        }}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <input required value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company name" className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan" />
        <input required value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="Role title" className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan" />
        <select value={status} onChange={(e) => setStatus(e.target.value as ApplicationStatus)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan">
          {APPLICATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan" aria-label="Follow-up date" />
        <input value={applicationUrl} onChange={(e) => setApplicationUrl(e.target.value)} placeholder="Application URL (optional)" className="sm:col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan" />
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit">Save application</Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
