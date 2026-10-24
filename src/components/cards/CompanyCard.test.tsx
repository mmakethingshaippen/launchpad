import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CompanyCard } from './CompanyCard';
import type { CompanyCard as CompanyCardData } from '../../lib/adapter/types';

describe('CompanyCard', () => {
  it('hides the simplify placeholder description and deduplicates fields', () => {
    const mockCompany: CompanyCardData = {
      id: 'comp-1',
      slug: 'applied-materials',
      name: 'Applied Materials',
      logoUrl: null,
      websiteUrl: 'https://appliedmaterials.com',
      careersUrl: 'https://appliedmaterials.com/careers',
      description: 'Opportunities aggregated from simplify.',
      // Intentionally including duplicate string for deduplication test
      fields: ['Technology', 'technology' as never, 'Engineering'],
      companyType: 'Established Company',
      startupStage: null,
      foundingYear: 1967,
      degreeLevels: ['Undergraduate'],
      employeeCountRange: '501+',
      locations: [
        {
          id: 'loc-1',
          companyId: 'comp-1',
          city: 'Penang',
          state: 'MYS',
          country: 'Malaysia',
          latitude: 5.4141,
          longitude: 100.3288,
          locationType: 'Office',
        },
      ],
      activeRoleCount: 88,
    };

    render(
      <MemoryRouter>
        <CompanyCard company={mockCompany} />
      </MemoryRouter>
    );

    // Placeholder must not be visible anywhere
    expect(screen.queryByText(/Opportunities aggregated from simplify/i)).toBeNull();

    // Deduplicated fields: exactly one Technology badge
    const techBadges = screen.getAllByText('Technology');
    expect(techBadges).toHaveLength(1);
    expect(screen.getByText('Engineering')).toBeInTheDocument();

    // Location formatted without raw 3-letter country code
    expect(screen.getByText(/Penang, Malaysia/)).toBeInTheDocument();
    expect(screen.queryByText(/Penang, MYS/)).toBeNull();
  });

  it('renders a genuine description when present', () => {
    const mockCompany: CompanyCardData = {
      id: 'comp-2',
      slug: 'modal',
      name: 'Modal Labs',
      logoUrl: null,
      websiteUrl: 'https://modal.com',
      careersUrl: null,
      description: 'High-performance cloud compute for AI and machine learning.',
      fields: ['Technology'],
      companyType: 'Startup',
      startupStage: 'Series A',
      foundingYear: 2021,
      degreeLevels: ['Undergraduate'],
      employeeCountRange: '11-50',
      locations: [
        {
          id: 'loc-2',
          companyId: 'comp-2',
          city: 'San Francisco',
          state: 'CA',
          country: 'United States',
          latitude: 37.7749,
          longitude: -122.4194,
          locationType: 'HQ',
        },
      ],
      activeRoleCount: 5,
    };

    render(
      <MemoryRouter>
        <CompanyCard company={mockCompany} />
      </MemoryRouter>
    );

    expect(
      screen.getByText('High-performance cloud compute for AI and machine learning.')
    ).toBeInTheDocument();
    expect(screen.getByText('San Francisco, CA')).toBeInTheDocument();
  });
});
