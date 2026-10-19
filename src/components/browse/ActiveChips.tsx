import { X } from 'lucide-react';
import type { RoleFilters } from '../../lib/filters';

interface Chip {
  key: string;
  label: string;
  clear: Partial<RoleFilters>;
}

function buildChips(f: RoleFilters): Chip[] {
  const chips: Chip[] = [];
  if (f.keyword) chips.push({ key: 'kw', label: `"${f.keyword}"`, clear: { keyword: '' } });
  for (const s of f.seasons) chips.push({ key: `s-${s}`, label: s, clear: { seasons: f.seasons.filter((x) => x !== s) } });
  for (const t of f.opportunityTypes)
    chips.push({ key: `t-${t}`, label: t, clear: { opportunityTypes: f.opportunityTypes.filter((x) => x !== t) } });
  if (f.remoteOnly) chips.push({ key: 'remote', label: 'Remote only', clear: { remoteOnly: false } });
  if (f.city) chips.push({ key: 'city', label: f.city, clear: { city: '' } });
  for (const d of f.degreeLevels)
    chips.push({ key: `d-${d}`, label: d, clear: { degreeLevels: f.degreeLevels.filter((x) => x !== d) } });
  for (const fd of f.fields) chips.push({ key: `f-${fd}`, label: fd, clear: { fields: f.fields.filter((x) => x !== fd) } });
  for (const c of f.compensation)
    chips.push({ key: `c-${c}`, label: c, clear: { compensation: f.compensation.filter((x) => x !== c) } });
  if (f.companyType !== 'All') chips.push({ key: 'ct', label: f.companyType, clear: { companyType: 'All' } });
  for (const st of f.startupStages)
    chips.push({ key: `st-${st}`, label: st, clear: { startupStages: f.startupStages.filter((x) => x !== st) } });
  for (const er of f.employeeRanges)
    chips.push({ key: `er-${er}`, label: `${er} emp`, clear: { employeeRanges: f.employeeRanges.filter((x) => x !== er) } });
  return chips;
}

export function ActiveChips({
  filters,
  onChange,
  onClearAll,
}: {
  filters: RoleFilters;
  onChange: (patch: Partial<RoleFilters>) => void;
  onClearAll: () => void;
}) {
  const chips = buildChips(filters);
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <button
          key={chip.key}
          onClick={() => onChange(chip.clear)}
          className="inline-flex items-center gap-1 rounded-full bg-cyan/10 px-2.5 py-1 text-xs font-medium text-navy hover:bg-cyan/20"
        >
          {chip.label}
          <X className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">Remove filter</span>
        </button>
      ))}
      <button onClick={onClearAll} className="text-xs font-medium text-slate-500 underline hover:text-navy">
        Clear all filters
      </button>
    </div>
  );
}
