import { describe, it, expect, vi } from 'vitest';
import { migrateLocalToAccount } from './migrate';
import type { DataAdapter } from './adapter';
import type { Application, SavedItem, ApplicationInput } from './adapter/types';

function makeAdapter(initialSaved: string[], initialApps: Application[]) {
  const saved = new Set(initialSaved);
  const apps = [...initialApps];
  const adapter: Partial<DataAdapter> = {
    listSaved: async () => [...saved].map((roleId) => ({ roleId, savedAt: '' }) as SavedItem),
    save: vi.fn(async (roleId: string) => {
      saved.add(roleId);
    }),
    unsave: async () => {},
    listApplications: async () => apps,
    upsertApplication: vi.fn(async (input: ApplicationInput) => {
      apps.push({
        id: `a-${apps.length}`,
        roleId: input.roleId ?? null,
        companyName: input.companyName,
        roleTitle: input.roleTitle,
        status: input.status ?? 'Applied',
        notes: null,
        applicationUrl: null,
        appliedAt: null,
        followUpDate: null,
        createdAt: '',
        updatedAt: '',
      });
    }),
  };
  return { adapter: adapter as DataAdapter, saved, apps };
}

function app(partial: Partial<Application>): Application {
  return {
    id: 'x',
    roleId: null,
    companyName: '',
    roleTitle: '',
    status: 'Applied',
    notes: null,
    applicationUrl: null,
    appliedAt: null,
    followUpDate: null,
    createdAt: '',
    updatedAt: '',
    ...partial,
  };
}

describe('migrateLocalToAccount', () => {
  it('migrates new saved roles and skips ones already in the account', async () => {
    const { adapter } = makeAdapter(['role-1'], []);
    const result = await migrateLocalToAccount(adapter, {
      getSaved: () => [
        { roleId: 'role-1', savedAt: '' }, // already in account → skip
        { roleId: 'role-2', savedAt: '' }, // new → migrate
        { roleId: 'role-2', savedAt: '' }, // dup within local → skip
      ],
      getApplications: () => [],
      clearSaved: () => {},
      clearApplications: () => {},
    });
    expect(result.savedMigrated).toBe(1);
    expect(result.savedSkipped).toBe(2);
    expect(adapter.save).toHaveBeenCalledTimes(1);
    expect(adapter.save).toHaveBeenCalledWith('role-2');
  });

  it('dedups applications by role_id and by (company,title) for manual entries', async () => {
    const { adapter } = makeAdapter([], [
      app({ roleId: 'role-9', companyName: 'Acme', roleTitle: 'Intern' }),
      app({ roleId: null, companyName: 'Beta Co', roleTitle: 'Analyst' }),
    ]);
    const result = await migrateLocalToAccount(adapter, {
      getSaved: () => [],
      getApplications: () => [
        app({ roleId: 'role-9', companyName: 'Acme', roleTitle: 'Intern' }), // dup by role → skip
        app({ roleId: null, companyName: 'beta co', roleTitle: 'analyst' }), // dup by case-insensitive manual → skip
        app({ roleId: 'role-10', companyName: 'New', roleTitle: 'Co-op' }), // new → migrate
        app({ roleId: null, companyName: 'Gamma', roleTitle: 'Fellow' }), // new manual → migrate
      ],
      clearSaved: () => {},
      clearApplications: () => {},
    });
    expect(result.applicationsMigrated).toBe(2);
    expect(result.applicationsSkipped).toBe(2);
  });

  it('clears local data after migrating', async () => {
    const { adapter } = makeAdapter([], []);
    const clearSaved = vi.fn();
    const clearApplications = vi.fn();
    await migrateLocalToAccount(adapter, {
      getSaved: () => [{ roleId: 'r', savedAt: '' }],
      getApplications: () => [],
      clearSaved,
      clearApplications,
    });
    expect(clearSaved).toHaveBeenCalled();
    expect(clearApplications).toHaveBeenCalled();
  });

  it('is idempotent on a repeat run (no duplicates)', async () => {
    const { adapter } = makeAdapter(['role-1'], []);
    const second = await migrateLocalToAccount(adapter, {
      getSaved: () => [{ roleId: 'role-1', savedAt: '' }],
      getApplications: () => [],
      clearSaved: () => {},
      clearApplications: () => {},
    });
    expect(second.savedMigrated).toBe(0);
    expect(second.savedSkipped).toBe(1);
  });
});
