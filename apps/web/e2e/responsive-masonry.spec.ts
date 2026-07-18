import { expect, test } from '@playwright/test';
import { expectNoNextError } from './helpers';

const ARCHIVE_SIZES = '(min-width: 1536px) 20vw, (min-width: 1280px) 25vw, '
  + '(min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw';
const SHARED_GROUP_SIZES = '(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, '
  + '(min-width: 768px) 50vw, 100vw';
const TWO_ITEM_MAIN_SIZES = '(min-width: 1536px) 50vw, (min-width: 1280px) 50vw, '
  + '(min-width: 768px) 50vw, (min-width: 640px) 50vw, 100vw';

for (const boundary of [
  { width: 320, columns: '1', candidate: 640 },
  { width: 1536, columns: '2', candidate: 1536 },
  { width: 2560, columns: '2', candidate: 1536 },
] as const) {
  test.describe(`sparse main-gallery masonry at ${boundary.width}px`, () => {
    test.use({
      viewport: { width: boundary.width, height: 900 },
      deviceScaleFactor: 2,
    });

    test('shares item-capped columns across sources and intrinsic geometry', async ({ page }) => {
      await page.goto('/en/e2e-smoke');
      await expectNoNextError(page);

      const picture = page.locator('picture[data-grid-picture]').first();
      await expect(picture).toBeVisible();
      const state = await picture.evaluate(async (node) => {
        const grid = node.closest<HTMLElement>('.columns-1');
        const card = node.closest<HTMLElement>('.masonry-card');
        const image = node.querySelector<HTMLImageElement>('img');
        const source = node.querySelector<HTMLSourceElement>('source');
        if (!grid || !card || !image || !source) throw new Error('Missing main masonry structure');
        await image.decode();
        const intrinsicSize = getComputedStyle(card).containIntrinsicSize;
        const intrinsicHeightMatch = intrinsicSize.match(/([\d.]+)px$/);
        return {
          columns: getComputedStyle(grid).columnCount,
          sizes: source.sizes,
          currentSrc: image.currentSrc,
          cardHeight: card.getBoundingClientRect().height,
          intrinsicSize,
          intrinsicHeight: intrinsicHeightMatch ? Number(intrinsicHeightMatch[1]) : null,
        };
      });

      expect(state.columns).toBe(boundary.columns);
      expect(state.sizes).toBe(TWO_ITEM_MAIN_SIZES);
      expect(state.currentSrc).toMatch(new RegExp(`_${boundary.candidate}\\.(?:avif|webp|jpg)$`));
      expect(state.intrinsicHeight, state.intrinsicSize).not.toBeNull();
      expect(state.intrinsicHeight!).toBeGreaterThan(state.cardHeight * 0.85);
      expect(state.intrinsicHeight!).toBeLessThan(state.cardHeight * 1.15);
    });
  });
}

for (const boundary of [
  { width: 640, columns: '2' },
  { width: 768, columns: '3', candidate: 640 },
  { width: 1280, columns: '4' },
  { width: 1536, columns: '5' },
] as const) {
  test.describe(`archive masonry at ${boundary.width}px`, () => {
    test.use({
      viewport: { width: boundary.width, height: 900 },
      deviceScaleFactor: 2,
    });

    test('aligns responsive source sizes with the rendered columns', async ({ page }) => {
      await page.goto('/en/timeline');
      await expectNoNextError(page);

      const picture = page.locator('picture[data-grid-picture]').first();
      await expect(picture).toBeVisible();
      const state = await picture.evaluate(async (node) => {
        const grid = node.closest<HTMLElement>('.columns-1');
        const image = node.querySelector<HTMLImageElement>('img');
        const source = node.querySelector<HTMLSourceElement>('source');
        if (!grid || !image || !source) throw new Error('Missing archive masonry structure');
        await image.decode();
        return {
          columns: getComputedStyle(grid).columnCount,
          sizes: source.sizes,
          currentSrc: image.currentSrc,
        };
      });

      expect(state.columns).toBe(boundary.columns);
      expect(state.sizes).toBe(ARCHIVE_SIZES);
      if ('candidate' in boundary) {
        expect(state.currentSrc).toMatch(new RegExp(`_${boundary.candidate}\\.(?:avif|webp|jpg)$`));
      }
    });
  });
}

for (const boundary of [
  // 33vw at DPR 2 is wider than the 640w candidate, so the coarse seeded
  // ladder correctly selects 1536w even though the slot policy is aligned.
  { width: 1024, columns: '3', candidate: 1536 },
  { width: 1280, columns: '4', candidate: 640 },
] as const) {
  test.describe(`shared-group masonry at ${boundary.width}px`, () => {
    test.use({
      viewport: { width: boundary.width, height: 900 },
      deviceScaleFactor: 2,
    });

    test('aligns responsive source sizes with the rendered columns', async ({ page }) => {
      await page.goto('/g/Abc234Def5');
      await expectNoNextError(page);

      const picture = page.locator('picture[data-grid-picture]').first();
      await expect(picture).toBeVisible();
      const state = await picture.evaluate(async (node) => {
        const grid = node.closest<HTMLElement>('.columns-1');
        const image = node.querySelector<HTMLImageElement>('img');
        const source = node.querySelector<HTMLSourceElement>('source');
        if (!grid || !image || !source) throw new Error('Missing shared-group masonry structure');
        await image.decode();
        return {
          columns: getComputedStyle(grid).columnCount,
          sizes: source.sizes,
          currentSrc: image.currentSrc,
        };
      });

      expect(state.columns).toBe(boundary.columns);
      expect(state.sizes).toBe(SHARED_GROUP_SIZES);
      expect(state.currentSrc).toMatch(new RegExp(`_${boundary.candidate}\\.(?:avif|webp|jpg)$`));
    });
  });
}
