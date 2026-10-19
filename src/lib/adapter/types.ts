// ── Domain enums (mirror the Postgres enums in supabase/migrations) ──────────

export type CompanyType = 'Startup' | 'Established Company' | 'Other / Unknown';

export type StartupStage =
  | 'Pre-seed'
  | 'Seed'
  | 'Series A'
  | 'Series B'
  | 'Series C or later'
  | 'Bootstrapped'
  | 'Unknown / Not disclosed';

export type EmployeeRange = '1-10' | '11-50' | '51-200' | '201-500' | '501+';

export type AtsProvider = 'greenhouse' | 'lever' | 'ashby' | 'none';

export type ModerationStatus = 'Pending' | 'Approved' | 'Rejected';

export type ListingStatus = 'Active' | 'Expired' | 'Closed' | 'Archived';

export type WorkArrangement = 'Remote' | 'Hybrid' | 'Onsite';

export type OpportunityType = 'Internship' | 'Co-op' | 'Entry-level / New-grad';

export type WorkSchedule = 'Full-time' | 'Part-time';

export type CompensationStatus = 'Paid' | 'Unpaid' | 'Not disclosed';

export type DegreeLevel = 'Undergraduate' | 'Graduate' | 'New Grad';

export type Season = 'Spring' | 'Summer' | 'Fall' | 'Winter' | 'Year-Round';

export type SpecificSeason = Exclude<Season, 'Year-Round'>;

export type FieldType =
  | 'Technology'
  | 'Business'
  | 'Healthcare'
  | 'Engineering'
  | 'Finance'
  | 'Marketing'
  | 'Other';

export type LocationType = 'HQ' | 'Office';

export type AccountRole = 'student' | 'admin';

export type ApplicationStatus = 'Applied' | 'Interviewing' | 'Offer' | 'Rejected';

export type DataSource = 'seed' | 'community' | 'ats';

// ── Enum value lists (runtime, for validation / iteration) ───────────────────

export const SEASONS: readonly Season[] = ['Spring', 'Summer', 'Fall', 'Winter', 'Year-Round'];
export const SPECIFIC_SEASONS: readonly SpecificSeason[] = ['Spring', 'Summer', 'Fall', 'Winter'];
export const DEGREE_LEVELS: readonly DegreeLevel[] = ['Undergraduate', 'Graduate', 'New Grad'];
export const FIELDS: readonly FieldType[] = [
  'Technology',
  'Business',
  'Healthcare',
  'Engineering',
  'Finance',
  'Marketing',
  'Other',
];
export const OPPORTUNITY_TYPES: readonly OpportunityType[] = [
  'Internship',
  'Co-op',
  'Entry-level / New-grad',
];
export const WORK_ARRANGEMENTS: readonly WorkArrangement[] = ['Remote', 'Hybrid', 'Onsite'];
export const WORK_SCHEDULES: readonly WorkSchedule[] = ['Full-time', 'Part-time'];
export const COMPENSATION_STATUSES: readonly CompensationStatus[] = [
  'Paid',
  'Unpaid',
  'Not disclosed',
];
export const STARTUP_STAGES: readonly StartupStage[] = [
  'Pre-seed',
  'Seed',
  'Series A',
  'Series B',
  'Series C or later',
  'Bootstrapped',
  'Unknown / Not disclosed',
];
export const EMPLOYEE_RANGES: readonly EmployeeRange[] = ['1-10', '11-50', '51-200', '201-500', '501+'];
export const APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  'Applied',
  'Interviewing',
  'Offer',
  'Rejected',
];

// ── Pay / compensation ───────────────────────────────────────────────────────

export interface PayRange {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: string | null; // 'hour' | 'month' | 'year'
}

// ── Core domain records ────────────────────────────────────────────────────

export interface CompanyLocation {
  id: string;
  companyId: string;
  city: string | null;
  state: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  locationType: LocationType;
}

