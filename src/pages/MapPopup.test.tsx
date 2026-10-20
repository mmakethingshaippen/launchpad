import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { MarkerPopup } from './MapPage';
import { renderWithProviders } from '../test/renderWithProviders';
import type { MapMarker, MapMarkerRole } from '../lib/adapter';
import { LocalAdapter } from '../lib/adapter/local';
import { LocalStore } from '../lib/adapter/localStore.data';

function role(i: number): MapMarkerRole {
  return {
    id: `r${i}`,
    slug: `role-${i}`,
    title: `Software Engineering Intern #${i}`,
    companyName: `Company ${i % 2}`,
    companySlug: `company-${i % 2}`,
    companyLogoUrl: null,
    companyWebsiteUrl: 'https://example.com',
    seasons: ['Summer'],
    cohortYear: 2027,
  };
}

function marker(roleCount: number, over: Partial<MapMarker> = {}): MapMarker {
  const roles = Array.from({ length: roleCount }, (_, i) => role(i));
  return {
    id: '37.35,-121.96',
    label: 'Santa Clara, CA',
    city: 'Santa Clara',
    state: 'CA',
    latitude: 37.3541,
    longitude: -121.9552,
    roleCount,
    companyCount: 2,
    roles,
    ...over,
  };
}

function renderPopup(m: MapMarker) {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<MarkerPopup marker={m} />} />
    </Routes>,
    { adapter: new LocalAdapter(new LocalStore([])), route: '/' },
  );
}

describe('Map popup "+X more"', () => {
  it('initially shows 25 roles and reveals more when "+X more" is clicked', async () => {
    const user = userEvent.setup();
    renderPopup(marker(100));

    // 25 shown initially.
    expect(screen.getByText('Software Engineering Intern #0')).toBeInTheDocument();
    expect(screen.getByText('Software Engineering Intern #24')).toBeInTheDocument();
    expect(screen.queryByText('Software Engineering Intern #25')).not.toBeInTheDocument();

    // Click "+75 more…" → reveals the next 50 (through #74).
    const moreBtn = screen.getByRole('button', { name: /\+75 more/i });
    await user.click(moreBtn);
    expect(screen.getByText('Software Engineering Intern #25')).toBeInTheDocument();
    expect(screen.getByText('Software Engineering Intern #74')).toBeInTheDocument();
    expect(screen.queryByText('Software Engineering Intern #75')).not.toBeInTheDocument();

    // Click again (+25 more) → all 100 roles visible.
    await user.click(screen.getByRole('button', { name: /\+25 more/i }));
    expect(screen.getByText('Software Engineering Intern #99')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /more/i })).not.toBeInTheDocument();
  });

  it('links "View all" to Browse pre-filtered by city', () => {
    renderPopup(marker(100));
    const link = screen.getByRole('link', { name: /View all 100 roles in Browse/i });
    expect(link).toHaveAttribute('href', '/browse?city=Santa+Clara');
  });

  it('shows the real HQ city as the header, never the literal "HQ"', () => {
    renderPopup(marker(3, { label: 'Santa Clara, CA (Remote)' }));
    expect(screen.getByText('Santa Clara, CA (Remote)')).toBeInTheDocument();
    expect(screen.queryByText('HQ')).not.toBeInTheDocument();
  });
});
