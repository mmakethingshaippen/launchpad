import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { SignInForm } from '../components/auth/SignInForm';
import { LoadingBlock } from '../components/ui/Spinner';

export function SignIn() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  // Redirect once authenticated (never during render).
  useEffect(() => {
    if (user) navigate('/applications', { replace: true });
  }, [user, navigate]);

  if (loading) return <LoadingBlock label="Checking your session" />;

  return (
    <div className="mx-auto max-w-md">
      <Helmet>
        <title>Sign in — Launchpad</title>
      </Helmet>

      <h1 className="mb-2 text-2xl font-bold text-navy">Sign in</h1>
      <p className="mb-6 text-sm text-slate-500">
        Accounts are optional — they let you sync saved roles and tracked applications across devices.
        You can always{' '}
        <Link to="/browse" className="text-cyan underline">
          browse and apply
        </Link>{' '}
        without one.
      </p>

      <SignInForm onAuthenticated={() => navigate('/applications', { replace: true })} />
    </div>
  );
}
