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
      const cardsWithPriority = nodes.map((node, index) => {
        const rect = node.getBoundingClientRect();
        const image = node.querySelector('img');
        return {
          index,
          top: rect.top,
          isPriority: image?.getAttribute('loading') === 'eager'
            && image.getAttribute('fetchpriority') === 'high',
        };
      });
      const topEdge = Math.min(...cardsWithPriority.map((card) => card.top));
      return {
        leaderIndices: cardsWithPriority
          .filter((card) => Math.abs(card.top - topEdge) < 2)
          .map((card) => card.index),
        priorityIndices: cardsWithPriority
          .filter((card) => card.isPriority)
          .map((card) => card.index),
      };
    });
    expect(layout.priorityIndices).toEqual([0]);
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
