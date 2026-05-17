import { MetadataRoute } from 'next';
import { getSeoSettings } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const seo = await getSeoSettings();

  return {
    name: seo.title,
    short_name: seo.nav_title,
    description: seo.description,
    start_url: '/',
    display: 'standalone',
    // R18-L4: declare display_override so Chromium 96+ installability
    // heuristic recognizes window-controls-overlay capability. Falls back
    // to 'standalone' on browsers without WCO support.
    display_override: ['window-controls-overlay', 'standalone'],
    // R18-L4: PWA categories (W3C Web App Manifest spec) help app-store-
    // style listings (Chrome Web Store, Edge Apps) classify the install.
    categories: ['photo', 'photography', 'lifestyle'],
    background_color: '#09090b',
    theme_color: '#09090b',
    icons: [
      {
        src: '/icon',
        sizes: '32x32',
        type: 'image/png',
      },
      {
        src: '/apple-icon',
        sizes: '180x180',
        type: 'image/png',
      },
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
