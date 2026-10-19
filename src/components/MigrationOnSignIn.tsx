import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { useAdapter } from '../hooks/useAdapter';
import { migrateLocalToAccount } from '../lib/migrate';

/**
 * When a user signs into a cloud session, migrate anonymous localStorage saved
 * roles + applications into their account exactly once per sign-in (Req 12.5).
 */
export function MigrationOnSignIn() {
  const { user, isCloud } = useAuth();
  const adapter = useAdapter();
  const qc = useQueryClient();
  const migratedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!isCloud || !user) return;
    if (migratedFor.current === user.id) return;
    migratedFor.current = user.id;
    migrateLocalToAccount(adapter)
      .then(() => {
        qc.invalidateQueries({ queryKey: ['saved'] });
        qc.invalidateQueries({ queryKey: ['applications'] });
      })
      .catch(() => {
        // migration failures are non-fatal; local data remains intact
        migratedFor.current = null;
      });
  }, [isCloud, user, adapter, qc]);

  return null;
}
