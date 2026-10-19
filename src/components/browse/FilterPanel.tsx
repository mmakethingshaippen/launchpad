import type { RoleFilters } from '../../lib/filters';
import {
  SEASONS,
  DEGREE_LEVELS,
  FIELDS,
  OPPORTUNITY_TYPES,
  COMPENSATION_STATUSES,
  STARTUP_STAGES,
  EMPLOYEE_RANGES,
} from '../../lib/adapter/types';

function CheckGroup<T extends string>({
  legend,
  options,
  selected,
  onChange,
}: {
  legend: string;
  options: readonly T[];
  selected: T[];
  onChange: (next: T[]) => void;
}) {
  const toggle = (opt: T) =>
    onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt]);
  return (
    <fieldset className="border-t border-slate-200 py-4">
      <legend className="mb-2 text-sm font-semibold text-navy">{legend}</legend>
      <div className="space-y-1.5">
        {options.map((opt) => (
          <label key={opt} className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={selected.includes(opt)}
              onChange={() => toggle(opt)}
              className="h-4 w-4 rounded border-slate-300 text-cyan focus:ring-cyan"
            />
            {opt}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function FilterPanel({
  filters,
  onChange,
}: {
  filters: RoleFilters;
  onChange: (patch: Partial<RoleFilters>) => void;
}) {
  return (
    <div>
      <div className="pb-4">
        <label className="mb-1 block text-sm font-semibold text-navy">Keyword</label>
        <input
          value={filters.keyword}
          onChange={(e) => onChange({ keyword: e.target.value })}
          placeholder="Title, company, field"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan"
        />
      </div>

      <CheckGroup legend="Season / Term" options={SEASONS} selected={filters.seasons} onChange={(seasons) => onChange({ seasons })} />
      <CheckGroup legend="Opportunity type" options={OPPORTUNITY_TYPES} selected={filters.opportunityTypes} onChange={(opportunityTypes) => onChange({ opportunityTypes })} />

      <fieldset className="border-t border-slate-200 py-4">
        <legend className="mb-2 text-sm font-semibold text-navy">Location</legend>
        <input
          value={filters.city}
          onChange={(e) => onChange({ city: e.target.value })}
          placeholder="City"
          className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan"
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={filters.remoteOnly}
            onChange={(e) => onChange({ remoteOnly: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-cyan focus:ring-cyan"
          />
          Remote only
        </label>
      </fieldset>

      <CheckGroup legend="Degree level" options={DEGREE_LEVELS} selected={filters.degreeLevels} onChange={(degreeLevels) => onChange({ degreeLevels })} />
      <CheckGroup legend="Field" options={FIELDS} selected={filters.fields} onChange={(fields) => onChange({ fields })} />
      <CheckGroup legend="Compensation" options={COMPENSATION_STATUSES} selected={filters.compensation} onChange={(compensation) => onChange({ compensation })} />

      <fieldset className="border-t border-slate-200 py-4">
        <legend className="mb-2 text-sm font-semibold text-navy">Company type</legend>
        <select
          value={filters.companyType}
          onChange={(e) => onChange({ companyType: e.target.value as RoleFilters['companyType'] })}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan"
        >
          <option value="All">All companies</option>
          <option value="Startup">Startups</option>
          <option value="Established Company">Established companies</option>
        </select>
      </fieldset>

      <CheckGroup legend="Startup stage" options={STARTUP_STAGES} selected={filters.startupStages} onChange={(startupStages) => onChange({ startupStages })} />
      <CheckGroup legend="Company size" options={EMPLOYEE_RANGES} selected={filters.employeeRanges} onChange={(employeeRanges) => onChange({ employeeRanges })} />
    </div>
  );
}
