import { describe, expect, it } from 'vitest';

import { buildContentSecurityPolicy } from '@/lib/content-security-policy';

describe('buildContentSecurityPolicy', () => {
  it('uses nonces instead of unsafe-inline for production scripts', () => {
    const csp = buildContentSecurityPolicy({ nonce: 'abc123', isDev: false, imageBaseUrl: null });

    expect(csp).toContain("script-src 'nonce-abc123' 'self' https://www.googletagmanager.com");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
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
