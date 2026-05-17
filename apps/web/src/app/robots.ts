import { MetadataRoute } from 'next';
import { LOCALES, BASE_URL } from '@/lib/constants';

const adminDisallowPaths = ['/admin', '/admin/'];
const localeDisallowPaths = LOCALES.flatMap((locale) => [
  `/${locale}/admin`,
  `/${locale}/admin/`,
]);
// R18-L5: disallow `/api/` for cooperative bots (GPTBot, ClaudeBot, CCBot,
// Brave, Perplexity all respect robots.txt). The OG-image endpoint at
// `/api/og/photo/[id]` is CPU-intensive (Satori PNG → Sharp re-encode) and
// already rate-limited; preventing well-behaved bots from crawling it
// saves origin CPU without affecting SEO (the feed/sitemap/manifest/og
// metadata are all outside `/api/` and remain crawlable).
const apiDisallowPaths = ['/api/'];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [...adminDisallowPaths, ...localeDisallowPaths, ...apiDisallowPaths],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
