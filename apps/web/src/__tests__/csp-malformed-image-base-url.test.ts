import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  buildCspSafely as BuildCspSafely,
  sanitizeImageBaseUrlSafely as SanitizeImageBaseUrlSafely,
} from '@/lib/content-security-policy';

// C2-37 (run-10 c2): buildContentSecurityPolicy's imageBaseUrl default parses
// IMAGE_BASE_URL synchronously and throws on a malformed/credential-bearing
// value. proxy.ts calls buildContentSecurityPolicy on every request, so an
// unvalidated runtime env var can 500 the entire site via middleware.
// buildCspSafely must never throw: on failure it falls back to a CSP built
// without the image base URL and logs the failure once per process.
//
// The "logged once" flag lives at module scope, so each test resets the
// module registry and re-imports to get a fresh flag instead of leaking
// state across tests.
describe('buildCspSafely', () => {
  const originalImageBaseUrl = process.env.IMAGE_BASE_URL;
  let buildCspSafely: typeof BuildCspSafely;
  let sanitizeImageBaseUrlSafely: typeof SanitizeImageBaseUrlSafely;

  beforeEach(async () => {
    vi.resetModules();
    ({ buildCspSafely, sanitizeImageBaseUrlSafely } = await import('@/lib/content-security-policy'));
  });

  afterEach(() => {
    if (originalImageBaseUrl !== undefined) {
      process.env.IMAGE_BASE_URL = originalImageBaseUrl;
    } else {
      delete process.env.IMAGE_BASE_URL;
    }
    vi.restoreAllMocks();
  });

  it('does not throw on a malformed IMAGE_BASE_URL and falls back without the bad origin', () => {
    process.env.IMAGE_BASE_URL = 'not a url';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let csp = '';
    expect(() => {
      csp = buildCspSafely({ nonce: 'abc123', isDev: false });
    }).not.toThrow();

    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).not.toContain('not a url');
    expect(csp).toContain("script-src 'nonce-abc123' 'self'");
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('does not throw on a credential-bearing IMAGE_BASE_URL and omits it from img-src', () => {
    process.env.IMAGE_BASE_URL = 'https://user:pass@cdn.example.com';
    vi.spyOn(console, 'error').mockImplementation(() => {});

    let csp = '';
    expect(() => {
      csp = buildCspSafely({ nonce: 'abc123', isDev: false });
    }).not.toThrow();

    expect(csp).not.toContain('cdn.example.com');
    expect(csp).not.toContain('user:pass');
  });

  it('logs the fallback failure only once per process across repeated invocations', () => {
    process.env.IMAGE_BASE_URL = 'not a url';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    buildCspSafely({ nonce: 'first', isDev: false });
    buildCspSafely({ nonce: 'second', isDev: false });

    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('builds the normal CSP unchanged for a valid IMAGE_BASE_URL', () => {
    process.env.IMAGE_BASE_URL = 'https://cdn.example.com';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const csp = buildCspSafely({ nonce: 'abc123', isDev: false });

    expect(csp).toContain("img-src 'self' data: blob: https://cdn.example.com");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('builds the normal CSP unchanged when IMAGE_BASE_URL is unset', () => {
    delete process.env.IMAGE_BASE_URL;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const csp = buildCspSafely({ nonce: 'abc123', isDev: false });

    expect(csp).toContain("img-src 'self' data: blob:");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs sanitizer fallback failures once on the server side', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(sanitizeImageBaseUrlSafely('https://user:pass@cdn.example.com')).toBe('');
    expect(sanitizeImageBaseUrlSafely('https://user:pass@cdn.example.com')).toBe('');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('IMAGE_BASE_URL rejected by the sanitizer'),
      expect.any(Error),
    );
  });
});
