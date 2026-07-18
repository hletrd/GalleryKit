import { expect, test } from '@playwright/test';
import { expectNoNextError } from './helpers';

const ARCHIVE_SIZES = '(min-width: 1536px) 288px, (min-width: 1280px) 300px, '
  + '(min-width: 1024px) 320px, (min-width: 768px) 234px, '
  + '(min-width: 640px) 296px, calc(100vw - 32px)';
const SHARED_GROUP_SIZES = '(min-width: 1536px) 356px, (min-width: 1280px) 292px, '
  + '(min-width: 1024px) 309px, (min-width: 768px) 344px, '
  + '(min-width: 640px) 576px, calc(100vw - 64px)';
const TWO_ITEM_MAIN_SIZES = '(min-width: 1536px) 744px, (min-width: 1280px) 616px, '
  + '(min-width: 1024px) 488px, (min-width: 768px) 360px, '
  + '(min-width: 640px) 296px, calc(100vw - 32px)';
const THREE_ITEM_MAIN_SIZES = '(min-width: 1536px) 490px, (min-width: 1280px) 405px, '
  + '(min-width: 1024px) 320px, (min-width: 768px) 234px, '
  + '(min-width: 640px) 296px, calc(100vw - 32px)';

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
      await page.goto('/en/e2e-smoke?tags=sparse');
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

test.describe('normal main-gallery masonry above the container cap', () => {
  test.use({
    viewport: { width: 2560, height: 900 },
    deviceScaleFactor: 1,
  });

  test('selects the 640w candidate for three real 491px slots', async ({ page }) => {
    await page.goto('/en/e2e-smoke');
    await expectNoNextError(page);

    const picture = page.locator('picture[data-grid-picture]').first();
    await expect(picture).toBeVisible();
    const state = await picture.evaluate(async (node) => {
      const grid = node.closest<HTMLElement>('.columns-1');
      const card = node.closest<HTMLElement>('.masonry-card');
      const image = node.querySelector<HTMLImageElement>('img');
      const source = node.querySelector<HTMLSourceElement>('source');
      if (!grid || !card || !image || !source) throw new Error('Missing normal main masonry structure');
      await image.decode();
      return {
        columns: getComputedStyle(grid).columnCount,
        gridWidth: grid.getBoundingClientRect().width,
        cardWidth: card.getBoundingClientRect().width,
        sizes: source.sizes,
        currentSrc: image.currentSrc,
      };
    });

    expect(state.columns).toBe('3');
    expect(state.gridWidth).toBeCloseTo(1504, 0);
    expect(state.cardWidth).toBeCloseTo(491, 0);
    expect(state.sizes).toBe(THREE_ITEM_MAIN_SIZES);
    expect(state.currentSrc).toMatch(/_640\.(?:avif|webp|jpg)$/);
  });
});

for (const boundary of [
  { width: 640, columns: '2', candidate: 640 },
  { width: 768, columns: '3', candidate: 640 },
  { width: 1280, columns: '4', candidate: 640 },
  { width: 1536, columns: '5', candidate: 640 },
  { width: 2560, columns: '5', candidate: 640 },
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
        const card = node.closest<HTMLElement>('.break-inside-avoid');
        const image = node.querySelector<HTMLImageElement>('img');
        const source = node.querySelector<HTMLSourceElement>('source');
        if (!grid || !card || !image || !source) throw new Error('Missing archive masonry structure');
        await image.decode();
        return {
          columns: getComputedStyle(grid).columnCount,
          gridWidth: grid.getBoundingClientRect().width,
          cardWidth: card.getBoundingClientRect().width,
          sizes: source.sizes,
          currentSrc: image.currentSrc,
        };
      });

      expect(state.columns).toBe(boundary.columns);
      expect(state.sizes).toBe(ARCHIVE_SIZES);
      expect(state.currentSrc).toMatch(new RegExp(`_${boundary.candidate}\\.(?:avif|webp|jpg)$`));
      if (boundary.width === 2560) {
        expect(state.gridWidth).toBeCloseTo(1504, 0);
        expect(state.cardWidth).toBeCloseTo(288, 0);
      }
    });
  });
}

for (const boundary of [
  { width: 1024, columns: '3', candidate: 640 },
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

test.describe('shared-group masonry above the outer container cap', () => {
  test.use({
    viewport: { width: 2700, height: 900 },
    deviceScaleFactor: 1,
  });

  test('selects the 640w candidate for nested-container slots', async ({ page }) => {
    await page.goto('/g/Abc234Def5');
    await expectNoNextError(page);

    const picture = page.locator('picture[data-grid-picture]').first();
    await expect(picture).toBeVisible();
    const state = await picture.evaluate(async (node) => {
      const grid = node.closest<HTMLElement>('.columns-1');
      const card = node.closest<HTMLElement>('a');
      const image = node.querySelector<HTMLImageElement>('img');
      const source = node.querySelector<HTMLSourceElement>('source');
      if (!grid || !card || !image || !source) throw new Error('Missing capped shared masonry structure');
      await image.decode();
      return {
        columns: getComputedStyle(grid).columnCount,
        gridWidth: grid.getBoundingClientRect().width,
        cardWidth: card.getBoundingClientRect().width,
        sizes: source.sizes,
        currentSrc: image.currentSrc,
      };
    });

    expect(state.columns).toBe('4');
    expect(state.gridWidth).toBeCloseTo(1472, 0);
    expect(state.cardWidth).toBeCloseTo(356, 0);
    expect(state.sizes).toBe(SHARED_GROUP_SIZES);
    expect(state.currentSrc).toMatch(/_640\.(?:avif|webp|jpg)$/);
  });
});
