import { test, expect } from '@playwright/test';
import { ensureEnglishLocale, expectNoNextError } from './helpers';

test('keyboard-expanded mobile nav focuses revealed links and Escape restores the toggle', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await ensureEnglishLocale(page);
  await page.goto('/');
  await expectNoNextError(page);

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const toggle = nav.getByRole('button', { name: 'Expand menu' });
  const topicLinks = nav.locator('#primary-nav-topics a');
  await toggle.focus();
  await page.keyboard.press('Enter');

  await expect(nav.getByRole('button', { name: 'Collapse menu' })).toBeVisible();
  await expect(topicLinks.first()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(topicLinks.nth(1)).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(nav.getByRole('button', { name: 'Expand menu' })).toBeFocused();
  await expect(topicLinks.first()).toBeHidden();
});
