import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { Resources, ResourceGuide } from './Resources';
import { GUIDES } from '../data/resources';
import type { DataAdapter } from '../lib/adapter';
import { renderWithProviders } from '../test/renderWithProviders';

const adapter = {} as DataAdapter;

describe('Resources', () => {
  it('lists all four guides on the index', () => {
    renderWithProviders(<Resources />, { adapter, route: '/resources' });
    expect(GUIDES).toHaveLength(4);
    for (const g of GUIDES) {
      expect(screen.getByText(g.title)).toBeInTheDocument();
    }
  });

  it('renders a single guide at its shareable URL', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/resources/:slug" element={<ResourceGuide />} />
      </Routes>,
      { adapter, route: '/resources/finding-unlisted-internships' },
    );
    expect(screen.getByRole('heading', { level: 1, name: /Finding Unlisted Internships/i })).toBeInTheDocument();
    // off-cycle terms content (Req 13.1)
    expect(screen.getByText(/off-cycle terms/i)).toBeInTheDocument();
    await waitFor(() => expect(document.title).toMatch(/Finding Unlisted Internships/));
  });

  it('shows a not-found state for an unknown guide', () => {
    renderWithProviders(
      <Routes>
        <Route path="/resources/:slug" element={<ResourceGuide />} />
      </Routes>,
      { adapter, route: '/resources/does-not-exist' },
    );
    expect(screen.getByText(/Guide not found/i)).toBeInTheDocument();
  });
});
