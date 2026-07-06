import { test, expect } from '@playwright/test';
import { ensureEnglishLocale, expectNoNextError } from './helpers';

// C2-01 (run-10 c2): focus-restore regression guards. Each modal overlay must
// return keyboard focus to the control that opened it when it closes, instead
// of dropping focus to <body>. Live-reproduced on production for the lightbox
// and the mobile info sheet; the search dialog case is a regression guard for
// the already-working search.tsx triggerRef pattern the fixes mirror.

test('lightbox returns focus to its trigger after Escape', async ({ page }) => {
  await ensureEnglishLocale(page);
  await page.goto('/');
  await expectNoNextError(page);

  await page.locator('main a[href*="/p/"]').first().click();
  await expect(page).toHaveURL(/\/p\/\d+/);

  const lightboxTrigger = page.getByRole('button', { name: 'Open fullscreen view' });
  await expect(lightboxTrigger).toBeVisible();
  await lightboxTrigger.click();

  const lightbox = page.getByRole('dialog', { name: 'Photo lightbox' });
  await expect(lightbox).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(lightbox).toBeHidden();

  // The whole toolbar is display:none while the lightbox is open, so a naive
  // activeElement-snapshot restore no-ops to <body>. The explicit trigger ref
  // must refocus the visible fullscreen button.
  await expect(lightboxTrigger).toBeFocused();
});

test('mobile info sheet returns focus to its opener after Close', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ensureEnglishLocale(page);
  await page.goto('/');
  await expectNoNextError(page);

  await page.locator('main a[href*="/p/"]').first().click();
  await expect(page).toHaveURL(/\/p\/\d+/);

  // On the mobile viewport only the `lg:hidden` Info button is in the
  // accessibility tree (the desktop pin toggle is display:none).
  const infoButton = page.getByRole('button', { name: 'Info', exact: true });
  await expect(infoButton).toBeVisible();
  await infoButton.click();

  const sheet = page.getByRole('dialog', { name: 'Photo Info' });
  await expect(sheet).toBeVisible();

  const closeButton = sheet.getByRole('button', { name: 'Close' });
  await expect(closeButton).toBeVisible();
  await closeButton.click();
  await expect(sheet).toBeHidden();

  // focus-trap-react's returnFocusOnDeactivate races the `return null` unmount;
  // the explicit opener ref must win and refocus the Info button.
  await expect(infoButton).toBeFocused();
});

test('search dialog still restores focus to its trigger on close', async ({ page }) => {
  await ensureEnglishLocale(page);
  await page.goto('/');
  await expectNoNextError(page);

  const searchTrigger = page.getByRole('button', { name: 'Search photos' });
  await searchTrigger.click();

  const dialog = page.getByRole('dialog', { name: 'Search photos' });
  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(searchTrigger).toBeFocused();
});
