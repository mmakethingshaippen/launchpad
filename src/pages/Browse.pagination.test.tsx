import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { Browse } from './Browse';
import { renderWithProviders } from '../test/renderWithProviders';
import type { DataAdapter } from '../lib/adapter';
import type { Paginated, RoleCard, CompanyCard } from '../lib/adapter/types';
import type { RoleFilters } from '../lib/filters';
import { PAGE_SIZE } from '../lib/adapter/supabaseQuery';

// ── Synthetic datasets that exceed the PostgREST 1,000-row cap. ──────────────
const ROLE_TOTAL = 1592;
const COMPANY_TOTAL = 84;

function makeRole(i: number): RoleCard {
  return {
    id: `role-${i}`,
    slug: `role-${i}`,
    title: `Software Engineering Intern #${i}`,
    companyName: `Company ${i}`,
    companySlug: `company-${i}`,
    companyLogoUrl: null,
    companyWebsiteUrl: null,
    companyType: 'Startup',
    seasons: ['Summer'],
    cohortYear: 2027,
    field: 'Technology',
    city: 'Austin',
    state: 'TX',
    country: 'USA',
    workArrangement: 'Onsite',
    degreeLevels: ['Undergraduate'],
    opportunityType: 'Internship',
    compensationStatus: 'Paid',
    pay: null,
    applicationDeadline: null,
    lastVerifiedAt: new Date().toISOString(),
    listingStatus: 'Active',
  };
}

function makeCompany(i: number): CompanyCard {
  return {
    id: `co-${i}`,
    slug: `co-${i}`,
    name: `Company ${i}`,
    logoUrl: null,
    websiteUrl: null,
    fields: ['Technology'],
    companyType: 'Startup',
    startupStage: null,
    employeeCountRange: null,
    foundingYear: null,
    description: null,
    careersUrl: null,
    degreeLevels: ['Undergraduate'],
    locations: [],
    activeRoleCount: 3,
  };
}

const ALL_ROLES = Array.from({ length: ROLE_TOTAL }, (_, i) => makeRole(i));
const ALL_COMPANIES = Array.from({ length: COMPANY_TOTAL }, (_, i) => makeCompany(i));

/** Minimal adapter that paginates the synthetic datasets at PAGE_SIZE. */
function makeFakeAdapter(): DataAdapter {
  const page = <T,>(items: T[], filters: RoleFilters): Paginated<T> => {
    const start = (filters.page - 1) * PAGE_SIZE;
    return {
      items: items.slice(start, start + PAGE_SIZE),
      total: items.length,
      page: filters.page,
      pageSize: PAGE_SIZE,
    };
  };
  return {
    searchRoles: async (f) => page(ALL_ROLES, f),
    searchCompanies: async (f) => page(ALL_COMPANIES, f),
    getRole: async () => null,
    getCompany: async () => null,
    getStats: async () => ({ companies: 0, activeRoles: 0, startups: 0, cities: 0 }),
    getFeatured: async () => ({
      featuredCompanies: [],
      startupOpportunities: [],
      recentlyVerified: [],
      byUpcomingTerm: [],
      approachingDeadline: [],
    }),
    getMapMarkers: async () => [],
    listSaved: async () => [],
    save: async () => {},
    unsave: async () => {},
    listApplications: async () => [],
    upsertApplication: async () => {},
    deleteApplication: async () => {},
    submitCompany: async () => {},
    submitRole: async () => {},
    reportListing: async () => {},
  } as DataAdapter;
}

function renderBrowse(route = '/browse') {
  return renderWithProviders(
    <Routes>
      <Route path="/browse" element={<Browse />} />
    </Routes>,
    { adapter: makeFakeAdapter(), route },
  );
}

describe('Browse pagination (>1,000 roles)', () => {
  beforeEach(() => {
    // jsdom lacks smooth scroll; stub it so goToPage doesn't throw.
    window.scrollTo = (() => {}) as typeof window.scrollTo;
  });

  it('shows exactly 21 role cards on a page and the correct total', async () => {
    renderBrowse();
    await screen.findByText('Software Engineering Intern #0');
    const cards = screen.getAllByText(/Software Engineering Intern #/);
    expect(cards).toHaveLength(PAGE_SIZE);
    expect(PAGE_SIZE).toBe(21);
    expect(screen.getByText(/1592 matching active opportunities/i)).toBeInTheDocument();
    expect(screen.getByTestId('pagination-summary')).toHaveTextContent(
      'Showing 1–21 of 1,592 opportunities',
    );
  });

  it('navigates to the next page and the last page, reaching roles beyond #1,000', async () => {
    const user = userEvent.setup();
    renderBrowse();
    await screen.findByText('Software Engineering Intern #0');

    // Next → page 2 shows items 21–41.
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Software Engineering Intern #21')).toBeInTheDocument();
    expect(screen.getByTestId('pagination-summary')).toHaveTextContent('Showing 22–42 of 1,592');

    // Jump to the final page (ceil(1592/21) = 76) and confirm the tail role is reachable.
    const lastPage = Math.ceil(ROLE_TOTAL / PAGE_SIZE); // 76
    await user.click(screen.getByRole('button', { name: `Page ${lastPage}` }));
    // Last page holds roles #1575..#1591 — well past the 1,000-row PostgREST cap.
    expect(await screen.findByText('Software Engineering Intern #1591')).toBeInTheDocument();
  }, 15000);

  it('resets to page 1 when a filter (season pill) changes', async () => {
    const user = userEvent.setup();
    renderBrowse('/browse?page=3');
    await screen.findByText('Software Engineering Intern #42'); // page 3 → items 42+
    expect(screen.getByTestId('pagination-summary')).toHaveTextContent('Showing 43–63 of 1,592');

    await user.click(screen.getByRole('checkbox', { name: 'Summer' }));
    // Back to page 1 after the filter change.
    expect(await screen.findByText('Software Engineering Intern #0')).toBeInTheDocument();
    expect(screen.getByTestId('pagination-summary')).toHaveTextContent('Showing 1–21 of 1,592');
  }, 15000);

  it('resets to page 1 and paginates the Companies tab at 21 per page', async () => {
    const user = userEvent.setup();
    renderBrowse('/browse?page=3');
    await screen.findByText('Software Engineering Intern #42');

    await user.click(screen.getByRole('tab', { name: /Companies/i }));
    // Switching view resets to page 1 and shows 21 companies.
    expect(await screen.findByText('Company 0')).toBeInTheDocument();
    expect(screen.getByText(/84 matching companies/i)).toBeInTheDocument();
    expect(screen.getByTestId('pagination-summary')).toHaveTextContent('Showing 1–21 of 84 companies');

    // All 84 companies are reachable: last page (ceil(84/21)=4) shows Company 83.
    await user.click(screen.getByRole('button', { name: 'Page 4' }));
    expect(await screen.findByText('Company 83')).toBeInTheDocument();
  }, 15000);
});
