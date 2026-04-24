import { test, expect } from '@playwright/test';
import { ensureEnglishLocale, expectNoNextError } from './helpers';

test('homepage exposes photos and locale switching works', async ({ page }) => {
  await ensureEnglishLocale(page);
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expectNoNextError(page);

  const firstPhoto = page.locator('main a[href*="/p/"]').first();
  await expect(firstPhoto).toBeVisible();

  await page.locator('nav').locator('button, a').filter({ hasText: 'KO' }).first().click();
  await expect(page).toHaveURL(/\/ko(\/|$|\?)/);
  await expect(page.locator('main a[href*="/p/"]').first()).toBeVisible();

  await page.locator('nav').locator('button, a').filter({ hasText: 'EN' }).first().click();
  await expect(page).not.toHaveURL(/\/ko(\/|$|\?)/);
});

test('search dialog autofocuses, traps focus, and restores focus on close', async ({ page }) => {
  await ensureEnglishLocale(page);
  await page.goto('/');
  await expectNoNextError(page);

  const searchTrigger = page.getByRole('button', { name: 'Search photos' });
  await searchTrigger.click();

  const dialog = page.getByRole('dialog', { name: 'Search photos' });
  await expect(dialog).toBeVisible();
  const searchInput = dialog.locator('#search-input');
  await expect(searchInput).toBeFocused();

  await page.keyboard.press('Tab');
  await expect.poll(async () => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(searchTrigger).toBeFocused();
});

test('search matches canonical topic labels and aliases', async ({ page }) => {
  await ensureEnglishLocale(page);
  await page.goto('/');
  await expectNoNextError(page);

  const searchTrigger = page.getByRole('button', { name: 'Search photos' });
  await searchTrigger.click();

  const dialog = page.getByRole('dialog', { name: 'Search photos' });
  const searchInput = dialog.locator('#search-input');

  await searchInput.fill('E2E Smoke');
  await expect(dialog.getByText('E2E Landscape')).toBeVisible();
  await expect(dialog.getByText('E2E Smoke').first()).toBeVisible();

  await searchInput.fill('spotlight-smoke');
  await expect(dialog.getByText('E2E Landscape')).toBeVisible();
});

test('photo page lightbox opens and closes from the first visible photo', async ({ page }) => {
  await ensureEnglishLocale(page);
  await page.goto('/');
  await expectNoNextError(page);

  await page.locator('main a[href*="/p/"]').first().click();
  await expect(page).toHaveURL(/\/p\/\d+/);

  // C3R-RPL-07: assert the photo detail page emits exactly one accessible
  // `<h1>` so heading-based screen-reader navigation keeps working.
  // Regression guard for AGG3R-01 (shadcn `CardTitle` is a `<div>`; previously
  // the photo page rendered zero headings on mobile).
  await expect(page.locator('h1')).toHaveCount(1);

  const lightboxButton = page.getByRole('button', { name: 'Open fullscreen view' });
  await expect(lightboxButton).toBeVisible();
  await lightboxButton.click();

  const lightbox = page.getByRole('dialog', { name: 'Photo lightbox' });
  await expect(lightbox).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(lightbox).toBeHidden();
});

test('home gallery keeps a full H1 -> H2 -> H3 heading hierarchy', async ({ page }) => {
  // C3R-RPL-04 regression guard: prior to the sr-only H2, home skipped
  // from H1 -> H3 which is a WCAG 1.3.1 / 2.4.6 violation. Assert all
  // three levels are present when photos exist.
  await ensureEnglishLocale(page);
  await page.goto('/');
  await expectNoNextError(page);

  await expect(page.locator('h1')).toHaveCount(1);
  // sr-only intermediate section heading for "Photos".
  await expect(page.locator('h2')).toHaveCount(1);
  // At least one photo card H3 should be present when the seed lane is on.
  const h3Count = await page.locator('h3').count();
  expect(h3Count).toBeGreaterThan(0);
});

test('shared-group navigation keeps the shared route context', async ({ page }) => {
  await ensureEnglishLocale(page);
  await page.goto('/g/Abc234Def5');
  await expectNoNextError(page);

  const firstSharedPhoto = page.locator('a[href*="/g/Abc234Def5?photoId="]').first();
  await expect(firstSharedPhoto).toBeVisible();
  await firstSharedPhoto.click();

  await expect(page).toHaveURL(/\/g\/Abc234Def5\?photoId=\d+/);
  const startingUrl = page.url();

  const nextButton = page.getByRole('button', { name: 'Next photo' });
  await expect(nextButton).toBeVisible();
  await nextButton.click();

  await expect(page).toHaveURL(/\/g\/Abc234Def5\?photoId=\d+/);
  await expect(page).not.toHaveURL(startingUrl);
});
