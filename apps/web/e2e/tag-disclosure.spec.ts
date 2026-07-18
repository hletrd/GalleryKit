import { test, expect } from '@playwright/test';
import { ensureEnglishLocale, expectNoNextError } from './helpers';

test('closed mobile tag disclosure has no rendered panel or overlapping hit target', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await ensureEnglishLocale(page);
  await page.goto('/');
  await expectNoNextError(page);

  const details = page.locator('details').filter({ has: page.getByText('Filter by tag', { exact: true }) });
  const summary = details.locator('summary');
  const tagGroup = details.locator('[role="group"]');
  const firstPhoto = page.locator('.masonry-card').first();

  await expect(details).not.toHaveAttribute('open', '');
  await expect(tagGroup).toBeHidden();
  expect(await tagGroup.boundingBox()).toBeNull();

  await summary.click();
  await expect(details).toHaveAttribute('open', '');
  await expect(tagGroup).toBeVisible();
  const openGroupBox = await tagGroup.boundingBox();
  const openPhotoBox = await firstPhoto.boundingBox();
  expect(openGroupBox).not.toBeNull();
  expect(openPhotoBox).not.toBeNull();
  expect(openGroupBox!.y + openGroupBox!.height).toBeLessThanOrEqual(openPhotoBox!.y);

  await summary.click();
  await expect(tagGroup).toBeHidden();
  expect(await tagGroup.boundingBox()).toBeNull();
});
