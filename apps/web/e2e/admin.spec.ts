import path from 'path';
import fs from 'fs/promises';
import { test, expect } from '@playwright/test';
import { adminE2EEnabled, expectNoNextError, loginAsAdmin } from './helpers';

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

  test('admin upload workflow works on the dashboard', async ({ page }) => {
    await loginAsAdmin(page);

    const uploadPath = path.resolve(process.cwd(), 'e2e/fixtures/e2e-landscape.jpg');
    const jpegBuffer = await fs.readFile(uploadPath);

    await page.locator('#upload-topic').selectOption('e2e-smoke');
    await page.locator('#admin-content input[type="file"]').setInputFiles({
      name: `playwright-upload-${Date.now()}.jpg`,
      mimeType: 'image/jpeg',
      buffer: jpegBuffer,
    });

    await page.getByRole('button', { name: /Upload 1 photos|1장 업로드/i }).click();
    await expect(page.getByText(/Uploaded 1 photos\.|1장을 업로드했습니다\./)).toBeVisible({ timeout: 30_000 });
  });
});
