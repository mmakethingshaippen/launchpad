import { test, expect } from '@playwright/test';

// Primary user journey: Home → Browse → Season filter → Role detail → Apply / Save.
test.describe('Launchpad primary journey', () => {
  test('home search transfers to Browse with results', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Find your Launchpad/i })).toBeVisible();

    await page.getByPlaceholder('Role, skill, or company').fill('engineer');
    await page.getByRole('button', { name: /Find Opportunities/i }).click();

    await expect(page).toHaveURL(/\/browse\?/);
    await expect(page.getByText(/matching active opportunities/i)).toBeVisible();
  });

  test('browse, filter by season, open a role, and reach apply', async ({ page, context }) => {
    await page.goto('/browse');
    await expect(page.getByText(/matching active opportunities/i)).toBeVisible();

    // Filter by Summer via the quick pill.
    await page.getByRole('button', { name: 'Summer', exact: true }).first().click();
    await expect(page).toHaveURL(/season=summer/);

    // Open the first role's detail page.
    await page.getByRole('link', { name: /Summer 2027/i }).first().click();
    await expect(page).toHaveURL(/\/roles\//);

    // Apply opens in a new tab with the external link.
    const applyLink = page.getByRole('link', { name: /Apply on Company Website/i });
    await expect(applyLink).toHaveAttribute('target', '_blank');
    await expect(applyLink).toHaveAttribute('rel', /noopener/);
  });

  test('save a role and see it in My Applications', async ({ page }) => {
    await page.goto('/browse');
    await expect(page.getByText(/matching active opportunities/i)).toBeVisible();

    // Save the first opportunity.
    await page.getByRole('button', { name: /Save opportunity/i }).first().click();

    await page.goto('/applications');
    await expect(page.getByRole('tab', { name: /Saved Opportunities \(1\)/i })).toBeVisible();
  });

  test('resources index lists the four guides', async ({ page }) => {
    await page.goto('/resources');
    await expect(page.getByText('Internship Resume Tips')).toBeVisible();
    await expect(page.getByText('Internship Interview Preparation')).toBeVisible();
    await expect(page.getByText('Finding Unlisted Internships')).toBeVisible();
    await expect(page.getByText('Evaluating an Internship Offer')).toBeVisible();
  });

  test('admin route is gated for anonymous users', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText(/Admin access required/i)).toBeVisible();
  });
});
