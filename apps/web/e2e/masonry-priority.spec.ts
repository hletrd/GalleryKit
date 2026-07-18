import { test, expect } from '@playwright/test';
import { ensureEnglishLocale, expectNoNextError } from './helpers';

for (const viewport of [
  { name: 'mobile', width: 393, height: 852 },
  { name: 'desktop', width: 1536, height: 900 },
] as const) {
  test(`${viewport.name} masonry gives explicit priority only to the universal first card`, async ({ page }) => {
    const imageRequests = new Set<string>();
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.includes('/uploads/')) imageRequests.add(url.pathname);
    });

    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await ensureEnglishLocale(page);
    await page.goto('/');
    await expectNoNextError(page);

    const cards = page.locator('.masonry-card');
    await expect(cards.first()).toBeVisible();
    const layout = await cards.evaluateAll((nodes) => {
      const cardStates = nodes.map((node, index) => {
        const rect = node.getBoundingClientRect();
        const image = node.querySelector('img');
        return {
          index,
          top: rect.top,
          loading: image?.getAttribute('loading'),
          fetchPriority: image?.getAttribute('fetchpriority'),
        };
      });
      const topEdge = Math.min(...cardStates.map((card) => card.top));
      return {
        leaderIndices: cardStates
          .filter((card) => Math.abs(card.top - topEdge) < 2)
          .map((card) => card.index),
        eagerIndices: cardStates
          .filter((card) => card.loading === 'eager')
          .map((card) => card.index),
        highPriorityIndices: cardStates
          .filter((card) => card.fetchPriority === 'high')
          .map((card) => card.index),
        nonFirstStates: cardStates.slice(1).map(({ loading, fetchPriority }) => ({ loading, fetchPriority })),
      };
    });
    expect(layout.eagerIndices).toEqual([0]);
    expect(layout.highPriorityIndices).toEqual([0]);
    expect(layout.nonFirstStates).toEqual(
      layout.nonFirstStates.map(() => ({ loading: 'lazy', fetchPriority: 'auto' })),
    );
    expect(layout.leaderIndices).toContain(0);
    if (viewport.name === 'mobile') {
      expect(layout.leaderIndices).toEqual([0]);
    } else {
      expect(layout.leaderIndices.length).toBeGreaterThan(1);
    }
    await expect(page.locator('link[rel="preload"][as="image"][media]')).toHaveCount(0);

    const firstImagePath = await cards.first().locator('img').evaluate((image) => new URL((image as HTMLImageElement).currentSrc).pathname);
    await expect.poll(() => imageRequests.has(firstImagePath)).toBe(true);
  });
}
