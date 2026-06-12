import path from 'path';
import fs from 'fs/promises';
import { test, expect } from '@playwright/test';
import { adminE2EEnabled, ensureEnglishLocale, expectNoNextError, loginAsAdmin, waitForImageProcessed } from './helpers';

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

  test('wrong-password login attempt shows localized error and stays on login page (AGG-R5C2-52)', async ({ page }) => {
    // Gated inside adminE2EEnabled so this test only runs when admin E2E
    // credentials are available — the same guard used by all other admin
    // specs. This also keeps the test off remote hosts unless
    // E2E_ALLOW_REMOTE_ADMIN=true, which protects the per-IP login
    // rate limit (5 attempts / 15 min). One wrong attempt is consumed here;
    // subsequent tests perform a correct login so the budget is not exhausted.
    await ensureEnglishLocale(page);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByPlaceholder('Username')).toBeVisible();

    await page.getByPlaceholder('Username').fill('nonexistent-user-xyz');
    await page.getByPlaceholder('Password').fill('totally-wrong-password-xyz');
    await page.getByRole('button', { name: /sign in/i }).click();

    // The login form renders the server-action error in a <p role="alert">.
    // "Invalid credentials" is the serverActions.invalidCredentials key from
    // en.json — returned for any username/password mismatch.
    const errorAlert = page.getByRole('alert');
    await expect(errorAlert).toBeVisible({ timeout: 10_000 });
    await expect(errorAlert).toContainText('Invalid credentials');

    // The URL must stay on the login page (not redirected to dashboard).
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('admin settings GPS toggle reflects lock state in the hydrated UI (C1R-07)', async ({ page }) => {
    await loginAsAdmin(page);

    await page.locator('a[href$="/admin/settings"]').first().click();
    await expect(page).toHaveURL(/\/admin\/settings/);

    const gpsToggle = page.locator('#strip-gps');
    await expect(gpsToggle).toBeVisible();

    const initialState = await gpsToggle.getAttribute('data-state');
    if (await gpsToggle.isDisabled()) {
      await expect(page.locator('#strip-gps-help')).toContainText(/locked|잠깁니다|잠겨/i);
      expect(initialState).toMatch(/checked|unchecked/);
      return;
    }

    // Flip the toggle; the switch updates its data-state synchronously after click.
    await gpsToggle.click();
    const flippedState = await gpsToggle.getAttribute('data-state');
    expect(flippedState).not.toBe(initialState);

    // Flip it back so we don't leave the seeded environment mutated.
    await gpsToggle.click();
    const restoredState = await gpsToggle.getAttribute('data-state');
    expect(restoredState).toBe(initialState);
  });

  test('admin can create and delete a topic (TEST-R4C19-07)', async ({ page }) => {
    // Regression lane for COR-R4C19-01: topicRouteSegmentExists read the
    // drizzle/mysql2 [rows, fields] tuple as a rows array, so EVERY
    // createTopic returned slugConflictsWithRoute for six weeks while all
    // gates stayed green — no e2e exercised topic creation. This spec walks
    // the real UI path: create → visible in the categories table → delete.
    await loginAsAdmin(page);

    await page.locator('a[href$="/admin/categories"]').first().click();
    await expect(page).toHaveURL(/\/admin\/categories/);

    const slug = `e2e-topic-${Date.now()}`;
    const topicRow = page.getByRole('row').filter({ hasText: slug }).first();

    await page.getByRole('button', { name: 'Add' }).click();
    const createDialog = page.getByRole('dialog');
    await expect(createDialog).toBeVisible();
    await createDialog.locator('#create-topic-label').fill('E2E Topic Lock');
    await createDialog.locator('#create-topic-slug').fill(slug);
    await createDialog.getByRole('button', { name: 'Create' }).click();

    try {
      await expect(topicRow).toBeVisible({ timeout: 15_000 });
    } finally {
      if (await topicRow.isVisible().catch(() => false)) {
        await topicRow.getByRole('button', { name: 'Delete' }).click();
        await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
        await expect(topicRow).toBeHidden({ timeout: 15_000 });
      }
    }
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

    const uploadedRow = page.getByRole('row').filter({ hasText: uploadName }).first();
    try {
      await page.getByRole('button', { name: /Upload 1 photos|1장 업로드/i }).click();
      await expect(page.getByText(/Uploaded 1 photos\.|1장을 업로드했습니다\./)).toBeVisible({ timeout: 30_000 });

      await expect(uploadedRow).toBeVisible({ timeout: 30_000 });
      await waitForImageProcessed(uploadName);
    } finally {
      if (await uploadedRow.isVisible().catch(() => false)) {
        await uploadedRow.getByRole('button', { name: /delete/i }).click();
        await page.getByRole('button', { name: /^Delete$|^삭제$/i }).click();
        await expect(uploadedRow).toBeHidden({ timeout: 30_000 });
      }
    }
  });
});
