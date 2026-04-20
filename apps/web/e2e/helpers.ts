import { expect, Page } from '@playwright/test';

const DEFAULT_BASE_URL = process.env.E2E_BASE_URL || `http://127.0.0.1:${process.env.E2E_PORT || '3100'}`;
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
  const adminPassword = process.env.E2E_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error('E2E_ADMIN_PASSWORD or ADMIN_PASSWORD must be set for Playwright admin E2E tests');
  }
  if (adminPassword.startsWith('$argon2')) {
    throw new Error('E2E admin login requires a plaintext E2E_ADMIN_PASSWORD; ADMIN_PASSWORD is currently an Argon2 hash.');
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
