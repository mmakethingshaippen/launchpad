import { useEffect, useState, type FormEvent } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { LoadingBlock } from '../components/ui/Spinner';

export function SignIn() {
  const { signIn, signUp, isCloud, user, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentConfirm, setSentConfirm] = useState(false);

  // Redirect once we know the user is authenticated (never during render).
  useEffect(() => {
    if (user) navigate('/applications', { replace: true });
  }, [user, navigate]);

  if (loading) return <LoadingBlock label="Checking your session" />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(email, password);
        // onAuthStateChange updates `user`, which triggers the redirect effect.
        navigate('/applications', { replace: true });
      } else {
        const { needsConfirmation } = await signUp(email, password);
        if (needsConfirmation) {
          setSentConfirm(true);
        } else {
          // Email confirmation disabled → already signed in.
          navigate('/applications', { replace: true });
        }
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <Helmet>
        <title>{mode === 'signin' ? 'Sign in' : 'Create account'} — Launchpad</title>
      </Helmet>

      <h1 className="mb-2 text-2xl font-bold text-navy">
        {mode === 'signin' ? 'Sign in' : 'Create your account'}
      </h1>
      <p className="mb-6 text-sm text-slate-500">
        Accounts are optional — they let you sync saved roles and tracked applications across devices.
        You can always{' '}
        <Link to="/browse" className="text-cyan underline">
          browse and apply
        </Link>{' '}
        without one.
      </p>

      {!isCloud && (
        <Card className="mb-4 border-amber-200 bg-amber-50 text-sm text-amber-800">
          Accounts require a connected Supabase backend. This instance is running in local mode, so your
          saved roles and applications live on this device only.
        </Card>
      )}

      {sentConfirm ? (
        <Card className="text-center">
          <p className="font-semibold text-navy">Check your email</p>
          <p className="mt-1 text-sm text-slate-500">
            We sent a confirmation link to {email}. Confirm it, then sign in.
          </p>
          <Button variant="outline" className="mt-4" onClick={() => { setMode('signin'); setSentConfirm(false); }}>
            Back to sign in
          </Button>
        </Card>
      ) : (
        <Card>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-navy">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-navy">Password</span>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan"
              />
            </label>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={busy || !isCloud}>
              <LogIn className="h-4 w-4" aria-hidden="true" />
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-slate-500">
            {mode === 'signin' ? (
              <>
                No account?{' '}
                <button onClick={() => { setMode('signup'); setError(null); }} className="text-cyan underline">
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button onClick={() => { setMode('signin'); setError(null); }} className="text-cyan underline">
                  Sign in
                </button>
              </>
            )}
          </p>
        </Card>
      )}
    </div>
  );
}

/** Map common Supabase auth errors to clear, user-facing messages. */
function friendlyAuthError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes('invalid login credentials')) return 'Incorrect email or password.';
  if (lower.includes('email not confirmed')) return 'Please confirm your email address first, then sign in.';
  if (lower.includes('user already registered')) return 'An account with this email already exists. Try signing in.';
  if (lower.includes('password should be at least')) return 'Password must be at least 6 characters.';
  if (lower.includes('rate limit') || lower.includes('too many')) return 'Too many attempts. Please wait a moment and try again.';
  if (lower.includes('without vite_supabase')) return 'Accounts are unavailable: the backend is not configured.';
  return raw || 'Something went wrong. Please try again.';
}
