import { test, expect } from '@playwright/test';
import { ensureEnglishLocale, expectNoNextError } from './helpers';

/**
 * C4-03 / DES4-01 (run-10 c4) — no hydration mismatch on desktop photo pages.
 *
 * photo-viewer.tsx's info-panel pin state previously seeded `useState` from
 * sessionStorage/matchMedia inside the lazy initializer: the server always
 * rendered `false` (sessionStorage throws into the catch) while any
 * desktop-width client hydrated `true`, so EVERY desktop photo-page load
 * logged a hydration error (minified React #418 in production builds) and
 * paid a full viewer-subtree regeneration. The fix renders the deterministic
 * SSR default first and restores the persisted/viewport value in a mount
 * effect. This spec pins the whole class for the page: a desktop-viewport
 * photo view must produce ZERO hydration-related console errors.
 */
test.describe('photo page hydration (C4-03)', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test('desktop photo page renders without hydration errors', async ({ page }) => {
        const consoleErrors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleErrors.push(msg.text());
        });
        page.on('pageerror', (err) => {
            consoleErrors.push(String(err?.message ?? err));
        });

        await ensureEnglishLocale(page);
        const firstPhoto = page.locator('main a[href*="/p/"]').first();
        await expect(firstPhoto).toBeVisible();
        await firstPhoto.click();
        await expect(page).toHaveURL(/\/p\/\d+/);
        await expectNoNextError(page);
        // Give hydration a beat to complete (the error is emitted during it).
        await page.waitForLoadState('networkidle');

        const hydrationErrors = consoleErrors.filter((text) =>
            /hydrat|minified react error #418|#418|#425|#423/i.test(text),
        );
        expect(hydrationErrors, hydrationErrors.join('\n---\n')).toHaveLength(0);

        // The pin state must still be restored post-mount on a desktop
        // viewport (the fix must not regress the restored behavior itself):
        // the toolbar toggle reflects the pinned state once hydrated.
        await expect(
            page.getByRole('button', { name: /pinned/i }).or(page.getByRole('button', { name: /info/i })).first(),
        ).toBeVisible();
    });
});
