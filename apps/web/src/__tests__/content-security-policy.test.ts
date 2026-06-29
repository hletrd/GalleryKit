import { describe, expect, it } from 'vitest';

import { buildContentSecurityPolicy } from '@/lib/content-security-policy';

describe('buildContentSecurityPolicy', () => {
  it('uses nonces instead of unsafe-inline for production scripts', () => {
    const originalGaId = process.env.NEXT_PUBLIC_GA_ID;
    try {
      // With explicit site-config GA ID, include GA domains even when the env
      // knob is absent. This mirrors layout.tsx, which renders from
      // site-config.json rather than NEXT_PUBLIC_GA_ID.
      delete process.env.NEXT_PUBLIC_GA_ID;
      const cspWithGa = buildContentSecurityPolicy({
        nonce: 'abc123',
        isDev: false,
        imageBaseUrl: null,
        googleAnalyticsId: 'G-TEST123',
      });
      // COR-R4C16-02: Google's documented GA4 CSP contract (analytics
      // tier) — wildcard hosts cover the regional collect endpoints
      // (region1.google-analytics.com for EU data residency) that the
      // previous literal www. hosts silently blocked.
      expect(cspWithGa).toContain("script-src 'nonce-abc123' 'self' https://*.googletagmanager.com");
      expect(cspWithGa).toContain("connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com");
      expect(cspWithGa).toContain("img-src 'self' data: blob: https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org https://*.google-analytics.com https://*.googletagmanager.com");
      expect(cspWithGa).not.toContain("script-src 'unsafe-inline'");
      // Analytics tier ONLY — advertising hosts must never creep in.
      expect(cspWithGa).not.toContain('doubleclick');
      expect(cspWithGa).not.toContain('googlesyndication');

      // Without GA ID, omit GA domains
      delete process.env.NEXT_PUBLIC_GA_ID;
      const cspNoGa = buildContentSecurityPolicy({
        nonce: 'abc123',
        isDev: false,
        imageBaseUrl: null,
        googleAnalyticsId: '',
      });
      expect(cspNoGa).toContain("script-src 'nonce-abc123' 'self'");
      expect(cspNoGa).not.toContain('googletagmanager.com');
      expect(cspNoGa).not.toContain('google-analytics.com');
      expect(cspNoGa).not.toContain('analytics.google.com');
      expect(cspNoGa).toContain("connect-src 'self'");
      expect(cspNoGa).toContain("img-src 'self' data: blob: https://a.tile.openstreetmap.org https://b.tile.openstreetmap.org https://c.tile.openstreetmap.org;");
    } finally {
      if (originalGaId !== undefined) {
        process.env.NEXT_PUBLIC_GA_ID = originalGaId;
      } else {
        delete process.env.NEXT_PUBLIC_GA_ID;
      }
    }
  });

  it('keeps development inline/eval allowances for Next dev tooling only', () => {
    const csp = buildContentSecurityPolicy({ isDev: true, imageBaseUrl: null });

    expect(csp).toContain("script-src 'unsafe-inline' 'unsafe-eval' 'self'");
  });

  it('does not allow unused third-party style CDNs in production', () => {
    const csp = buildContentSecurityPolicy({ nonce: 'abc123', isDev: false, imageBaseUrl: null });

    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain('cdn.jsdelivr.net');
  });
});
