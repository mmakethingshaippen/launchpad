import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Submit } from './Submit';
import type { DataAdapter } from '../lib/adapter';
import { renderWithProviders } from '../test/renderWithProviders';

function makeAdapter() {
  const submitCompany = vi.fn(async () => {});
  const submitRole = vi.fn(async () => {});
  const adapter = { submitCompany, submitRole } as unknown as DataAdapter;
  return { adapter, submitCompany, submitRole };
}

describe('Submit page — company form', () => {
  it('shows validation errors for an empty submission', async () => {
    const { adapter, submitCompany } = makeAdapter();
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<Submit />, { adapter, route: '/submit' });

    await user.click(screen.getByRole('button', { name: /Submit company for review/i }));
    expect(await screen.findByText(/Company name is required/i)).toBeInTheDocument();
    expect(submitCompany).not.toHaveBeenCalled();
  });

  it('submits a valid company and shows success', async () => {
    const { adapter, submitCompany } = makeAdapter();
    const user = userEvent.setup({ delay: null });
    const { container } = renderWithProviders(<Submit />, { adapter, route: '/submit' });

    await user.type(screen.getByRole('textbox', { name: /Company name/i }), 'Acme');
    await user.type(screen.getByRole('textbox', { name: /Website URL/i }), 'https://acme.test');
    await user.type(screen.getByRole('textbox', { name: /Careers URL/i }), 'https://acme.test/careers');
    await user.type(screen.getByRole('textbox', { name: /Description/i }), 'A detailed company description.');
    await user.click(screen.getByLabelText('Technology'));
    await user.click(screen.getByLabelText('Undergraduate'));

    await user.click(screen.getByRole('button', { name: /Submit company for review/i }));

    await waitFor(() => expect(submitCompany).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/your company was submitted/i)).toBeInTheDocument();
    expect(container).toBeTruthy();
  }, 20_000);

  it('silently drops a submission when the honeypot is filled', async () => {
    const { adapter, submitCompany } = makeAdapter();
    const user = userEvent.setup({ delay: null });
    const { container } = renderWithProviders(<Submit />, { adapter, route: '/submit' });

    // Fill required fields plus the hidden honeypot.
    await user.type(screen.getByRole('textbox', { name: /Company name/i }), 'Acme');
    await user.type(screen.getByRole('textbox', { name: /Website URL/i }), 'https://acme.test');
    await user.type(screen.getByRole('textbox', { name: /Careers URL/i }), 'https://acme.test/careers');
    await user.type(screen.getByRole('textbox', { name: /Description/i }), 'A detailed company description.');
    await user.click(screen.getByLabelText('Technology'));
    await user.click(screen.getByLabelText('Undergraduate'));

    const honeypot = container.querySelector('input[name="website_hp"]') as HTMLInputElement;
    await user.type(honeypot, 'spam');

    await user.click(screen.getByRole('button', { name: /Submit company for review/i }));

    // Honeypot → success UI shown but adapter never called (Req 14.5).
    expect(await screen.findByText(/your company was submitted/i)).toBeInTheDocument();
    expect(submitCompany).not.toHaveBeenCalled();
  }, 20_000);
});
