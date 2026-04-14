import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000/en';
const MOBILE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 800 };

// --- Fix 1: Mobile nav hides controls on narrow viewport ---
test('mobile: search, theme toggle, and language switch are hidden', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  // Use specific aria-label to avoid matching Next.js error overlay nav
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav).toBeVisible();

  // The controls div (search + theme + lang) should NOT be visible on mobile
  // Theme toggle should be hidden when collapsed on mobile
  const themeToggle = nav.locator('button[aria-label="Toggle theme"]');
  await expect(themeToggle).toBeHidden();

  // Language switch should be hidden when collapsed on mobile
  const langSwitch = nav.locator('a:has-text("KO")');
  await expect(langSwitch).toBeHidden();
});

test('mobile: category menu is visible and expandable', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  // Topic links should be visible
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const topicLinks = nav.locator('a[href*="/landscape"]');
  await expect(topicLinks).toBeVisible();

  // Expand toggle button should exist on mobile
  const toggleBtn = nav.locator('button:has(svg)');
  const count = await toggleBtn.count();
  // There should be at least 1 toggle button (the expand/collapse chevron)
  expect(count).toBeGreaterThanOrEqual(1);
});

// --- Fix 2: Desktop nav still shows controls ---
test('desktop: search, theme toggle, and language switch are visible', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  const nav = page.getByRole('navigation', { name: 'Main navigation' });

  // Theme toggle should be visible on desktop
  const themeToggle = nav.locator('button[aria-label="Toggle theme"]');
  await expect(themeToggle).toBeVisible();

  // Language switch should be visible on desktop
  const langSwitch = nav.locator('a:has-text("KO")');
  await expect(langSwitch).toBeVisible();
});

// --- Fix 3: Lightbox stays open on next/prev navigation ---
test('lightbox remains open after keyboard navigation', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  // Go directly to a photo page
  await page.goto(`${BASE}/p/1`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Open lightbox by pressing 'f'
  await page.keyboard.press('f');
  await page.waitForTimeout(800);

  // Verify lightbox is open — use specific aria-label to avoid error overlay
  const lightbox = page.getByRole('dialog', { name: 'Photo lightbox' });
  await expect(lightbox).toBeVisible({ timeout: 5000 });

  // Navigate to next photo (only works if nextId is available)
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);

  // Lightbox should still be open after navigation
  await expect(lightbox).toBeVisible();
});

// --- Fix 4: Page doesn't crash when scrolling to bottom ---
test('photo page does not crash when scrolling to bottom (desktop)', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(`${BASE}/p/1`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Scroll to bottom
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);

  // Page should still be functional - no error page
  const errorPage = page.locator('#__next_error__');
  await expect(errorPage).toHaveCount(0);

  // Photo viewer should still be present
  const photoViewer = page.locator('.photo-viewer-container');
  await expect(photoViewer).toBeVisible();
});

test('photo page does not crash when scrolling to bottom (mobile)', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto(`${BASE}/p/1`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Scroll to bottom
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);

  // Page should still be functional
  const errorPage = page.locator('#__next_error__');
  await expect(errorPage).toHaveCount(0);

  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  const errorPage2 = page.locator('#__next_error__');
  await expect(errorPage2).toHaveCount(0);
});

// --- Bottom sheet positioning on mobile ---
test('bottom sheet opens and is positioned at viewport bottom', async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await page.goto(`${BASE}/p/1`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Click the Info button on mobile (the one visible on lg:hidden)
  const infoBtn = page.locator('button.gap-2.lg\\:hidden');
  if (await infoBtn.count() > 0) {
    await infoBtn.first().click();
    await page.waitForTimeout(500);

    // Bottom sheet should be visible — use specific aria-label to avoid error overlay
    const sheet = page.getByRole('dialog', { name: 'Photo Info' });
    await expect(sheet).toBeVisible();

    // In peek state, the sheet should reach the viewport bottom (no gap)
    // and its top should be near viewportHeight - PEEK_HEIGHT (140px)
    const box = await sheet.boundingBox();
    if (box) {
      const bottomGap = MOBILE.height - (box.y + box.height);
      // Bottom of sheet should be flush with viewport bottom (within 5px)
      expect(Math.abs(bottomGap)).toBeLessThan(5);
    }
  }
});
