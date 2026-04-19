import { test, expect } from '@playwright/test';
import { ensureEnglishLocale, expectNoNextError } from './helpers';

test.describe('Nav visual checks', () => {
  test('mobile nav collapsed screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await ensureEnglishLocale(page);
    await page.goto('/');
    await expectNoNextError(page);
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await page.screenshot({ path: 'test-results/nav-collapsed-mobile.png', fullPage: false });
  });

  test('mobile nav expanded screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await ensureEnglishLocale(page);
    await page.goto('/');
    await expectNoNextError(page);

    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await nav.getByRole('button', { name: 'Expand menu' }).click();
    await expect(nav.getByRole('button', { name: 'Search photos' })).toBeVisible();
    await page.screenshot({ path: 'test-results/nav-expanded-mobile.png', fullPage: false });
  });

  test('desktop nav screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await ensureEnglishLocale(page);
    await page.goto('/');
    await expectNoNextError(page);
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await page.screenshot({ path: 'test-results/nav-desktop.png', fullPage: false });
  });
});
