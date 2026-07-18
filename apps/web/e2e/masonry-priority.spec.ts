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
    const priorityIndices = await cards.evaluateAll((nodes) => nodes.flatMap((node, index) => {
      const image = node.querySelector('img');
      return image?.getAttribute('loading') === 'eager' && image.getAttribute('fetchpriority') === 'high'
        ? [index]
        : [];
    }));
    expect(priorityIndices).toEqual([0]);
    await expect(page.locator('link[rel="preload"][as="image"][media]')).toHaveCount(0);

    const firstImagePath = await cards.first().locator('img').evaluate((image) => new URL((image as HTMLImageElement).currentSrc).pathname);
    await expect.poll(() => imageRequests.has(firstImagePath)).toBe(true);
  });
}
