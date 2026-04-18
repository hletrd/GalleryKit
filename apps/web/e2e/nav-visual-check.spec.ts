import { test } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000/en';

test.describe('Nav visual checks', () => {
  test('mobile nav collapsed screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'test-results/nav-collapsed-mobile.png', fullPage: false });
  });

  test('mobile nav expanded screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Click expand toggle
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const toggle = nav.locator('button[aria-expanded]');
    await toggle.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/nav-expanded-mobile.png', fullPage: false });
  });

  test('desktop nav screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'test-results/nav-desktop.png', fullPage: false });
  });
});
