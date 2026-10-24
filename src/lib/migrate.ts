import type { DataAdapter } from './adapter';
import type { Application, SavedItem } from './adapter/types';
import * as local from './localStore';

export interface MigrationResult {
  savedMigrated: number;
  savedSkipped: number;
  applicationsMigrated: number;
  applicationsSkipped: number;
}

function appKey(a: { roleId?: string | null; companyName: string; roleTitle: string }): string {
  return a.roleId
    ? `role:${a.roleId}`
    : `manual:${a.companyName.toLowerCase()}|${a.roleTitle.toLowerCase()}`;
}

/**
 * Migrate anonymous localStorage saved roles + applications into the signed-in
 * account (Req 12.5-12.8). Deduplicates against what already exists in the
 * account and against itself, so repeat sign-ins never create duplicates.
 *
 * The target adapter is assumed to be the cloud (Supabase) adapter for a
 * signed-in user. After a successful migration the local keys are cleared.
 */
export async function migrateLocalToAccount(
  adapter: DataAdapter,
  deps: {
    expectedUserId?: string;
    isCurrent?: () => boolean;
    getSaved?: () => SavedItem[];
    getApplications?: () => Application[];
    clearSaved?: () => void;
    clearApplications?: () => void;
  } = {},
): Promise<MigrationResult> {
  const getSaved = deps.getSaved ?? local.getSaved;
  const getApplications = deps.getApplications ?? local.getApplications;
  const clearSaved = deps.clearSaved ?? local.clearSaved;
  const clearApplications = deps.clearApplications ?? local.clearApplications;
  const assertCurrent = () => {
    if (deps.isCurrent && !deps.isCurrent()) throw new Error('Session changed during application import.');
  };
  assertCurrent();

  const result: MigrationResult = {
    savedMigrated: 0,
    savedSkipped: 0,
    applicationsMigrated: 0,
    applicationsSkipped: 0,
  };

  // ── Saved opportunities: dedup by role_id ──
  const localSaved = getSaved();
  const existingSaved = await adapter.listSaved(deps.expectedUserId);
  assertCurrent();
  const existingRoleIds = new Set(existingSaved.map((s) => s.roleId));
  const seenRoleIds = new Set<string>();

  for (const item of localSaved) {
    if (existingRoleIds.has(item.roleId) || seenRoleIds.has(item.roleId)) {
      result.savedSkipped++;
      continue;
    }
    seenRoleIds.add(item.roleId);
    assertCurrent();
    await adapter.save(item.roleId, deps.expectedUserId);
    assertCurrent();
    result.savedMigrated++;
  }

  // ── Applications: dedup by composite key ──
  const localApps = getApplications();
  const existingApps = await adapter.listApplications(deps.expectedUserId);
  assertCurrent();
  const existingKeys = new Set(existingApps.map(appKey));
  const seenKeys = new Set<string>();

  for (const app of localApps) {
    const key = appKey(app);
    if (existingKeys.has(key) || seenKeys.has(key)) {
      result.applicationsSkipped++;
      continue;
    }
    seenKeys.add(key);
    assertCurrent();
    await adapter.upsertApplication({
      roleId: app.roleId,
      companyName: app.companyName,
      roleTitle: app.roleTitle,
      status: app.status,
      notes: app.notes,
      applicationUrl: app.applicationUrl,
      appliedAt: app.appliedAt,
      followUpDate: app.followUpDate,
    }, deps.expectedUserId);
    assertCurrent();
    result.applicationsMigrated++;
  }

  // Clear local data only after everything migrated.
  assertCurrent();
  clearSaved();
  clearApplications();

  return result;
}
