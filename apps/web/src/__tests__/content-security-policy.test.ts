import { describe, expect, it } from 'vitest';

import { buildContentSecurityPolicy } from '@/lib/content-security-policy';

describe('buildContentSecurityPolicy', () => {
  it('uses nonces instead of unsafe-inline for production scripts', () => {
    const originalGaId = process.env.NEXT_PUBLIC_GA_ID;
    try {
      // With GA ID set, include GA domains
      process.env.NEXT_PUBLIC_GA_ID = 'G-TEST123';
      const cspWithGa = buildContentSecurityPolicy({ nonce: 'abc123', isDev: false, imageBaseUrl: null });
      expect(cspWithGa).toContain("script-src 'nonce-abc123' 'self' https://www.googletagmanager.com");
      expect(cspWithGa).toContain("connect-src 'self' https://www.google-analytics.com");
      expect(cspWithGa).not.toContain("script-src 'unsafe-inline'");

      // Without GA ID, omit GA domains
      delete process.env.NEXT_PUBLIC_GA_ID;
      const cspNoGa = buildContentSecurityPolicy({ nonce: 'abc123', isDev: false, imageBaseUrl: null });
      expect(cspNoGa).toContain("script-src 'nonce-abc123' 'self'");
      expect(cspNoGa).not.toContain('googletagmanager.com');
      expect(cspNoGa).not.toContain('google-analytics.com');
      expect(cspNoGa).toContain("connect-src 'self'");
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
