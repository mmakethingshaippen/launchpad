import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { Browse } from './Browse';
import { LocalAdapter } from '../lib/adapter/local';
import { LocalStore } from '../lib/adapter/localStore.data';
import type { SeedCompany } from '../data/seed-companies';
import type { FetchLike } from '../lib/ats/types';
import { renderWithProviders } from '../test/renderWithProviders';

const SEED: SeedCompany[] = [
  {
    slug: 'startupco',
    name: 'StartupCo',
    websiteUrl: 'https://startupco.test',
    careersUrl: 'https://startupco.test/careers',
    description: 'A startup.',
    fields: ['Technology'],
    companyType: 'Startup',
    startupStage: 'Seed',
    employeeCountRange: '11-50',
    degreeLevels: ['Undergraduate'],
    atsProvider: 'greenhouse',
    atsBoardToken: 'startupco',
    locations: [{ city: 'Austin', state: 'TX', country: 'USA', latitude: 30, longitude: -97 }],
  },
  {
    slug: 'bigco',
    name: 'BigCo',
    websiteUrl: 'https://bigco.test',
    careersUrl: 'https://bigco.test/careers',
    description: 'Established.',
    fields: ['Finance'],
    companyType: 'Established Company',
    employeeCountRange: '501+',
    degreeLevels: ['Undergraduate', 'Graduate'],
    atsProvider: 'greenhouse',
    atsBoardToken: 'bigco',
    locations: [{ city: 'New York', state: 'NY', country: 'USA', latitude: 40, longitude: -74 }],
  },
];

const fetchImpl: FetchLike = async (url) => {
  const job = (id: number, title: string, remote = false) => ({
    id,
    title,
    absolute_url: `https://x/jobs/${id}`,
    content: '&lt;p&gt;d&lt;/p&gt;',
    location: { name: remote ? 'Remote' : 'Austin, TX, USA' },
  });
  const payload = url.includes('/startupco/')
    ? { jobs: [job(1, 'Summer 2027 Software Intern', true)] }
    : { jobs: [job(2, 'New Grad Financial Analyst')] };
  return { ok: true, status: 200, json: async () => payload };
};

async function makeAdapter() {
  const adapter = new LocalAdapter(new LocalStore(SEED));
  await adapter.ensureSynced(fetchImpl as unknown as typeof fetch);
  return adapter;
}

function renderBrowse(adapter: LocalAdapter, route = '/browse') {
  return renderWithProviders(
    <Routes>
      <Route path="/browse" element={<Browse />} />
    </Routes>,
    { adapter, route },
  );
}

describe('Browse page', () => {
  let adapter: LocalAdapter;
  beforeEach(async () => {
    adapter = await makeAdapter();
  });

  it('shows the opportunities view by default with both roles', async () => {
    renderBrowse(adapter);
    expect(await screen.findByText('Summer 2027 Software Intern')).toBeInTheDocument();
    expect(screen.getByText('New Grad Financial Analyst')).toBeInTheDocument();
    expect(screen.getByText(/2 matching active opportunities/i)).toBeInTheDocument();
  });

  it('filters startup-only via URL state', async () => {
    renderBrowse(adapter, '/browse?company=Startup');
    expect(await screen.findByText('Summer 2027 Software Intern')).toBeInTheDocument();
    expect(screen.queryByText('New Grad Financial Analyst')).not.toBeInTheDocument();
  });

  it('filters by Summer season via the sidebar Season / Term checkbox', async () => {
    const user = userEvent.setup();
    renderBrowse(adapter);
    await screen.findByText('Summer 2027 Software Intern');
    // The duplicate top pill row was removed; Season/Term is a sidebar checkbox.
    await user.click(screen.getByRole('checkbox', { name: 'Summer' }));
    await waitFor(() =>
      expect(screen.queryByText('New Grad Financial Analyst')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Summer 2027 Software Intern')).toBeInTheDocument();
  }, 15000);

  it('switches to the companies view', async () => {
    const user = userEvent.setup();
    renderBrowse(adapter);
    await screen.findByText('Summer 2027 Software Intern');
    await user.click(screen.getByRole('tab', { name: /Companies/i }));
    expect(await screen.findByText(/2 matching companies/i)).toBeInTheDocument();
    expect(screen.getByText('StartupCo')).toBeInTheDocument();
    expect(screen.getByText('BigCo')).toBeInTheDocument();
  }, 15000);

  it('shows an empty state with a clear action for impossible filters', async () => {
    renderBrowse(adapter, '/browse?field=Healthcare');
    expect(await screen.findByText(/No results match your filters/i)).toBeInTheDocument();
  });

  it('renders removable active-filter chips', async () => {
    renderBrowse(adapter, '/browse?company=Startup');
    await screen.findByText('Summer 2027 Software Intern');
    const chip = screen.getByRole('button', { name: /Startup/i });
    expect(within(chip).getByText('Startup')).toBeInTheDocument();
  });
});
