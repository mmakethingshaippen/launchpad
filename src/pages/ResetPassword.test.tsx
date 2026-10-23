import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { Routes, Route, MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { ResetPassword } from './ResetPassword';
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

function renderResetPassword(auth: AuthState) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <HelmetProvider>
      <MemoryRouter initialEntries={['/reset-password']}>
        <AuthProvider value={auth}>
          <Routes>
            <Route path="/reset-password" element={children} />
            <Route path="/browse" element={<div>Browse page</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </HelmetProvider>
  );
  return render(<ResetPassword />, { wrapper: Wrapper });
}

describe('ResetPassword page', () => {
  it('updates password and redirects to browse on success', async () => {
    const updatePassword = vi.fn(async () => {});
    const user = userEvent.setup({ delay: null });
    renderResetPassword(baseAuth({ updatePassword }));

    await user.type(screen.getByLabelText(/^New password/i), 'newSecret123');
    await user.type(screen.getByLabelText(/Confirm new password/i), 'newSecret123');
    await user.click(screen.getByRole('button', { name: /Update password/i }));

    expect(updatePassword).toHaveBeenCalledWith('newSecret123');
    await waitFor(() => expect(screen.getByText('Browse page')).toBeInTheDocument());
  });

  it('validates password mismatch and minLength', async () => {
    const user = userEvent.setup({ delay: null });
    renderResetPassword(baseAuth());

    await user.type(screen.getByLabelText(/^New password/i), 'short');
    await user.type(screen.getByLabelText(/Confirm new password/i), 'short');
    await user.click(screen.getByRole('button', { name: /Update password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 6 characters/i);

    await user.clear(screen.getByLabelText(/^New password/i));
    await user.type(screen.getByLabelText(/^New password/i), 'validPassword1');
    await user.clear(screen.getByLabelText(/Confirm new password/i));
    await user.type(screen.getByLabelText(/Confirm new password/i), 'mismatchPassword');
    await user.click(screen.getByRole('button', { name: /Update password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Passwords do not match/i);
  });
});
