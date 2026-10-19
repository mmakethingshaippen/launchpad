import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
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

async function makeAdapter() {
  const adapter = new LocalAdapter(new LocalStore(SEED));
  await adapter.ensureSynced(fetchImpl as unknown as typeof fetch);
  return adapter;
}

function renderBrowse(adapter: LocalAdapter) {
  return renderWithProviders(
    <Routes>
      <Route path="/browse" element={<Browse />} />
    </Routes>,
    { adapter, route: '/browse' },
  );
}

describe('Browse accessibility', () => {
  let adapter: LocalAdapter;
  beforeEach(async () => {
    adapter = await makeAdapter();
  });

  it('exposes the result count via an aria-live region', async () => {
    renderBrowse(adapter);
    const live = await screen.findByText(/matching active opportunities/i);
    // nearest live region ancestor
    expect(live.closest('[aria-live]')).not.toBeNull();
  });

  it('labels the view tabs and sort control', async () => {
    renderBrowse(adapter);
    await screen.findByText(/matching active opportunities/i);
    expect(screen.getByRole('tab', { name: /Opportunities/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Companies/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Sort by/i })).toBeInTheDocument();
  });

  it('opens the mobile filter drawer as a labelled dialog and closes with Escape', async () => {
    const user = userEvent.setup();
    renderBrowse(adapter);
    await screen.findByText(/matching active opportunities/i);

    await user.click(screen.getByRole('button', { name: /Filters/i }));
    const dialog = await screen.findByRole('dialog', { name: /Filters/i });
    expect(dialog).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /Filters/i })).not.toBeInTheDocument();
  });

  it('gives season quick-pills an accessible pressed state', async () => {
    const user = userEvent.setup();
    renderBrowse(adapter);
    await screen.findByText(/matching active opportunities/i);
    const summer = screen.getByRole('button', { name: 'Summer', pressed: false });
    await user.click(summer);
    expect(screen.getByRole('button', { name: 'Summer', pressed: true })).toBeInTheDocument();
  });
});
