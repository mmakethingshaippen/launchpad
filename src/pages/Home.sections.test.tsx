import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Home } from './Home';
import { renderWithProviders } from '../test/renderWithProviders';
import type { DataAdapter } from '../lib/adapter/adapter';
import type { FeaturedBlocks, RoleCard } from '../lib/adapter/types';

function mockRole(id: string, title: string, companyName: string): RoleCard {
  return {
    id,
    slug: `${companyName.toLowerCase()}-${title.toLowerCase().replace(/\s+/g, '-')}`,
    title,
    companyName,
    companySlug: companyName.toLowerCase(),
    companyLogoUrl: null,
    companyWebsiteUrl: 'https://example.com',
    companyType: 'Established Company',
    city: 'San Francisco',
    state: 'CA',
    country: 'United States',
    workArrangement: 'Onsite',
    compensationStatus: 'Paid',
    pay: { min: 6000, max: 6000, currency: 'USD', period: 'month' },
    seasons: ['Summer'],
    cohortYear: 2027,
    opportunityType: 'Internship',
    field: 'Technology',
    degreeLevels: ['Undergraduate'],
    listingStatus: 'Active',
    lastVerifiedAt: new Date().toISOString(),
    applicationDeadline: null,
    applyUrl: 'https://example.com/apply',
  };
}

describe('Home page sections duplicate prevention', () => {
  it('ensures zero duplicate cards across Recently verified and Upcoming term sections', async () => {
    // Shared role present in both recentlyVerified and byUpcomingTerm raw lists
    const sharedRole = mockRole('role-overlap', 'Overlapping Intern', 'DupeCo');
    const role1 = mockRole('role-1', 'Software Intern', 'AlphaCorp');
    const role2 = mockRole('role-2', 'Product Intern', 'BetaCorp');
    const role3 = mockRole('role-3', 'Data Intern', 'GammaCorp');
    const role4 = mockRole('role-4', 'Hardware Intern', 'DeltaCorp');

    const featuredData: FeaturedBlocks = {
      recentlyVerified: [sharedRole, role1, role2],
      byUpcomingTerm: [sharedRole, role3, role4], // sharedRole is intentionally included here
      featuredCompanies: [
        {
          id: 'comp-1',
          slug: 'alphacorp',
          name: 'AlphaCorp',
          logoUrl: null,
          websiteUrl: 'https://alpha.test',
          careersUrl: null,
          description: 'A tech enterprise.',
          fields: ['Technology'],
          companyType: 'Established Company',
          startupStage: null,
          employeeCountRange: '501+',
          foundingYear: 2010,
          degreeLevels: ['Undergraduate'],
          locations: [
            {
              id: 'loc-1',
              companyId: 'comp-1',
              city: 'San Francisco',
              state: 'CA',
              country: 'United States',
              latitude: 37.7749,
              longitude: -122.4194,
              locationType: 'HQ',
            },
          ],
          activeRoleCount: 10,
        },
      ],
      startupOpportunities: [],
      approachingDeadline: [],
    };

    const mockAdapter: Partial<DataAdapter> = {
      getStats: vi.fn().mockResolvedValue({ companies: 100, activeRoles: 500, cities: 50, startups: 20 }),
      getFeatured: vi.fn().mockResolvedValue(featuredData),
      listApplications: vi.fn().mockResolvedValue([]),
    };

    renderWithProviders(<Home />, {
      adapter: mockAdapter as DataAdapter,
      route: '/',
    });

    // Wait for featured sections to render
    const recentHeading = await screen.findByRole('heading', {
      name: /Recently verified internships/i,
    });
    expect(recentHeading).toBeInTheDocument();

    const upcomingHeading = await screen.findByRole('heading', {
      name: /Upcoming term opportunities/i,
    });
    expect(upcomingHeading).toBeInTheDocument();

    // The sharedRole (Overlapping Intern) must only appear ONCE across the entire page
    const overlappingElements = screen.getAllByText('Overlapping Intern');
    expect(overlappingElements).toHaveLength(1);

    // Each other role should also appear exactly once
    expect(screen.getAllByText('Software Intern')).toHaveLength(1);
    expect(screen.getAllByText('Product Intern')).toHaveLength(1);
    expect(screen.getAllByText('Data Intern')).toHaveLength(1);
    expect(screen.getAllByText('Hardware Intern')).toHaveLength(1);

    // Collect all unique role links to ensure exactly 5 distinct roles are shown
    const allRoleLinks = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('href')?.startsWith('/roles/'));
    const hrefs = allRoleLinks.map((l) => l.getAttribute('href'));
    const uniqueHrefs = new Set(hrefs);
    expect(uniqueHrefs.size).toBe(5);
    expect(uniqueHrefs.has('/roles/dupeco-overlapping-intern')).toBe(true);
    expect(uniqueHrefs.has('/roles/alphacorp-software-intern')).toBe(true);
    expect(uniqueHrefs.has('/roles/betacorp-product-intern')).toBe(true);
    expect(uniqueHrefs.has('/roles/gammacorp-data-intern')).toBe(true);
    expect(uniqueHrefs.has('/roles/deltacorp-hardware-intern')).toBe(true);
  });
});
