import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { RouteMetadata } from './RouteMetadata';
import { About } from '../pages/About';

afterEach(() => { cleanup(); document.head.querySelectorAll('[data-rh]').forEach(el => el.remove()); });
function TestPage() {
  const navigate = useNavigate();
  return <><RouteMetadata /><About /><button onClick={() => navigate('/browse')}>Browse now</button></>;
}
describe('Mission page and route metadata', () => {
  it('shows the approved name and polo image and clears creator schema when leaving About', async () => {
    render(<HelmetProvider><MemoryRouter initialEntries={['/about']}><TestPage /></MemoryRouter></HelmetProvider>);
    expect(screen.getByRole('heading', { name: 'Maxim Culbeaux' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Maxim Culbeaux, creator of Launchpad' })).toHaveAttribute('src', '/maxim-culbeaux.jpg');
    await waitFor(() => expect(document.head.querySelector('script[type="application/ld+json"]')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Browse now' }));
    await waitFor(() => {
      expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://launchpad-careers.vercel.app/browse');
      expect(document.head.querySelector('script[type="application/ld+json"]')).toBeNull();
    });
  });
});
