import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdapterProvider } from '../hooks/useAdapter';
import type { DataAdapter } from '../lib/adapter';

export function renderWithProviders(
  ui: ReactElement,
  { adapter, route = '/' }: { adapter: DataAdapter; route?: string },
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <AdapterProvider adapter={adapter}>{children}</AdapterProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  );

  return render(ui, { wrapper: Wrapper });
}
