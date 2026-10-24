import type { ComponentProps } from 'react';
import { RoleCard } from './RoleCard';
import { useApplications } from '../../hooks/useApplications';

/** Connect every job card to the same account-scoped applications cache. */
export function TrackedRoleCard(props: Omit<ComponentProps<typeof RoleCard>,
  'tracked' | 'trackingSaving' | 'onTrack' | 'onToggleTrack'>) {
  const { applications, toggleTrack, isRolePending, canEdit, error, errorKey, retry } = useApplications();
  const tracked = applications.some(application => application.roleId === props.role.id);
  const showError = error && (!errorKey || errorKey === `role:${props.role.id}`);
  return (
    <div className="flex h-full flex-col gap-2">
      <RoleCard {...props} tracked={tracked}
        trackingSaving={!canEdit || isRolePending(props.role.id)}
        onToggleTrack={role => { void toggleTrack(role).catch(() => {}); }} />
      {showError && <p role="alert" className="text-sm text-red-700">
        {error} {!canEdit && <button type="button" onClick={retry} className="underline">Retry</button>}
      </p>}
    </div>
  );
}
