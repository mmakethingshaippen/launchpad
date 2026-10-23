import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { Navbar } from './Navbar';
import { AuthProvider, type AuthState } from '../../hooks/useAuth';

function auth(overrides: Partial<AuthState> = {}): AuthState {
  return {
    user: null,
    loading: false,
    isCloud: true,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updatePassword: vi.fn(),
    ...overrides,
  };
}

function renderNavbar(state: AuthState) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <AuthProvider value={state}>{children}</AuthProvider>
    </MemoryRouter>
  );
  return render(<Navbar />, { wrapper: Wrapper });
}

describe('Navbar auth controls', () => {
  it('shows a Sign In button when signed out (cloud mode)', () => {
    renderNavbar(auth());
    const signIn = screen.getByRole('link', { name: /Sign In/i });
    expect(signIn).toBeInTheDocument();
    expect(signIn).toHaveAttribute('href', '/signin');
    expect(screen.queryByRole('button', { name: /Sign Out/i })).not.toBeInTheDocument();
  });

  it('hides Sign In in local mode (no backend)', () => {
    renderNavbar(auth({ isCloud: false }));
    expect(screen.queryByRole('link', { name: /Sign In/i })).not.toBeInTheDocument();
  });

  it('shows email and Sign Out when signed in as a student', () => {
    renderNavbar(auth({ user: { id: 'u1', email: 'stu@dent.edu', accountRole: 'student' } }));
    expect(screen.getByText('stu@dent.edu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign Out/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Admin$/i })).not.toBeInTheDocument();
  });

  it('shows an Admin link when signed in as an admin', () => {
    renderNavbar(auth({ user: { id: 'a1', email: 'admin@site.com', accountRole: 'admin' } }));
    const adminLink = screen.getByRole('link', { name: /Admin/i });
    expect(adminLink).toHaveAttribute('href', '/admin');
    expect(screen.getByRole('button', { name: /Sign Out/i })).toBeInTheDocument();
  });
});
