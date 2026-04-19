import { expect, Page } from '@playwright/test';

const DEFAULT_BASE_URL = process.env.E2E_BASE_URL || 'https://gallery.atik.kr';
export const adminE2EEnabled = process.env.E2E_ADMIN_ENABLED === 'true';

function getOriginForCookies(page: Page) {
  const currentUrl = page.url();
  const baseUrl = currentUrl && currentUrl !== 'about:blank' ? currentUrl : DEFAULT_BASE_URL;
  return new URL(baseUrl).origin;
}

export async function ensureEnglishLocale(page: Page) {
  await page.context().addCookies([{
    name: 'NEXT_LOCALE',
    value: 'en',
    url: getOriginForCookies(page),
  }]);
}

export async function loginAsAdmin(page: Page) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error('ADMIN_PASSWORD must be set for Playwright admin E2E tests');
  }

  await ensureEnglishLocale(page);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByPlaceholder('Username')).toBeVisible();
  await page.getByPlaceholder('Username').fill('admin');
  await page.getByPlaceholder('Password').fill(adminPassword);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
  await expect(page.locator('#admin-content')).toBeVisible();
}

export async function expectNoNextError(page: Page) {
  await expect(page.locator('#__next_error__')).toHaveCount(0);
}
