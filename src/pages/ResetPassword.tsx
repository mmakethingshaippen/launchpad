import { useState, type FormEvent } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate, Link } from 'react-router-dom';
import { KeyRound, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { friendlyAuthError } from '../components/auth/SignInForm';

export function ResetPassword() {
  const { updatePassword, isCloud } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await updatePassword(password);
      setSuccess(true);
      navigate('/browse', { replace: true });
    } catch (err) {
      setError(friendlyAuthError(err));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md">
      <Helmet>
        <title>Reset Password — Launchpad</title>
      </Helmet>

      <h1 className="mb-2 text-2xl font-bold text-navy">Set a new password</h1>
      <p className="mb-6 text-sm text-slate-500">
        Choose a strong password with at least 6 characters.
      </p>

      <Card>
        {!isCloud && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Accounts require a connected Supabase backend. This instance is running in local mode.
          </p>
        )}

        {success ? (
          <div className="space-y-3 py-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" aria-hidden="true" />
            </div>
            <p className="font-semibold text-navy">Password updated successfully!</p>
            <p className="text-xs text-slate-500">Redirecting you to Browse…</p>
            <Link to="/browse">
              <Button className="mt-2" variant="outline">
                Go to Browse now
              </Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-navy">New password</span>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="At least 6 characters"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-navy">Confirm new password</span>
              <input
                type="password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Re-enter your new password"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan"
              />
            </label>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={busy || !isCloud}>
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              {busy ? 'Updating password…' : 'Update password'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
