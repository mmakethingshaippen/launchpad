import { describe, it, expect } from 'vitest';
import { waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { Home } from './Home';
import { CompanyProfile } from './CompanyProfile';
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
  json: async () => ({ jobs: [] }),
});

async function makeAdapter() {
  const adapter = new LocalAdapter(new LocalStore(SEED));
  await adapter.ensureSynced(fetchImpl as unknown as typeof fetch);
  return adapter;
}

describe('SEO metadata', () => {
  it('sets the Home document title', async () => {
    const adapter = await makeAdapter();
    renderWithProviders(<Home />, { adapter, route: '/' });
    await waitFor(() => expect(document.title).toMatch(/Launchpad/));
    await waitFor(() => expect(document.title).toMatch(/career starts somewhere/i));
  });

  it('sets a company-specific title on the profile page', async () => {
    const adapter = await makeAdapter();
    renderWithProviders(
      <Routes>
        <Route path="/companies/:slug" element={<CompanyProfile />} />
      </Routes>,
      { adapter, route: '/companies/startupco' },
    );
    await waitFor(() => expect(document.title).toMatch(/StartupCo — Launchpad/));
  });
});
