import { test, expect, type Page } from '@playwright/test';
import { ensureEnglishLocale, expectNoNextError } from './helpers';

/**
 * DBG3-01 / C3-13 (run-10 c3) — imperative swipe visuals must reset after a
 * SUCCESSFUL swipe on the in-place photo-switch path.
 *
 * The C2-18 ref-based refactor writes edge-indicator opacity/transform
 * straight to the DOM during a drag. The indicator JSX carries static style
 * literals, so React's props diff never clears those writes — on the
 * shared-group view (onSelectId=setCurrentImageId, no navigation/remount)
 * the swiped-from glow persisted over the newly displayed photo. The fix
 * resets visuals in the touchend success branches AND re-asserts resting
 * styles via a layout effect keyed on prevId/nextId.
 *
 * TEST3-02 (run-10 c3): this is also the first behavioral coverage for the
 * imperative gesture layer itself (threshold navigation, sub-threshold
 * snap-back), which shipped test-less in ffc4a06e.
 */

type SwipeOpts = { fromX: number; toX: number; y: number };

// Dispatch a synthetic horizontal touch drag on the media container.
// Playwright's touchscreen API needs hasTouch contexts; constructing
// TouchEvents in-page works on any Chromium context and exercises the
// exact listeners photo-navigation.tsx registers.
async function dispatchSwipe(page: Page, { fromX, toX, y }: SwipeOpts) {
    await page.getByTestId('photo-media-container').first().evaluate(
        (el, { fromX, toX, y }) => {
            const touch = (x: number) =>
                new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
            const fire = (type: string, x: number) =>
                el.dispatchEvent(
                    new TouchEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        changedTouches: [touch(x)],
                        touches: type === 'touchend' ? [] : [touch(x)],
                    }),
                );
            fire('touchstart', fromX);
            // Two moves so the horizontal-dominance branch engages before the
            // final offset is applied.
            fire('touchmove', fromX + (toX - fromX) / 2);
            fire('touchmove', toX);
            fire('touchend', toX);
        },
        { fromX, toX, y },
    );
}

// ONE page session covers both scenarios: the /s|/g share routes carry a
// per-IP probe limiter (SHARE_MAX_REQUESTS = 60/min; a rate-limited lookup
// renders the not-found page by design), and parallel e2e workers plus the
// shared grid's viewport-entry RSC prefetches all draw from the same
// 127.0.0.1 budget — a second page.goto of the share URL in a sibling test
// flaked into that limiter during the full suite run. Sub-threshold is
// asserted first (same photo), then the threshold swipe (in-place switch).
test('shared-group swipe: sub-threshold snaps back; threshold navigates in place; visuals reset both times', async ({ page }) => {
    await ensureEnglishLocale(page);
    await page.goto('/g/Abc234Def5');
    await expectNoNextError(page);

    const firstSharedPhoto = page.locator('a[href*="/g/Abc234Def5?photoId="]').first();
    await expect(firstSharedPhoto).toBeVisible();
    await firstSharedPhoto.click();
    await expect(page).toHaveURL(/\/g\/Abc234Def5\?photoId=\d+/);
    const startingUrl = page.url();

    // Phase 1: 40px < the 80px threshold → snap back, same photo.
    await dispatchSwipe(page, { fromX: 300, toX: 260, y: 300 });
    await expect(page).toHaveURL(startingUrl);
    const next = page.getByTestId('swipe-next-indicator');
    if ((await next.count()) > 0) {
        await expect(next.first()).toHaveCSS('opacity', '0');
    }

    // Phase 2: swipe left well past the threshold → next photo, IN PLACE
    // (shared view wires onSelectId=setCurrentImageId — no remount, which is
    // exactly the DBG3-01 stale-visuals path).
    await dispatchSwipe(page, { fromX: 300, toX: 140, y: 300 });
    await expect(page).not.toHaveURL(startingUrl);
    await expect(page).toHaveURL(/\/g\/Abc234Def5\?photoId=\d+/);

    // The swiped-from indicator must settle back to its resting state —
    // pre-fix it stayed at the drag opacity indefinitely on this path.
    // (After the in-place switch the PREV indicator exists too; check both
    // present indicators.)
    for (const testId of ['swipe-next-indicator', 'swipe-prev-indicator']) {
        const indicator = page.getByTestId(testId);
        if ((await indicator.count()) > 0) {
            await expect(indicator.first()).toHaveCSS('opacity', '0');
        }
    }

    // Phase 3 (C4-29 / TEST4-05, run-10 c4): the reset contract must hold for
    // NON-swipe in-place triggers too — the chevron click reaches the same
    // goToPhoto/onSelectId=setCurrentImageId path but never ran under test
    // (the classic fix-one-sibling-miss-the-next pattern). Step back via the
    // visible prev-chevron and assert the indicators settle identically.
    const urlBeforeChevron = page.url();
    const prevChevron = page.getByRole('button', { name: 'Previous photo' });
    if ((await prevChevron.count()) > 0) {
        await prevChevron.first().click();
        await expect(page).not.toHaveURL(urlBeforeChevron);
        for (const testId of ['swipe-next-indicator', 'swipe-prev-indicator']) {
            const indicator = page.getByTestId(testId);
            if ((await indicator.count()) > 0) {
                await expect(indicator.first()).toHaveCSS('opacity', '0');
            }
        }
    }

    // Phase 4 (C4-04 / PERF4-01, run-10 c4): in-place stepping must be
    // SHALLOW — no server round-trip, no share-limiter burn. Pre-fix, every
    // step was a real RSC navigation through the pre-incrementing /g/[key]
    // render, so a browsing session could exhaust SHARE_MAX_REQUESTS (60/min)
    // and have the open viewer replaced by the 404 page. Step repeatedly and
    // assert the URL keeps tracking the photo id while the viewer stays alive
    // (still the media container, never the not-found page).
    for (let step = 0; step < 6; step++) {
        const before = page.url();
        await dispatchSwipe(page, { fromX: 300, toX: 140, y: 300 });
        // Alternate direction when we hit the end of the group.
        if (page.url() === before) {
            await dispatchSwipe(page, { fromX: 140, toX: 300, y: 300 });
        }
        await expect(page).toHaveURL(/\/g\/Abc234Def5\?photoId=\d+/);
        await expect(page.getByTestId('photo-media-container').first()).toBeVisible();
    }
    await expectNoNextError(page);
});
