import { APPLICATION_STATUSES, type Application, type ApplicationInput, type SavedItem } from './adapter/types';

const SAVED_KEY = 'launchpad.saved';
export const APPS_KEY = 'launchpad.applications';

function hasStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function read<T>(key: string, fallback: T): T {
  if (!hasStorage()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  if (!hasStorage()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota / serialization errors */
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── Saved opportunities ────────────────────────────────────────────────────

export function getSaved(): SavedItem[] {
  return read<SavedItem[]>(SAVED_KEY, []);
}

export function addSaved(roleId: string): void {
  const items = getSaved();
  if (items.some((s) => s.roleId === roleId)) return; // dedup by roleId
  items.push({ roleId, savedAt: new Date().toISOString() });
  write(SAVED_KEY, items);
}

export function removeSaved(roleId: string): void {
  write(
    SAVED_KEY,
    getSaved().filter((s) => s.roleId !== roleId),
  );
}

export function clearSaved(): void {
  if (hasStorage()) localStorage.removeItem(SAVED_KEY);
}

// ── Applications ────────────────────────────────────────────────────────────

export function getApplications(): Application[] {
  const value = read<unknown>(APPS_KEY, []);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Application => {
    if (!item || typeof item !== 'object') return false;
    const a = item as Record<string, unknown>;
    return typeof a.id === 'string' && !!a.id &&
      (a.roleId === null || typeof a.roleId === 'string') &&
      typeof a.companyName === 'string' && typeof a.roleTitle === 'string' &&
      APPLICATION_STATUSES.includes(a.status as Application['status']) &&
      typeof a.createdAt === 'string' && typeof a.updatedAt === 'string' &&
      ['notes', 'applicationUrl', 'appliedAt', 'followUpDate'].every(key => a[key] === null || typeof a[key] === 'string');
  });
}

function writeApplications(applications: Application[]): void {
  try {
    localStorage.setItem(APPS_KEY, JSON.stringify(applications));
  } catch {
    throw new Error('This browser could not save your applications. Allow site storage or sign in to save them to your account.');
  }
}

/** Upsert with the same dedup rule the DB enforces (Req 12.7). */
export function upsertApplication(input: ApplicationInput): Application {
  const apps = getApplications();
  const now = new Date().toISOString();

  const matchIndex = apps.findIndex((a) =>
    input.id ? a.id === input.id : input.roleId
      ? a.roleId === input.roleId
      : a.roleId === null &&
        a.companyName.toLowerCase() === input.companyName.toLowerCase() &&
        a.roleTitle.toLowerCase() === input.roleTitle.toLowerCase(),
  );

  if (matchIndex >= 0) {
    const existing = apps[matchIndex];
    const updated: Application = {
      ...existing,
      companyName: input.companyName.trim(),
      roleTitle: input.roleTitle.trim(),
      status: input.status ?? existing.status,
      notes: input.notes !== undefined ? input.notes : existing.notes,
      applicationUrl: input.applicationUrl !== undefined ? input.applicationUrl : existing.applicationUrl,
      appliedAt: input.appliedAt !== undefined ? input.appliedAt : existing.appliedAt,
      followUpDate: input.followUpDate !== undefined ? input.followUpDate : existing.followUpDate,
      updatedAt: now,
    };
    apps[matchIndex] = updated;
    writeApplications(apps);
    return updated;
  }

  const created: Application = {
    id: uid(),
    roleId: input.roleId ?? null,
    companyName: input.companyName.trim(),
    roleTitle: input.roleTitle.trim(),
    status: input.status ?? 'Applied',
    notes: input.notes ?? null,
    applicationUrl: input.applicationUrl ?? null,
    appliedAt: input.appliedAt ?? null,
    followUpDate: input.followUpDate ?? null,
    createdAt: now,
    updatedAt: now,
  };
  apps.push(created);
  writeApplications(apps);
  return created;
}

export function deleteApplication(id: string): void {
  writeApplications(
    getApplications().filter((a) => a.id !== id && a.roleId !== id),
  );
}

export function clearApplications(): void {
  writeApplications([]);
}
