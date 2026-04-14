import { expect, Page } from '@playwright/test';

export async function ensureEnglishLocale(page: Page) {
  await page.context().addCookies([{
    name: 'NEXT_LOCALE',
    value: 'en',
    domain: '127.0.0.1',
    path: '/',
  }]);
}

export async function loginAsAdmin(page: Page) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error('ADMIN_PASSWORD must be set for Playwright E2E tests');
  }

  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByPlaceholder('Username')).toBeVisible();
  await page.getByPlaceholder('Username').fill('admin');
  await page.getByPlaceholder('Password').fill(adminPassword);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
  await expect(page.locator('#admin-content select')).toBeVisible();
}

export async function expectNoNextError(page: Page) {
  await expect(page.locator('#__next_error__')).toHaveCount(0);
}
