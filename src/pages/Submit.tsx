import { useState, type FormEvent } from 'react';
import { Helmet } from 'react-helmet-async';
import { CheckCircle2 } from 'lucide-react';
import { z } from 'zod';
import { useAdapter } from '../hooks/useAdapter';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { companyFormSchema, roleFormSchema } from '../lib/submitSchemas';
import {
  FIELDS,
  DEGREE_LEVELS,
  SEASONS,
  OPPORTUNITY_TYPES,
  WORK_ARRANGEMENTS,
  WORK_SCHEDULES,
  COMPENSATION_STATUSES,
} from '../lib/adapter/types';
import type { CompanyFormA, RoleFormB } from '../lib/adapter';

type Errors = Record<string, string>;

function firstErrors(err: z.ZodError): Errors {
  const flat = err.flatten();
  const out: Errors = {};
  for (const [k, v] of Object.entries(flat.fieldErrors)) {
    if (v && v[0]) out[k] = v[0];
  }
  return out;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-navy">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan';

export function Submit() {
  const [tab, setTab] = useState<'company' | 'role'>('company');

  return (
    <div className="mx-auto max-w-3xl">
      <Helmet>
        <title>Submit an Opportunity — Launchpad</title>
      </Helmet>
      <h1 className="mb-2 text-2xl font-bold text-navy">Submit an Opportunity</h1>
      <p className="mb-6 text-sm text-slate-500">
        Submissions are reviewed by our team before appearing publicly. Thanks for helping other students.
      </p>

      <div className="mb-6 inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="tablist">
        <button role="tab" aria-selected={tab === 'company'} onClick={() => setTab('company')} className={'rounded-md px-4 py-1.5 text-sm font-medium ' + (tab === 'company' ? 'bg-navy text-white' : 'text-slate-600')}>
          Suggest a Company
        </button>
        <button role="tab" aria-selected={tab === 'role'} onClick={() => setTab('role')} className={'rounded-md px-4 py-1.5 text-sm font-medium ' + (tab === 'role' ? 'bg-navy text-white' : 'text-slate-600')}>
          Post a Role
        </button>
      </div>

      {tab === 'company' ? <CompanyForm /> : <RoleForm />}
    </div>
  );
}

function CheckboxRow<T extends string>({ options, selected, onToggle }: { options: readonly T[]; selected: T[]; onToggle: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label key={o} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-sm">
          <input type="checkbox" checked={selected.includes(o)} onChange={() => onToggle(o)} className="h-4 w-4 rounded border-slate-300 text-cyan focus:ring-cyan" />
          {o}
        </label>
      ))}
    </div>
  );
}

