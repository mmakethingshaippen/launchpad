import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { Routes, Route, MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { SignIn } from './SignIn';
import { AuthProvider, type AuthState } from '../hooks/useAuth';

function baseAuth(overrides: Partial<AuthState> = {}): AuthState {
  return {
    user: null,
    loading: false,
    isCloud: true,
    signIn: vi.fn(async () => {}),
    signUp: vi.fn(async () => ({ needsConfirmation: true })),
    signOut: vi.fn(async () => {}),
    resetPasswordForEmail: vi.fn(async () => {}),
    updatePassword: vi.fn(async () => {}),
    ...overrides,
  };
}

function renderSignIn(auth: AuthState) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <HelmetProvider>
      <MemoryRouter initialEntries={['/signin']}>
        <AuthProvider value={auth}>
          <Routes>
            <Route path="/signin" element={children} />
            <Route path="/applications" element={<div>Applications page</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </HelmetProvider>
  );
  return render(<SignIn />, { wrapper: Wrapper });
}

describe('SignIn page', () => {
  it('shows a clear error when sign-in fails', async () => {
    const signIn = vi.fn(async () => {
      throw new Error('Invalid login credentials');
    });
    const user = userEvent.setup({ delay: null });
    renderSignIn(baseAuth({ signIn }));

    await user.type(screen.getByLabelText(/Email/i), 'a@b.c');
    await user.type(screen.getByLabelText(/Password/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /Sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Incorrect email or password/i);
  });

  it('redirects to applications on successful sign-in', async () => {
    const user = userEvent.setup({ delay: null });
    renderSignIn(baseAuth({ signIn: vi.fn(async () => {}) }));

    await user.type(screen.getByLabelText(/Email/i), 'a@b.c');
    await user.type(screen.getByLabelText(/Password/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /Sign in/i }));

    expect(await screen.findByText('Applications page')).toBeInTheDocument();
  });

  it('shows the confirmation card when sign-up needs email confirmation', async () => {
    const user = userEvent.setup({ delay: null });
    renderSignIn(baseAuth({ signUp: vi.fn(async () => ({ needsConfirmation: true })) }));

    await user.click(screen.getByRole('button', { name: /Create one/i }));
    await user.type(screen.getByLabelText(/Email/i), 'new@b.c');
    await user.type(screen.getByLabelText(/Password/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /Create account/i }));

    expect(await screen.findByText(/Check your email/i)).toBeInTheDocument();
  });

  it('redirects on sign-up when email confirmation is disabled', async () => {
    const user = userEvent.setup({ delay: null });
    renderSignIn(baseAuth({ signUp: vi.fn(async () => ({ needsConfirmation: false })) }));

    await user.click(screen.getByRole('button', { name: /Create one/i }));
    await user.type(screen.getByLabelText(/Email/i), 'new@b.c');
    await user.type(screen.getByLabelText(/Password/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /Create account/i }));

    expect(await screen.findByText('Applications page')).toBeInTheDocument();
  });


  it('allows requesting a password reset link', async () => {
    const resetPasswordForEmail = vi.fn(async () => {});
    const user = userEvent.setup({ delay: null });
    renderSignIn(baseAuth({ resetPasswordForEmail }));

    await user.click(screen.getByRole('button', { name: /Forgot password?/i }));
    expect(screen.getByRole('heading', { name: /Reset your password/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Email/i), 'reset@example.com');
    await user.click(screen.getByRole('button', { name: /Send reset link/i }));

    expect(resetPasswordForEmail).toHaveBeenCalledWith('reset@example.com');
    expect(await screen.findByText(/Reset link sent!/i)).toBeInTheDocument();
  });

  it('disables the submit button in local mode', () => {
    renderSignIn(baseAuth({ isCloud: false }));
    expect(screen.getByRole('button', { name: /Sign in/i })).toBeDisabled();
    expect(screen.getByText(/running in local mode/i)).toBeInTheDocument();
  });

  it('redirects away immediately if already signed in', async () => {
    renderSignIn(baseAuth({ user: { id: 'u1', email: 'a@b.c', accountRole: 'student' } }));
    await waitFor(() => expect(screen.getByText('Applications page')).toBeInTheDocument());
  });
});
