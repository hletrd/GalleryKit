import { MetadataRoute } from 'next';
import siteConfig from "@/site-config.json";
import { LOCALES } from '@/lib/constants';

const adminDisallowPaths = ['/admin', '/admin/'];
const shareDisallowPaths = ['/s/', '/g/'];
const localeDisallowPaths = LOCALES.flatMap((locale) => [
  `/${locale}/admin`,
  `/${locale}/admin/`,
  `/${locale}/s/`,
  `/${locale}/g/`,
]);

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [...adminDisallowPaths, ...shareDisallowPaths, ...localeDisallowPaths],
    },
    sitemap: `${process.env.BASE_URL || siteConfig.url}/sitemap.xml`,
  };
}
