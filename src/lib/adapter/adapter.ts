import type { RoleFilters } from '../filters';
import type {
  Paginated,
  RoleCard,
  RoleDetailView,
  CompanyCard,
  CompanyDetailView,
  Stats,
  FeaturedBlocks,
  SavedItem,
  Application,
  ApplicationInput,
  ReportInput,
} from './types';

export interface CompanyFormA {
  name: string;
  websiteUrl: string;
  fields: string[];
  locations: Array<{ city?: string; state?: string; country?: string }>;
  companyType: string;
  degreeLevels: string[];
  description: string;
  careersUrl: string;
  atsProvider?: 'greenhouse' | 'lever' | 'ashby' | 'none';
  atsBoardToken?: string;
  startupStage?: string;
  employeeCountRange?: string;
  foundingYear?: number;
  sourceUrls?: string[];
  honeypot?: string;
}

export interface RoleFormB {
  companyId?: string;
  companyName?: string;
  newCompany?: CompanyFormA;
  title: string;
  field: string;
  seasons: string[];
  city?: string;
  state?: string;
  country?: string;
  workArrangement: string;
  degreeLevels: string[];
  opportunityType: string;
  workSchedule: string;
  compensationStatus: string;
  payMin?: number;
  payMax?: number;
  payCurrency?: string;
  payPeriod?: string;
  duration?: string;
  applicationDeadline?: string;
  applyUrl: string;
  description: string;
  sourceUrl?: string;
  honeypot?: string;
}

export interface SyncResult {
  company: string;
  companyId: string;
  imported: number;
  updated: number;
  closed: number;
  errors: string[];
}

/**
 * The single data-access contract. Implemented by SupabaseAdapter (cloud) and
 * LocalAdapter (seed + direct ATS fetch). UI code only ever talks to this.
 */
export interface DataAdapter {
  // ── Discovery (reads go through the public_roles eligibility view) ──
  searchRoles(filters: RoleFilters): Promise<Paginated<RoleCard>>;
  getRole(slug: string): Promise<RoleDetailView | null>;
  searchCompanies(filters: RoleFilters): Promise<Paginated<CompanyCard>>;
  getCompany(slug: string): Promise<CompanyDetailView | null>;
  getStats(): Promise<Stats>;
  getFeatured(): Promise<FeaturedBlocks>;
  getMapCompanies(filters: RoleFilters): Promise<MapCompany[]>;

  // ── Saving / tracking ──
  listSaved(): Promise<SavedItem[]>;
  save(roleId: string): Promise<void>;
  unsave(roleId: string): Promise<void>;
  listApplications(): Promise<Application[]>;
  upsertApplication(input: ApplicationInput): Promise<void>;
  deleteApplication(id: string): Promise<void>;

  // ── Community submissions / reports ──
  submitCompany(input: CompanyFormA): Promise<void>;
  submitRole(input: RoleFormB): Promise<void>;
  reportListing(input: ReportInput): Promise<void>;

  // ── Admin ──
  sync?(companyId?: string): Promise<SyncResult[]>;
  geocode?(locationId: string): Promise<void>;
  listPending?(): Promise<PendingQueue>;
  moderateCompany?(id: string, action: 'Approved' | 'Rejected'): Promise<void>;
  moderateRole?(id: string, action: 'Approved' | 'Rejected'): Promise<void>;
  listReports?(): Promise<ListingReport[]>;
  resolveReport?(id: string): Promise<void>;
}

export interface PendingCompany {
  id: string;
  name: string;
  websiteUrl: string | null;
  careersUrl: string | null;
  companyType: string;
  source: string;
  createdAt: string;
}

export interface PendingRole {
  id: string;
  title: string;
  companyName: string;
  field: string;
  seasons: string[];
  applyUrl: string;
  source: string;
  createdAt: string;
}

export interface PendingQueue {
  companies: PendingCompany[];
  roles: PendingRole[];
}

export interface ListingReport {
  id: string;
  roleId: string;
  reason: string;
  details: string | null;
  resolved: boolean;
  createdAt: string;
}

export interface MapCompany {
  /** Stable key for this (company, city) marker. */
  id: string;
  slug: string;
  name: string;
  companyType: string;
  websiteUrl: string | null;
  logoUrl: string | null;
  latitude: number;
  longitude: number;
  city: string | null;
  state: string | null;
  country: string | null;
  /** Count of active roles at THIS marker location. */
  activeRoleCount: number;
}
