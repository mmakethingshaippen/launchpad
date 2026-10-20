import { useState, type FormEvent } from 'react';
import { LogIn } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

export interface SignInFormProps {
  /** Called after a successful sign-in (or sign-up without confirmation). */
  onAuthenticated?: () => void;
  /** Hide the standalone card chrome (used when embedded in a page section). */
  compact?: boolean;
}

/**
 * Reusable email/password sign-in + sign-up form. Used by the /signin page and
 * embedded inline on protected views (e.g. /admin) so users can authenticate in
 * place. Browsing never requires this — it only unlocks synced/admin features.
 */
export function SignInForm({ onAuthenticated, compact = false }: SignInFormProps) {
  const { signIn, signUp, isCloud } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentConfirm, setSentConfirm] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(email, password);
        onAuthenticated?.();
      } else {
        const { needsConfirmation } = await signUp(email, password);
        if (needsConfirmation) setSentConfirm(true);
        else onAuthenticated?.();
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  if (sentConfirm) {
    return (
      <Card className={compact ? 'text-center shadow-none' : 'text-center'}>
        <p className="font-semibold text-navy">Check your email</p>
        <p className="mt-1 text-sm text-slate-500">
          We sent a confirmation link to {email}. Confirm it, then sign in.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => { setMode('signin'); setSentConfirm(false); }}>
          Back to sign in
        </Button>
      </Card>
    );
  }

  return (
    <Card className={compact ? 'shadow-none' : undefined}>
      {!isCloud && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Accounts require a connected Supabase backend. This instance is running in local mode.
        </p>
      )}
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
            <button type="button" onClick={() => { setMode('signup'); setError(null); }} className="text-cyan underline">
              Create one
            </button>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <button type="button" onClick={() => { setMode('signin'); setError(null); }} className="text-cyan underline">
              Sign in
            </button>
          </>
        )}
      </p>
    </Card>
  );
}

/** Map common Supabase auth errors to clear, user-facing messages. */
export function friendlyAuthError(err: unknown): string {
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
