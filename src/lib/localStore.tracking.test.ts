import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as store from './localStore';

const storageKey = 'launchpad.applications';
const input = { roleId: 'role-1', companyName: 'Example', roleTitle: 'Engineering Intern' };

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('guest application persistence', () => {
  it.each(['{broken', 'null', '{}', '"not an array"', '[null]', '[{"id":42}]']) (
    'recovers safely from malformed storage: %s', (raw) => {
      localStorage.setItem(storageKey, raw);
      expect(store.getApplications()).toEqual([]);
      expect(() => store.upsertApplication(input)).not.toThrow();
      expect(store.getApplications()).toHaveLength(1);
    },
  );

  it('stores a role once even when tracking is requested repeatedly', () => {
    const first = store.upsertApplication({ ...input, status: 'Applied' });
    const second = store.upsertApplication({ ...input, status: 'Applied' });
    expect(second.id).toBe(first.id);
    expect(store.getApplications()).toEqual([second]);
  });

  it('preserves application notes, dates and URL when changing only the status', () => {
    const original = store.upsertApplication({ ...input, status: 'Applied', notes: 'Recruiter called',
      applicationUrl: 'https://example.com/apply', appliedAt: '2026-10-01', followUpDate: '2026-10-30' });
    const updated = store.upsertApplication({ ...input, id: original.id, status: 'Interviewing' });
    expect(updated).toMatchObject({ ...original, status: 'Interviewing', updatedAt: expect.any(String) });
    expect(store.getApplications()).toHaveLength(1);
  });

  it('allows an existing manual application to be renamed using its id', () => {
    const original = store.upsertApplication({ companyName: 'Original', roleTitle: 'Old title', notes: 'Keep me' });
    const updated = store.upsertApplication({ id: original.id, companyName: 'Updated', roleTitle: 'New title', status: 'Interviewing' });
    expect(updated).toMatchObject({ id: original.id, companyName: 'Updated', roleTitle: 'New title', notes: 'Keep me' });
    expect(store.getApplications()).toEqual([updated]);
  });

  it('treats explicit null as clearing optional fields while omission preserves them', () => {
    const original = store.upsertApplication({ ...input, notes: 'Old note', applicationUrl: 'https://example.com',
      appliedAt: '2026-10-01', followUpDate: '2026-10-30' });
    const updated = store.upsertApplication({ ...input, id: original.id, notes: null, applicationUrl: null,
      appliedAt: null, followUpDate: null });
    expect(updated).toMatchObject({ notes: null, applicationUrl: null, appliedAt: null, followUpDate: null });
  });

  it('throws a storage failure so the UI can roll back an optimistic track', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    });
    expect(() => store.upsertApplication(input)).toThrow();
    expect(store.getApplications()).toEqual([]);
  });

  it('does not claim an untrack succeeded when browser storage cannot be written', () => {
    const saved = store.upsertApplication(input);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is disabled', 'SecurityError');
    });
    expect(() => store.deleteApplication(saved.id)).toThrow();
    expect(store.getApplications()).toEqual([saved]);
  });

  it('removes only the chosen application and persists the remaining list', () => {
    const first = store.upsertApplication(input);
    const second = store.upsertApplication({ ...input, roleId: 'role-2' });
    store.deleteApplication(first.id);
    expect(store.getApplications()).toEqual([second]);
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual([second]);
  });
});
