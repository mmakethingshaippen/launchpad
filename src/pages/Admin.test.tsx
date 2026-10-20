import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdapterProvider } from '../hooks/useAdapter';
import { AuthProvider, type AuthState } from '../hooks/useAuth';
import { Admin } from './Admin';
import type { DataAdapter, PendingQueue, ListingReport } from '../lib/adapter';

function adminAuth(role: 'student' | 'admin' | null): AuthState {
  return {
    user: role ? { id: 'u1', email: 'a@b.c', accountRole: role } : null,
    loading: false,
    isCloud: true,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
  };
}

function makeAdapter(): DataAdapter {
  return {
    listPending: async (): Promise<PendingQueue> => ({ companies: [], roles: [] }),
    listReports: async (): Promise<ListingReport[]> => [],
    moderateCompany: vi.fn(),
    moderateRole: vi.fn(),
    resolveReport: vi.fn(),
    sync: vi.fn(),
  } as unknown as DataAdapter;
}

function renderAdmin(auth: AuthState) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/admin']}>
          <AdapterProvider adapter={makeAdapter()}>
            <AuthProvider value={auth}>{children}</AuthProvider>
          </AdapterProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
  return render(<Admin />, { wrapper: Wrapper });
}

describe('Admin guard', () => {
  it('shows the inline sign-in form to anonymous users (no dashboard)', () => {
    renderAdmin(adminAuth(null));
    expect(screen.getByRole('heading', { name: /Admin sign in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Sign in$/i })).toBeInTheDocument();
    expect(screen.queryByText(/Admin Dashboard/i)).not.toBeInTheDocument();
  });

  it('blocks signed-in non-admin students with an access message', () => {
    renderAdmin(adminAuth('student'));
    expect(screen.getByText(/Admin access required/i)).toBeInTheDocument();
    expect(screen.queryByText(/Admin Dashboard/i)).not.toBeInTheDocument();
  });

  it('renders the dashboard for admins', async () => {
    renderAdmin(adminAuth('admin'));
    expect(await screen.findByRole('heading', { name: /Admin Dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sync all companies/i })).toBeInTheDocument();
  });
});
