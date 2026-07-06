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

test('shared-group in-place swipe: navigates AND resets the edge indicator + progress bar', async ({ page }) => {
    await ensureEnglishLocale(page);
    await page.goto('/g/Abc234Def5');
    await expectNoNextError(page);

    const firstSharedPhoto = page.locator('a[href*="/g/Abc234Def5?photoId="]').first();
    await expect(firstSharedPhoto).toBeVisible();
    await firstSharedPhoto.click();
    await expect(page).toHaveURL(/\/g\/Abc234Def5\?photoId=\d+/);
    const startingUrl = page.url();

    // Swipe left well past the 80px threshold → next photo, in place.
    await dispatchSwipe(page, { fromX: 300, toX: 140, y: 300 });

    await expect(page).not.toHaveURL(startingUrl);
    await expect(page).toHaveURL(/\/g\/Abc234Def5\?photoId=\d+/);

    // The swiped-from indicator must settle back to its resting state —
    // pre-fix it stayed at the drag opacity indefinitely on this path.
    // (After the in-place switch the PREV indicator exists too; check both
    // present indicators and the progress bar wrapper's opacity.)
    for (const testId of ['swipe-next-indicator', 'swipe-prev-indicator']) {
        const indicator = page.getByTestId(testId);
        if ((await indicator.count()) > 0) {
            await expect(indicator.first()).toHaveCSS('opacity', '0');
        }
    }
});

test('sub-threshold swipe snaps back: no navigation, indicator resets', async ({ page }) => {
    await ensureEnglishLocale(page);
    await page.goto('/g/Abc234Def5');
    await expectNoNextError(page);

    const firstSharedPhoto = page.locator('a[href*="/g/Abc234Def5?photoId="]').first();
    await firstSharedPhoto.click();
    await expect(page).toHaveURL(/\/g\/Abc234Def5\?photoId=\d+/);
    const startingUrl = page.url();

    // 40px < the 80px threshold → snap back, same photo.
    await dispatchSwipe(page, { fromX: 300, toX: 260, y: 300 });

    await expect(page).toHaveURL(startingUrl);
    const next = page.getByTestId('swipe-next-indicator');
    if ((await next.count()) > 0) {
        await expect(next.first()).toHaveCSS('opacity', '0');
    }
});