function CompanyForm() {
  const adapter = useAdapter();
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const [fields, setFields] = useState<string[]>([]);
  const [degreeLevels, setDegreeLevels] = useState<string[]>([]);
  const [honeypot, setHoneypot] = useState('');

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = {
      name: String(fd.get('name') ?? ''),
      websiteUrl: String(fd.get('websiteUrl') ?? ''),
      careersUrl: String(fd.get('careersUrl') ?? ''),
      description: String(fd.get('description') ?? ''),
      fields,
      companyType: String(fd.get('companyType') ?? 'Startup'),
      degreeLevels,
      city: String(fd.get('city') ?? ''),
      atsProvider: (String(fd.get('atsProvider') ?? 'none') || 'none') as 'greenhouse' | 'lever' | 'ashby' | 'none',
      atsBoardToken: String(fd.get('atsBoardToken') ?? ''),
      sourceUrl: String(fd.get('sourceUrl') ?? ''),
      website_hp: honeypot,
    };

    // Honeypot: silently succeed without persisting (Req 14.5).
    if (honeypot) {
      setSubmitted(true);
      return;
    }

    const parsed = companyFormSchema.safeParse(raw);
    if (!parsed.success) {
      setErrors(firstErrors(parsed.error));
      return;
    }
    setErrors({});
    const payload: CompanyFormA = {
      name: raw.name,
      websiteUrl: raw.websiteUrl,
      careersUrl: raw.careersUrl,
      description: raw.description,
      fields,
      companyType: raw.companyType,
      degreeLevels,
      locations: raw.city ? [{ city: raw.city }] : [],
      atsProvider: raw.atsProvider,
      atsBoardToken: raw.atsBoardToken || undefined,
      sourceUrls: raw.sourceUrl ? [raw.sourceUrl] : undefined,
    };
    await adapter.submitCompany(payload);
    setSubmitted(true);
  };

  if (submitted) return <SuccessCard what="company" onAgain={() => setSubmitted(false)} />;

  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {/* honeypot: visually hidden, not a real field */}
        <input type="text" name="website_hp" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

        <Field label="Company name" error={errors.name}>
          <input name="name" className={inputCls} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Website URL" error={errors.websiteUrl}>
            <input name="websiteUrl" placeholder="https://" className={inputCls} />
          </Field>
          <Field label="Careers URL" error={errors.careersUrl}>
            <input name="careersUrl" placeholder="https://" className={inputCls} />
          </Field>
        </div>
        <Field label="Description" error={errors.description}>
          <textarea name="description" rows={3} className={inputCls} />
        </Field>
        <Field label="Fields" error={errors.fields}>
          <CheckboxRow options={FIELDS} selected={fields as never} onToggle={(v) => setFields((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company type" error={errors.companyType}>
            <select name="companyType" className={inputCls} defaultValue="Startup">
              <option>Startup</option>
              <option>Established Company</option>
              <option>Other / Unknown</option>
            </select>
          </Field>
          <Field label="City (HQ)">
            <input name="city" className={inputCls} />
          </Field>
        </div>
        <Field label="Eligibility (degree levels)" error={errors.degreeLevels}>
          <CheckboxRow options={DEGREE_LEVELS} selected={degreeLevels as never} onToggle={(v) => setDegreeLevels((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ATS provider (optional)">
            <select name="atsProvider" className={inputCls} defaultValue="none">
              <option value="none">None</option>
              <option value="greenhouse">Greenhouse</option>
              <option value="lever">Lever</option>
              <option value="ashby">Ashby</option>
            </select>
          </Field>
          <Field label="ATS board token (optional)">
            <input name="atsBoardToken" className={inputCls} />
          </Field>
        </div>
        <Field label="Source URL (optional)" error={errors.sourceUrl}>
          <input name="sourceUrl" placeholder="https://" className={inputCls} />
        </Field>
        <Button type="submit">Submit company for review</Button>
      </form>
    </Card>
  );
}

function RoleForm() {
  const adapter = useAdapter();
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const [seasons, setSeasons] = useState<string[]>([]);
  const [degreeLevels, setDegreeLevels] = useState<string[]>([]);
  const [honeypot, setHoneypot] = useState('');

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const raw = {
      companyName: String(fd.get('companyName') ?? ''),
      title: String(fd.get('title') ?? ''),
      field: String(fd.get('field') ?? 'Technology'),
      seasons,
      workArrangement: String(fd.get('workArrangement') ?? 'Onsite'),
      degreeLevels,
      opportunityType: String(fd.get('opportunityType') ?? 'Internship'),
      workSchedule: String(fd.get('workSchedule') ?? 'Full-time'),
      compensationStatus: String(fd.get('compensationStatus') ?? 'Not disclosed'),
      applyUrl: String(fd.get('applyUrl') ?? ''),
      description: String(fd.get('description') ?? ''),
      sourceUrl: String(fd.get('sourceUrl') ?? ''),
      role_hp: honeypot,
    };

    if (honeypot) {
      setSubmitted(true);
      return;
    }

    const parsed = roleFormSchema.safeParse(raw);
    if (!parsed.success) {
      setErrors(firstErrors(parsed.error));
      return;
    }
    setErrors({});
    const payload: RoleFormB = {
      companyName: raw.companyName,
      title: raw.title,
      field: raw.field,
      seasons,
      workArrangement: raw.workArrangement,
      degreeLevels,
      opportunityType: raw.opportunityType,
      workSchedule: raw.workSchedule,
      compensationStatus: raw.compensationStatus,
      applyUrl: raw.applyUrl,
      description: raw.description,
      sourceUrl: raw.sourceUrl || undefined,
    };
    await adapter.submitRole(payload);
    setSubmitted(true);
  };

  if (submitted) return <SuccessCard what="role" onAgain={() => setSubmitted(false)} />;

  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <input type="text" name="role_hp" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

        <Field label="Company name" error={errors.companyName}>
          <input name="companyName" className={inputCls} />
        </Field>
        <Field label="Job title" error={errors.title}>
          <input name="title" className={inputCls} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Field" error={errors.field}>
            <select name="field" className={inputCls} defaultValue="Technology">
              {FIELDS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </Field>
          <Field label="Opportunity type" error={errors.opportunityType}>
            <select name="opportunityType" className={inputCls} defaultValue="Internship">
              {OPPORTUNITY_TYPES.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Season / Term" error={errors.seasons}>
          <CheckboxRow options={SEASONS} selected={seasons as never} onToggle={(v) => setSeasons((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Work arrangement">
            <select name="workArrangement" className={inputCls} defaultValue="Onsite">
              {WORK_ARRANGEMENTS.map((w) => (
                <option key={w}>{w}</option>
              ))}
            </select>
          </Field>
          <Field label="Work schedule">
            <select name="workSchedule" className={inputCls} defaultValue="Full-time">
              {WORK_SCHEDULES.map((w) => (
                <option key={w}>{w}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Degree levels" error={errors.degreeLevels}>
          <CheckboxRow options={DEGREE_LEVELS} selected={degreeLevels as never} onToggle={(v) => setDegreeLevels((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))} />
        </Field>
        <Field label="Compensation">
          <select name="compensationStatus" className={inputCls} defaultValue="Not disclosed">
            {COMPENSATION_STATUSES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="Direct application URL" error={errors.applyUrl}>
          <input name="applyUrl" placeholder="https://" className={inputCls} />
        </Field>
        <Field label="Description" error={errors.description}>
          <textarea name="description" rows={4} className={inputCls} />
        </Field>
        <Field label="Source URL (optional)" error={errors.sourceUrl}>
          <input name="sourceUrl" placeholder="https://" className={inputCls} />
        </Field>
        <Button type="submit">Submit role for review</Button>
      </form>
    </Card>
  );
}

function SuccessCard({ what, onAgain }: { what: string; onAgain: () => void }) {
  return (
    <Card className="text-center">
      <CheckCircle2 className="mx-auto h-10 w-10 text-cyan" aria-hidden="true" />
      <h2 className="mt-3 text-lg font-semibold text-navy">Thanks — your {what} was submitted</h2>
      <p className="mt-1 text-sm text-slate-500">Our team will review it before it appears publicly.</p>
      <Button variant="outline" className="mt-4" onClick={onAgain}>
        Submit another
      </Button>
    </Card>
  );
}
