'use client';

import { useEffect } from 'react';

/**
 * RegisterServiceWorker — registers /sw.js in production only.
 *
 * Rendered in the root layout. No-ops in development so hot-reload
 * is not disrupted by a stale SW cache.
 *
 * US-P24 PWA story.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch(() => {
        // SW registration failures are non-fatal; the app works without SW.
      });
  }, []);

  return null;
}
