import { test, expect } from '@playwright/test';
import { ensureEnglishLocale, expectNoNextError } from './helpers';

const MOBILE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 800 };

async function openFirstPhoto(page: import('@playwright/test').Page) {
  await ensureEnglishLocale(page);
  await page.goto('/');
  await expectNoNextError(page);
  await page.locator('main a[href*="/p/"]').first().click();
  await expect(page).toHaveURL(/\/p\/\d+/);
}

test('mobile nav keeps secondary controls hidden until expanded', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await ensureEnglishLocale(page);
  await page.goto('/');
  await expectNoNextError(page);

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Search photos' })).toBeHidden();
  await expect(nav.getByRole('button', { name: 'Toggle theme' })).toBeHidden();

  await nav.locator('button[aria-expanded]').click();
  await expect(nav.getByRole('button', { name: 'Search photos' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Toggle theme' })).toBeVisible();
  await expect(nav.locator('button, a').filter({ hasText: 'KO' }).first()).toBeVisible();
});

test('desktop nav keeps search, theme, and locale controls visible', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await ensureEnglishLocale(page);
  await page.goto('/');
  await expectNoNextError(page);

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('button', { name: 'Search photos' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Toggle theme' })).toBeVisible();
  await expect(nav.locator('button, a').filter({ hasText: 'KO' }).first()).toBeVisible();
});

test('mobile photo info sheet opens from a real photo page', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await openFirstPhoto(page);

  const infoButton = page.getByRole('button', { name: 'Info' });
  await expect(infoButton).toBeVisible();
  await infoButton.click();

  const sheet = page.getByRole('dialog', { name: 'Photo Info' });
  await expect(sheet).toBeVisible();
});
