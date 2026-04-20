import { expect, Page } from '@playwright/test';

const requestedBaseUrl = process.env.E2E_BASE_URL?.trim() || `http://127.0.0.1:${process.env.E2E_PORT || '3100'}`;
const parsedBaseUrl = new URL(requestedBaseUrl);
const DEFAULT_BASE_URL = (() => {
  if (!['127.0.0.1', 'localhost'].includes(parsedBaseUrl.hostname) || parsedBaseUrl.port) {
    return requestedBaseUrl.replace(/\/$/, '');
  }

  const url = new URL(requestedBaseUrl);
  url.port = process.env.E2E_PORT || '3100';
  return url.toString().replace(/\/$/, '');
})();
export const adminE2EEnabled = process.env.E2E_ADMIN_ENABLED === 'true';
const ARGON2_HASH_PREFIX = /^\$argon2/i;

function getOriginForCookies(page: Page) {
  const currentUrl = page.url();
  const baseUrl = currentUrl && currentUrl !== 'about:blank' ? currentUrl : DEFAULT_BASE_URL;
  return new URL(baseUrl).origin;
}

function isLocalOrigin(origin: string) {
  const hostname = new URL(origin).hostname;
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

function resolveAdminE2EPassword(origin: string) {
  const explicitE2EPassword = process.env.E2E_ADMIN_PASSWORD?.trim();
  const adminPassword = process.env.ADMIN_PASSWORD?.trim();

  if (!isLocalOrigin(origin)) {
    if (process.env.E2E_ALLOW_REMOTE_ADMIN !== 'true') {
      throw new Error('Remote admin E2E is disabled by default. Set E2E_ALLOW_REMOTE_ADMIN=true to opt in.');
    }
    if (!explicitE2EPassword) {
      throw new Error('Remote admin E2E requires a plaintext E2E_ADMIN_PASSWORD.');
    }
    return explicitE2EPassword;
  }

  if (explicitE2EPassword) {
    return explicitE2EPassword;
  }

  if (!adminPassword) {
    throw new Error('E2E_ADMIN_PASSWORD or ADMIN_PASSWORD must be set for Playwright admin E2E tests');
  }

  if (ARGON2_HASH_PREFIX.test(adminPassword)) {
    throw new Error('ADMIN_PASSWORD is an Argon2 hash. Set a plaintext E2E_ADMIN_PASSWORD for Playwright admin flows.');
  }

  return adminPassword;
}

export async function ensureEnglishLocale(page: Page) {
  await page.context().addCookies([{
    name: 'NEXT_LOCALE',
    value: 'en',
    url: getOriginForCookies(page),
  }]);
}

export async function loginAsAdmin(page: Page) {
  const origin = getOriginForCookies(page);
  const adminPassword = resolveAdminE2EPassword(origin);

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
