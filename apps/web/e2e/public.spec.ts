import { test, expect } from '@playwright/test';
import { ensureEnglishLocale, expectNoNextError } from './helpers';

test('homepage, topic navigation, and locale switching work', async ({ page }) => {
  await ensureEnglishLocale(page);
  await page.goto('/');
  await expect(page.locator('main').getByText('Latest')).toBeVisible();
  await expectNoNextError(page);

  const photoLinks = page.locator('main a[aria-label^="View photo:"]');
  await expect(photoLinks.first()).toBeVisible();
  expect(await photoLinks.count()).toBeGreaterThanOrEqual(2);

  await page.getByRole('link', { name: 'E2E Smoke' }).click();
  await expect(page).toHaveURL(/e2e-smoke/);
  await expectNoNextError(page);

  await page.getByRole('link', { name: 'KO' }).click();
  await expect(page).toHaveURL(/\/ko\/e2e-smoke/);
  await expectNoNextError(page);

  await page.getByRole('link', { name: 'EN' }).click();
  await expect(page).toHaveURL(/\/e2e-smoke$/);
});

test('search and photo navigation work', async ({ page }) => {
  await ensureEnglishLocale(page);
  await page.goto('/');
  await expect(page.locator('main').getByText('Latest')).toBeVisible();
  await expectNoNextError(page);

  await page.locator('nav button').first().click();
  await expect(page.locator('div[role="dialog"]')).toBeVisible();
  await page.locator('div[role="dialog"] input').first().fill('E2E Portrait');
  await page.getByRole('link', { name: /E2E Portrait/ }).click();

  await expect(page).toHaveURL(/\/p\/\d+/);
  await expect(page.getByText('E2E Portrait')).toBeVisible();

  const beforeUrl = page.url();
  await page.locator('button:has(svg.lucide-chevron-right)').first().click();
  await expect(page).not.toHaveURL(beforeUrl);
});
