import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { resolveAdapterMode } from '../lib/adapter';

export interface AuthUser {
  id: string;
  email: string | null;
  accountRole: 'student' | 'admin';
}

export interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  isCloud: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /** Returns true if a session was created (email confirmation disabled), false if a confirmation email was sent. */
  signUp: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Auth provider. In cloud mode it wires Supabase Auth; in local mode it exposes
 * a no-session state so browsing works without credentials (Req 1, 21).
 * A test harness can inject a value to simulate an authenticated user.
 */
export function AuthProvider({ children, value }: { children: ReactNode; value?: AuthState }) {
  if (value) return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
  return <SupabaseAuthProvider>{children}</SupabaseAuthProvider>;
}

function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const isCloud = resolveAdapterMode() === 'supabase';
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(isCloud);

  useEffect(() => {
    if (!isCloud) {
      setLoading(false);
      return;
    }
    let active = true;
    let unsub: (() => void) | undefined;

    (async () => {
      const { getSupabaseClient } = await import('../lib/supabaseClient');
      const db = getSupabaseClient();

      const hydrate = async () => {
        const { data } = await db.auth.getUser();
        if (!active) return;
        if (!data.user) {
          setUser(null);
          setLoading(false);
          return;
        }
        const { data: profile } = await db
          .from('user_profiles')
          .select('account_role')
          .eq('id', data.user.id)
          .maybeSingle();
        setUser({
          id: data.user.id,
          email: data.user.email ?? null,
          accountRole: (profile?.account_role as 'student' | 'admin') ?? 'student',
        });
        setLoading(false);
      };

      await hydrate();
      const { data: sub } = db.auth.onAuthStateChange(() => {
        void hydrate();
      });
      unsub = () => sub.subscription.unsubscribe();
    })();

    return () => {
      active = false;
      unsub?.();
    };
  }, [isCloud]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { getSupabaseClient } = await import('../lib/supabaseClient');
    const { error } = await getSupabaseClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { getSupabaseClient } = await import('../lib/supabaseClient');
    const { data, error } = await getSupabaseClient().auth.signUp({ email, password });
    if (error) throw error;
    // If a session is present, email confirmation is disabled and the user is
    // already signed in. Otherwise a confirmation email was sent.
    return { needsConfirmation: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    const { getSupabaseClient } = await import('../lib/supabaseClient');
    await getSupabaseClient().auth.signOut();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, isCloud, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
