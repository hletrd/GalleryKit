import { MetadataRoute } from 'next';
import siteConfig from "@/site-config.json";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/admin/',
    },
    sitemap: `${process.env.BASE_URL || siteConfig.url}/sitemap.xml`,
  };
}
