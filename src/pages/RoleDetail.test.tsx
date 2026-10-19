import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { RoleDetail } from './RoleDetail';
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
        content: '&lt;p&gt;Join us.&lt;script&gt;alert(1)&lt;/script&gt;&lt;/p&gt;',
        location: { name: 'Remote' },
      },
    ],
  }),
});

async function makeAdapter() {
  const store = new LocalStore(SEED);
  const adapter = new LocalAdapter(store);
  await adapter.ensureSynced(fetchImpl as unknown as typeof fetch);
  return { adapter, store };
}

function renderDetail(adapter: LocalAdapter, slug: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/roles/:slug" element={<RoleDetail />} />
    </Routes>,
    { adapter, route: `/roles/${slug}` },
  );
}

describe('RoleDetail page', () => {
  it('renders an active role with an Apply link and sanitized description', async () => {
    const { adapter } = await makeAdapter();
    const list = await adapter.searchRoles({ ...(await import('../lib/filters')).DEFAULT_FILTERS });
    const slug = list.items[0].slug;

    renderDetail(adapter, slug);
    const apply = await screen.findByRole('link', { name: /Apply on Company Website/i });
    expect(apply).toHaveAttribute('href', 'https://startupco.test/jobs/1');
    expect(apply).toHaveAttribute('rel', 'noopener noreferrer');
    expect(apply).toHaveAttribute('target', '_blank');
    // sanitized: the script from the ATS content must not be present
    expect(document.querySelector('script')).toBeNull();
  });

  it('shows the Closed banner for a role that is no longer active (Req 9.8)', async () => {
    const { adapter, store } = await makeAdapter();
    const list = await adapter.searchRoles({ ...(await import('../lib/filters')).DEFAULT_FILTERS });
    const role = [...store.roles.values()].find((r) => r.slug === list.items[0].slug)!;
    role.listingStatus = 'Closed';

    renderDetail(adapter, role.slug);
    expect(await screen.findByText(/no longer accepting applications/i)).toBeInTheDocument();
    // Apply button is hidden for closed roles
    expect(screen.queryByRole('link', { name: /Apply on Company Website/i })).not.toBeInTheDocument();
  });
});
