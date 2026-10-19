import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyApplications } from './MyApplications';
import { LocalAdapter } from '../lib/adapter/local';
import { LocalStore } from '../lib/adapter/localStore.data';
import { AuthProvider, type AuthState } from '../hooks/useAuth';
import type { SeedCompany } from '../data/seed-companies';
import type { FetchLike } from '../lib/ats/types';
import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdapterProvider } from '../hooks/useAdapter';
import * as localStore from '../lib/localStore';

const SEED: SeedCompany[] = [
  {
    slug: 'startupco',
    name: 'StartupCo',
    websiteUrl: 'https://startupco.test',
    careersUrl: 'https://startupco.test/careers',
    description: 'A startup.',
    fields: ['Technology'],
    companyType: 'Startup',
    degreeLevels: ['Undergraduate'],
    atsProvider: 'greenhouse',
    atsBoardToken: 'startupco',
    locations: [{ city: 'Austin', state: 'TX', country: 'USA', latitude: 30, longitude: -97 }],
  },
];

const fetchImpl: FetchLike = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    jobs: [
      {
        id: 1,
        title: 'Summer 2027 Software Intern',
        absolute_url: 'https://startupco.test/jobs/1',
        content: '&lt;p&gt;d&lt;/p&gt;',
        location: { name: 'Remote' },
      },
    ],
  }),
});

const anonAuth: AuthState = {
  user: null,
  loading: false,
  isCloud: false,
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
};

function renderPage(adapter: LocalAdapter) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/applications']}>
          <AdapterProvider adapter={adapter}>
            <AuthProvider value={anonAuth}>{children}</AuthProvider>
          </AdapterProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );
  return render(<MyApplications />, { wrapper: Wrapper });
}

describe('MyApplications', () => {
  let adapter: LocalAdapter;

  beforeEach(async () => {
    localStore.clearSaved();
    localStore.clearApplications();
    adapter = new LocalAdapter(new LocalStore(SEED));
    await adapter.ensureSynced(fetchImpl as unknown as typeof fetch);
  });

  it('shows saved opportunities in the Saved tab', async () => {
    const list = await adapter.searchRoles({ ...(await import('../lib/filters')).DEFAULT_FILTERS });
    await adapter.save(list.items[0].id);

    renderPage(adapter);
    expect(await screen.findByText('Summer 2027 Software Intern')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Saved Opportunities \(1\)/i })).toBeInTheDocument();
  });

  it('shows a tracked application with an overdue follow-up badge', async () => {
    localStore.upsertApplication({
      companyName: 'Manual Co',
      roleTitle: 'Analyst',
      status: 'Interviewing',
      followUpDate: '2020-01-01', // in the past → overdue
    });

    const user = userEvent.setup();
    renderPage(adapter);
    await user.click(screen.getByRole('tab', { name: /Tracked Applications/i }));

    expect(await screen.findByText('Analyst')).toBeInTheDocument();
    expect(screen.getByText('Manual Co')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Follow-up overdue/i)).toBeInTheDocument());
  });
});
