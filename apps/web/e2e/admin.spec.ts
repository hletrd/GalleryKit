import path from 'path';
import fs from 'fs/promises';
import { test, expect } from '@playwright/test';
import { adminE2EEnabled, expectNoNextError, loginAsAdmin, waitForImageProcessed } from './helpers';

test('admin E2E credentials are configured when CI expects admin coverage', () => {
  test.skip(process.env.CI !== 'true', 'Local runs may omit admin E2E credentials.');
  expect(adminE2EEnabled).toBe(true);
});

test.describe('admin workflows (opt-in)', () => {
  test.skip(!adminE2EEnabled, 'Set E2E_ADMIN_ENABLED=true to run admin E2E against a seeded environment.');

  test('protected admin routes redirect to login when unauthenticated', async ({ page }) => {
    await page.goto('/admin/dashboard');
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByPlaceholder('Username')).toBeVisible();
  });

  test('admin login and navigation workflows work', async ({ page }) => {
    await loginAsAdmin(page);
    await expectNoNextError(page);

    await page.locator('a[href$="/admin/categories"]').first().click();
    await expect(page).toHaveURL(/\/admin\/categories/);
    await expect(page.locator('#admin-content table')).toBeVisible();

    await page.locator('a[href$="/admin/tags"]').first().click();
    await expect(page).toHaveURL(/\/admin\/tags/);
    await expect(page.locator('#admin-content table')).toBeVisible();

    await page.locator('a[href$="/admin/users"]').first().click();
    await expect(page).toHaveURL(/\/admin\/users/);
    await expect(page.locator('#admin-content table')).toBeVisible();

    await page.locator('a[href$="/admin/password"]').first().click();
    await expect(page).toHaveURL(/\/admin\/password/);
    await expect(page.locator('input[name="currentPassword"]')).toBeVisible();

    await page.locator('a[href$="/admin/db"]').first().click();
    await expect(page).toHaveURL(/\/admin\/db/);
    await expect(page.locator('input[type="file"]')).toBeVisible();
  });

  test('admin settings GPS toggle reflects in the hydrated UI (C1R-07)', async ({ page }) => {
    await loginAsAdmin(page);

    await page.locator('a[href$="/admin/settings"]').first().click();
    await expect(page).toHaveURL(/\/admin\/settings/);

    const gpsToggle = page.locator('#strip-gps');
    await expect(gpsToggle).toBeVisible();

    const initialState = await gpsToggle.getAttribute('data-state');
    // Flip the toggle; the switch updates its data-state synchronously after click.
    await gpsToggle.click();
    const flippedState = await gpsToggle.getAttribute('data-state');
    expect(flippedState).not.toBe(initialState);

    // Flip it back so we don't leave the seeded environment mutated.
    await gpsToggle.click();
    const restoredState = await gpsToggle.getAttribute('data-state');
    expect(restoredState).toBe(initialState);
  });

  test('admin upload workflow works on the dashboard', async ({ page }) => {
    await loginAsAdmin(page);

    const uploadPath = path.resolve(process.cwd(), 'e2e/fixtures/e2e-landscape.jpg');
    const jpegBuffer = await fs.readFile(uploadPath);

    await page.locator('#upload-topic').selectOption('e2e-smoke');
    const uploadName = `playwright-upload-${Date.now()}.jpg`;
    await page.locator('#admin-content input[type="file"]').setInputFiles({
      name: uploadName,
      mimeType: 'image/jpeg',
      buffer: jpegBuffer,
    });

    await page.getByRole('button', { name: /Upload 1 photos|1장 업로드/i }).click();
    await expect(page.getByText(/Uploaded 1 photos\.|1장을 업로드했습니다\./)).toBeVisible({ timeout: 30_000 });

    const uploadedRow = page.getByRole('row').filter({ hasText: uploadName }).first();
    await expect(uploadedRow).toBeVisible({ timeout: 30_000 });
    await waitForImageProcessed(uploadName);
    await uploadedRow.getByRole('button', { name: /delete/i }).click();
    await page.getByRole('button', { name: /^Delete$|^삭제$/i }).click();
    await expect(uploadedRow).toBeHidden({ timeout: 30_000 });
  });
});
