import { test, expect, type Locator } from '@playwright/test';
import { ensureEnglishLocale, expectNoNextError } from './helpers';

const themeButtonName = /^Theme: .* Switch to .*[.]$/;

async function expectVisibleNavTargetsAreStable(nav: Locator) {
  const metrics = await nav.locator('a,button').evaluateAll((elements) => elements
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        text: element.textContent?.trim() ?? element.getAttribute('aria-label') ?? element.tagName,
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
      };
    })
    .filter((metric) => metric.visible));

  expect(metrics.length).toBeGreaterThan(0);
  for (const metric of metrics) {
    expect(metric.width, `${metric.text} width`).toBeGreaterThanOrEqual(44);
    expect(metric.height, `${metric.text} height`).toBeGreaterThanOrEqual(44);
  }

  for (let i = 0; i < metrics.length; i++) {
    for (let j = i + 1; j < metrics.length; j++) {
      const a = metrics[i];
      const b = metrics[j];
      const overlaps = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      expect(overlaps, `${a.text} overlaps ${b.text}`).toBe(false);
    }
  }
}

test.describe('Nav visual checks', () => {
  test('mobile nav collapsed screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await ensureEnglishLocale(page);
    await page.goto('/');
    await expectNoNextError(page);
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Expand menu' })).toBeVisible();
    // C1-37 (run-10 cycle-1): the Search control is DELIBERATELY visible in
    // the collapsed mobile bar (nav-client.tsx: "Controls: visible in the
    // collapsed mobile bar; topic chips move into the expanded mobile
    // panel."). This spec previously pinned the pre-redesign layout (search
    // hidden until expand) and failed on every run since the nav change
    // shipped — the recovery run never executed the e2e gate, so the stale
    // expectation was never surfaced.
    await expect(nav.getByRole('button', { name: 'Search photos' })).toBeVisible();
    await expectVisibleNavTargetsAreStable(nav);
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
    await expect(nav.locator('a[href*="/e2e-smoke"]').first()).toBeVisible();
    await expectVisibleNavTargetsAreStable(nav);
    await page.screenshot({ path: 'test-results/nav-expanded-mobile.png', fullPage: false });
  });

  test('desktop nav screenshot', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await ensureEnglishLocale(page);
    await page.goto('/');
    await expectNoNextError(page);
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Search photos' })).toBeVisible();
    await expect(nav.getByRole('button', { name: themeButtonName })).toBeVisible();
    await expectVisibleNavTargetsAreStable(nav);
    await page.screenshot({ path: 'test-results/nav-desktop.png', fullPage: false });
  });
});
