import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { RoleCard } from './RoleCard';
import type { RoleCard as RoleCardData } from '../../lib/adapter/types';

function createMockRole(overrides: Partial<RoleCardData> = {}): RoleCardData {
  return {
    id: 'role-1',
    slug: 'ml-research-intern',
    title: 'ML Research Intern',
    companyName: 'Modal',
    companySlug: 'modal',
    companyLogoUrl: null,
    companyWebsiteUrl: 'https://modal.com',
    companyType: 'Startup',
    city: 'San Francisco',
    state: 'CA',
    country: 'United States',
    workArrangement: 'Onsite',
    compensationStatus: 'Paid',
    pay: { min: 5000, max: 5000, currency: 'USD', period: 'month' },
    seasons: ['Summer'],
    cohortYear: 2027,
    opportunityType: 'Internship',
    field: 'Technology',
    degreeLevels: ['Undergraduate'],
    listingStatus: 'Active',
    lastVerifiedAt: new Date().toISOString(),
    applicationDeadline: null,
    applyUrl: 'https://modal.com/jobs/1',
    ...overrides,
  };
}

describe('RoleCard', () => {
  describe('Salary display formatting', () => {
    it('renders a single value when min equals max instead of a range', () => {
      const role = createMockRole({
        pay: { min: 15000, max: 15000, currency: 'USD', period: 'month' },
      });

      render(
        <MemoryRouter>
          <RoleCard role={role} />
        </MemoryRouter>
      );

      // Must show single value "$15,000/month"
      expect(screen.getByText('$15,000/month')).toBeInTheDocument();
      // Must not show range "$15,000–$15,000" or "$15,000 to $15,000"
      expect(screen.queryByText(/15,000.*15,000/)).toBeNull();
    });

    it('renders a range when min differs from max', () => {
      const role = createMockRole({
        pay: { min: 8000, max: 12000, currency: 'USD', period: 'month' },
      });

      render(
        <MemoryRouter>
          <RoleCard role={role} />
        </MemoryRouter>
      );

      expect(screen.getByText('$8,000–$12,000/month')).toBeInTheDocument();
    });

    it('renders a single value when only min is provided', () => {
      const role = createMockRole({
        pay: { min: 5000, max: null, currency: 'USD', period: 'month' },
      });

      render(
        <MemoryRouter>
          <RoleCard role={role} />
        </MemoryRouter>
      );

      expect(screen.getByText('$5,000/month')).toBeInTheDocument();
    });
  });

  describe('Tracked button checkmark and state', () => {
    it('renders exactly one checkmark icon and "Tracked" label without duplicate checkmark character', () => {
      const role = createMockRole();
      const onToggleTrack = vi.fn();

      render(
        <MemoryRouter>
          <RoleCard
            role={role}
            tracked={true}
            onToggleTrack={onToggleTrack}
          />
        </MemoryRouter>
      );

      // The button text must be "Tracked", not "✓ Tracked"
      const trackedButton = screen.getByRole('button', {
        name: /Tracked ML Research Intern\. Click to untrack/i,
      });
      expect(trackedButton).toBeInTheDocument();
      expect(trackedButton.textContent).toBe('Tracked');
      expect(trackedButton.textContent).not.toContain('✓');

      // The SVG check icon should be inside the button
      const svg = trackedButton.querySelector('svg');
      expect(svg).toBeInTheDocument();
      // Only 1 svg inside
      expect(trackedButton.querySelectorAll('svg')).toHaveLength(1);
    });

    it('renders "+ Track" when untracked', async () => {
      const role = createMockRole();
      const onToggleTrack = vi.fn();

      render(
        <MemoryRouter>
          <RoleCard
            role={role}
            tracked={false}
            onToggleTrack={onToggleTrack}
          />
        </MemoryRouter>
      );

      const trackButton = screen.getByRole('button', {
        name: /\+ Track ML Research Intern/i,
      });
      expect(trackButton).toBeInTheDocument();
      expect(trackButton.textContent).toBe('+ Track');

      await userEvent.click(trackButton);
      expect(onToggleTrack).toHaveBeenCalledWith(role);
    });
  });

  describe('Location formatting on cards', () => {
    it('formats international locations without 3-letter country codes', () => {
      const role = createMockRole({
        city: 'Treviso',
        state: 'ITA',
        country: null,
      });

      render(
        <MemoryRouter>
          <RoleCard role={role} />
        </MemoryRouter>
      );

      expect(screen.getByText('Treviso, Italy')).toBeInTheDocument();
      expect(screen.queryByText(/ITA/)).toBeNull();
    });

    it('formats US locations as City, State', () => {
      const role = createMockRole({
        city: 'San Francisco',
        state: 'CA',
        country: 'United States',
      });

      render(
        <MemoryRouter>
          <RoleCard role={role} />
        </MemoryRouter>
      );

      expect(screen.getByText('San Francisco, CA')).toBeInTheDocument();
    });

    it('correctly formats Costa Rica for San Francisco, CRI', () => {
      const role = createMockRole({
        city: 'San Francisco',
        state: 'CRI',
        country: null,
      });

      render(
        <MemoryRouter>
          <RoleCard role={role} />
        </MemoryRouter>
      );

      expect(screen.getByText('San Francisco, Costa Rica')).toBeInTheDocument();
      expect(screen.queryByText(/CRI/)).toBeNull();
    });
  });
});