export interface Company {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  careersUrl: string | null;
  description: string | null;
  fields: FieldType[];
  companyType: CompanyType;
  startupStage: StartupStage | null;
  employeeCountRange: EmployeeRange | null;
  foundingYear: number | null;
  degreeLevels: DegreeLevel[];
  atsProvider: AtsProvider;
  atsBoardToken: string | null;
  source: DataSource;
  moderationStatus: ModerationStatus;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Role {
  id: string;
  slug: string;
  companyId: string;
  externalJobId: string | null;
  title: string;
  field: FieldType;
  seasons: Season[];
  cohortYear: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  workArrangement: WorkArrangement;
  degreeLevels: DegreeLevel[];
  opportunityType: OpportunityType;
  workSchedule: WorkSchedule;
  compensationStatus: CompensationStatus;
  payMin: number | null;
  payMax: number | null;
  payCurrency: string | null;
  payPeriod: string | null;
  duration: string | null;
  applicationDeadline: string | null;
  applyUrl: string;
  description: string | null;
  source: DataSource;
  sourceUrl: string | null;
  moderationStatus: ModerationStatus;
  listingStatus: ListingStatus;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── View DTOs (what the UI consumes) ─────────────────────────────────────────

export interface RoleCard {
  id: string;
  slug: string;
  title: string;
  companyName: string;
  companySlug: string;
  companyLogoUrl: string | null;
  companyType: CompanyType | null;
  seasons: Season[];
  cohortYear: number | null;
  field: FieldType;
  city: string | null;
  state: string | null;
  country: string | null;
  workArrangement: WorkArrangement;
  degreeLevels: DegreeLevel[];
  opportunityType: OpportunityType;
  compensationStatus: CompensationStatus;
  pay: PayRange | null;
  applicationDeadline: string | null;
  lastVerifiedAt: string | null;
  listingStatus: ListingStatus;
}

export interface RoleDetailView extends RoleCard {
  description: string | null;
  workSchedule: WorkSchedule;
  duration: string | null;
  applyUrl: string;
  source: DataSource;
  sourceUrl: string | null;
}

export interface CompanyCard {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  fields: FieldType[];
  companyType: CompanyType;
  startupStage: StartupStage | null;
  employeeCountRange: EmployeeRange | null;
  foundingYear: number | null;
  description: string | null;
  careersUrl: string | null;
  degreeLevels: DegreeLevel[];
  locations: CompanyLocation[];
  activeRoleCount: number;
}

export interface CompanyDetailView extends CompanyCard {
  websiteUrl: string | null;
  lastVerifiedAt: string | null;
  roles: RoleCard[];
}

// ── Stats / featured ─────────────────────────────────────────────────────────

export interface Stats {
  companies: number;
  activeRoles: number;
  startups: number;
}

export interface FeaturedBlocks {
  featuredCompanies: CompanyCard[];
  startupOpportunities: RoleCard[];
  recentlyVerified: RoleCard[];
  byUpcomingTerm: RoleCard[];
  approachingDeadline: RoleCard[];
}

// ── Saved / applications ─────────────────────────────────────────────────────

export interface SavedItem {
  roleId: string;
  savedAt: string;
  role?: RoleCard;
}

export interface Application {
  id: string;
  roleId: string | null;
  companyName: string;
  roleTitle: string;
  status: ApplicationStatus;
  notes: string | null;
  applicationUrl: string | null;
  appliedAt: string | null;
  followUpDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationInput {
  roleId?: string | null;
  companyName: string;
  roleTitle: string;
  status?: ApplicationStatus;
  notes?: string | null;
  applicationUrl?: string | null;
  appliedAt?: string | null;
  followUpDate?: string | null;
}

// ── Submissions / reports ──────────────────────────────────────────────────

export interface ReportInput {
  roleId: string;
  reason: 'expired' | 'broken' | 'incorrect' | 'other';
  details?: string;
}

// ── Pagination ────────────────────────────────────────────────────────────

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
