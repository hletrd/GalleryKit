import { MetadataRoute } from 'next';
import { LOCALES, BASE_URL } from '@/lib/constants';

const adminDisallowPaths = ['/admin', '/admin/'];
const localeDisallowPaths = LOCALES.flatMap((locale) => [
  `/${locale}/admin`,
  `/${locale}/admin/`,
]);
// R18-L5: disallow `/api/` for cooperative bots (GPTBot, ClaudeBot, CCBot,
// Brave, Perplexity all respect robots.txt). Explicitly allow OG image
// endpoints first because social crawlers fetch those URLs from metadata.
const apiDisallowPaths = ['/api/'];
const apiAllowPaths = ['/api/og', '/api/og/', '/api/og/photo/'];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', ...apiAllowPaths],
      disallow: [...adminDisallowPaths, ...localeDisallowPaths, ...apiDisallowPaths],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
