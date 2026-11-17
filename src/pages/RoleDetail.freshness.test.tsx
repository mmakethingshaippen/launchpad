import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { RoleDetail } from './RoleDetail';
import { renderWithProviders } from '../test/renderWithProviders';
import type { DataAdapter } from '../lib/adapter/adapter';
import type { RoleDetailView } from '../lib/adapter/types';

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

function detail(overrides: Partial<RoleDetailView> = {}): RoleDetailView {
  return {
    id: 'r1', slug: 'acme-data-intern', title: 'Data Intern', companyName: 'Acme', companySlug: 'acme',
    companyLogoUrl: null, companyWebsiteUrl: null, companyType: 'Established Company',
    city: 'Austin', state: 'TX', country: 'USA', workArrangement: 'Onsite', compensationStatus: 'Paid', pay: null,
    seasons: ['Summer'], cohortYear: 2027, opportunityType: 'Internship', field: 'Technology', degreeLevels: [],
    listingStatus: 'Active', lastVerifiedAt: daysAgo(1), applicationDeadline: null,
    applyUrl: 'https://jobs.acme.test/1', description: '<p>About</p>', workSchedule: 'Full-time', duration: null,
    source: 'aggregator', sourceUrl: null,
    ...overrides,
  } as RoleDetailView;
}

function renderDetail(role: RoleDetailView) {
  const adapter: Partial<DataAdapter> = {
    getRole: vi.fn().mockResolvedValue(role),
    listApplications: vi.fn().mockResolvedValue([]),
  };
  return renderWithProviders(
    <Routes><Route path="/roles/:slug" element={<RoleDetail />} /></Routes>,
    { adapter: adapter as DataAdapter, route: `/roles/${role.slug}` },
  );
}

const MESSAGE = /This listing is temporarily unavailable while we verify it/;

describe('RoleDetail freshness', () => {
  it('credits Himalayas even without a description and preserves its Apply link', async () => {
    const sourceUrl = 'https://himalayas.app/companies/acme/jobs/data-intern';
    const applyUrl = `${sourceUrl}?utm_source=api&ref=original`;
    renderDetail(detail({ sourceUrl, applyUrl, description: null }));
    expect(await screen.findByRole('link', { name: 'Himalayas' })).toHaveAttribute('href', sourceUrl);
    expect(screen.getByRole('link', { name: /Apply via Himalayas/ })).toHaveAttribute('href', applyUrl);
    expect(screen.queryByText('Apply on Company Website')).toBeNull();
  });
  it('shows the temporarily unavailable message for a job not verified in seven days', async () => {
    renderDetail(detail({ lastVerifiedAt: daysAgo(10) }));
    expect(await screen.findByText(MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to Browse/i })).toHaveAttribute('href', '/browse');
    expect(screen.queryByText(/Apply on Company Website/)).toBeNull();
    expect(screen.queryByText(/no longer accepting applications/i)).toBeNull();
    expect(screen.queryByText(/expired/i)).toBeNull();
  });

  it('treats a never-verified job the same way', async () => {
    renderDetail(detail({ lastVerifiedAt: null }));
    expect(await screen.findByText(MESSAGE)).toBeInTheDocument();
  });

  it('shows the full listing once the job is freshly verified', async () => {
    renderDetail(detail({ lastVerifiedAt: daysAgo(1) }));
    expect(await screen.findByText(/Apply on Company Website/)).toBeInTheDocument();
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it('keeps the existing closed banner for closed jobs', async () => {
    renderDetail(detail({ listingStatus: 'Closed', lastVerifiedAt: daysAgo(30) }));
    expect(await screen.findByText(/no longer accepting applications/i)).toBeInTheDocument();
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });
});
