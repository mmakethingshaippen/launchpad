import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { LoadingBlock } from './ui/Spinner';
import { EmptyState } from './ui/EmptyState';
import { Button } from './ui/Button';
import { ShieldAlert } from 'lucide-react';

/**
 * Client-side guard for /admin. This is a UX gate only — the real enforcement
 * is backend authorization + Supabase RLS (is_admin()), so even if this were
 * bypassed, admin data/operations are denied server-side (Req 15.1-15.2).
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return <LoadingBlock label="Checking access" />;

  if (!user || user.accountRole !== 'admin') {
    return (
      <EmptyState
        icon={<ShieldAlert className="h-8 w-8" aria-hidden="true" />}
        title="Admin access required"
        description="You don't have permission to view this page."
        action={
          <Link to="/">
            <Button variant="outline">Go home</Button>
          </Link>
        }
      />
    );
  }

  return <>{children}</>;
}
