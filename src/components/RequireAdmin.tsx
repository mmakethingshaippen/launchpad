import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { LoadingBlock } from './ui/Spinner';
import { EmptyState } from './ui/EmptyState';
import { Button } from './ui/Button';
import { SignInForm } from './auth/SignInForm';
import { ShieldAlert } from 'lucide-react';

/**
 * Client-side guard for /admin. This is a UX gate only — the real enforcement
 * is backend authorization + Supabase RLS (is_admin()), so even if this were
 * bypassed, admin data/operations are denied server-side (Req 15.1-15.2).
 *
 * When signed out, we render the sign-in form inline so an admin can log in
 * right here and immediately see the dashboard once authenticated.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return <LoadingBlock label="Checking access" />;

  // Signed out → inline sign-in form.
  if (!user) {
    return (
      <div className="mx-auto max-w-md">
        <h1 className="mb-2 text-2xl font-bold text-navy">Admin sign in</h1>
        <p className="mb-6 text-sm text-slate-500">
          Sign in with an administrator account to manage submissions and run the live ATS sync.
        </p>
        {/* No redirect callback: once authenticated, this component re-renders
            with the user present and shows the dashboard (or the not-admin
            message below) in place. */}
        <SignInForm />
      </div>
    );
  }

  // Signed in but not an admin → signing in again won't help; needs elevation.
  if (user.accountRole !== 'admin') {
    return (
      <EmptyState
        icon={<ShieldAlert className="h-8 w-8" aria-hidden="true" />}
        title="Admin access required"
        description="You're signed in, but this account doesn't have administrator access."
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
