import type {
  Season,
  OpportunityType,
  DegreeLevel,
  FieldType,
  WorkSchedule,
  CompensationStatus,
  CompanyType,
  StartupStage,
  EmployeeRange,
} from './adapter/types';

export type BrowseView = 'opportunities' | 'companies';

export type SortKey = 'verified' | 'recent' | 'deadline' | 'name' | 'relevance';

export interface RoleFilters {
  keyword: string;
  seasons: Season[];
  opportunityTypes: OpportunityType[];
  city: string;
  state: string;
  country: string;
  remoteOnly: boolean;
  degreeLevels: DegreeLevel[];
  fields: FieldType[];
  workSchedules: WorkSchedule[];
  compensation: CompensationStatus[];
  companyType: CompanyType | 'All';
  startupStages: StartupStage[];
  employeeRanges: EmployeeRange[];
  sort: SortKey;
  view: BrowseView;
  page: number;
}

export const DEFAULT_FILTERS: RoleFilters = {
  keyword: '',
  seasons: [],
  opportunityTypes: [],
  city: '',
  state: '',
  country: '',
  remoteOnly: false,
  degreeLevels: [],
  fields: [],
  workSchedules: [],
  compensation: [],
  companyType: 'All',
  startupStages: [],
  employeeRanges: [],
  sort: 'verified',
  view: 'opportunities',
  page: 1,
};

// Season tokens used in the URL are lowercase; Year-Round → 'year-round'.
const SEASON_TO_TOKEN: Record<Season, string> = {
  Spring: 'spring',
  Summer: 'summer',
  Fall: 'fall',
  Winter: 'winter',
  'Year-Round': 'year-round',
};
const TOKEN_TO_SEASON: Record<string, Season> = Object.fromEntries(
  Object.entries(SEASON_TO_TOKEN).map(([k, v]) => [v, k as Season]),
) as Record<string, Season>;

function splitCsv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse a URLSearchParams-like object into a fully-populated RoleFilters. */
export function parseFilters(params: URLSearchParams): RoleFilters {
  const get = (k: string) => params.get(k);

  const seasons = splitCsv(get('season'))
    .map((t) => TOKEN_TO_SEASON[t.toLowerCase()])
    .filter((s): s is Season => Boolean(s));

  const sortRaw = get('sort');
  const sort: SortKey =
    sortRaw === 'recent' ||
    sortRaw === 'deadline' ||
    sortRaw === 'name' ||
    sortRaw === 'relevance' ||
    sortRaw === 'verified'
      ? sortRaw
      : DEFAULT_FILTERS.sort;

  const view: BrowseView = get('view') === 'companies' ? 'companies' : 'opportunities';

  const pageNum = Number(get('page'));
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1;

  const companyTypeRaw = get('company');
  const companyType: RoleFilters['companyType'] =
    companyTypeRaw === 'Startup' ||
    companyTypeRaw === 'Established Company' ||
    companyTypeRaw === 'Other / Unknown'
      ? companyTypeRaw
      : 'All';

  return {
    keyword: get('q') ?? '',
    seasons,
    opportunityTypes: splitCsv(get('type')) as OpportunityType[],
    city: get('city') ?? '',
    state: get('state') ?? '',
    country: get('country') ?? '',
    remoteOnly: get('remote') === '1',
    degreeLevels: splitCsv(get('degree')) as DegreeLevel[],
    fields: splitCsv(get('field')) as FieldType[],
    workSchedules: splitCsv(get('schedule')) as WorkSchedule[],
    compensation: splitCsv(get('comp')) as CompensationStatus[],
    companyType,
    startupStages: splitCsv(get('stage')) as StartupStage[],
    employeeRanges: splitCsv(get('size')) as EmployeeRange[],
    sort,
    view,
    page,
  };
}

/** Serialize RoleFilters into a URLSearchParams, omitting default/empty values. */
export function serializeFilters(filters: RoleFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.keyword) params.set('q', filters.keyword);
  if (filters.seasons.length)
    params.set('season', filters.seasons.map((s) => SEASON_TO_TOKEN[s]).join(','));
  if (filters.opportunityTypes.length) params.set('type', filters.opportunityTypes.join(','));
  if (filters.city) params.set('city', filters.city);
  if (filters.state) params.set('state', filters.state);
  if (filters.country) params.set('country', filters.country);
  if (filters.remoteOnly) params.set('remote', '1');
  if (filters.degreeLevels.length) params.set('degree', filters.degreeLevels.join(','));
  if (filters.fields.length) params.set('field', filters.fields.join(','));
  if (filters.workSchedules.length) params.set('schedule', filters.workSchedules.join(','));
  if (filters.compensation.length) params.set('comp', filters.compensation.join(','));
  if (filters.companyType !== 'All') params.set('company', filters.companyType);
  if (filters.startupStages.length) params.set('stage', filters.startupStages.join(','));
  if (filters.employeeRanges.length) params.set('size', filters.employeeRanges.join(','));
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set('sort', filters.sort);
  if (filters.view !== DEFAULT_FILTERS.view) params.set('view', filters.view);
  if (filters.page > 1) params.set('page', String(filters.page));

  return params;
}

/** Count active (non-default) filter groups — used for the chip/clear UI. */
export function activeFilterCount(filters: RoleFilters): number {
  let n = 0;
  if (filters.keyword) n++;
  if (filters.seasons.length) n++;
  if (filters.opportunityTypes.length) n++;
  if (filters.city || filters.state || filters.country) n++;
  if (filters.remoteOnly) n++;
  if (filters.degreeLevels.length) n++;
  if (filters.fields.length) n++;
  if (filters.workSchedules.length) n++;
  if (filters.compensation.length) n++;
  if (filters.companyType !== 'All') n++;
  if (filters.startupStages.length) n++;
  if (filters.employeeRanges.length) n++;
  return n;
}
