import { MetadataRoute } from 'next';
import { LOCALES, BASE_URL } from '@/lib/constants';

const adminDisallowPaths = ['/admin', '/admin/'];
const localeDisallowPaths = LOCALES.flatMap((locale) => [
  `/${locale}/admin`,
  `/${locale}/admin/`,
]);

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [...adminDisallowPaths, ...localeDisallowPaths],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
