import { describe, expect, it, vi } from 'vitest';
import {
    assertBlurDataUrl,
    isSafeBlurDataUrl,
    MAX_BLUR_DATA_URL_LENGTH,
} from '@/lib/blur-data-url';

/**
 * Cycle 2 RPF loop AGG2-M01 / SR2-MED-01 / AGG2-L03 / SR2-LOW-01.
 *
 * Defense-in-depth contract for `images.blur_data_url` values that
 * flow into a CSS `url()` invocation in the photo viewer.
 */

describe('isSafeBlurDataUrl', () => {
    it('accepts a JPEG data URI', () => {
        expect(
            isSafeBlurDataUrl('data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUg=='),
        ).toBe(true);
    });

    it('accepts a PNG data URI', () => {
        expect(
            isSafeBlurDataUrl(
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
            ),
        ).toBe(true);
    });

    it('accepts a WebP data URI', () => {
        expect(
            isSafeBlurDataUrl(
                'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
            ),
        ).toBe(true);
    });

    it('rejects an empty string', () => {
        expect(isSafeBlurDataUrl('')).toBe(false);
    });

    it('rejects null and undefined', () => {
        expect(isSafeBlurDataUrl(null)).toBe(false);
        expect(isSafeBlurDataUrl(undefined)).toBe(false);
    });

    it('rejects a non-string value', () => {
        expect(isSafeBlurDataUrl(42)).toBe(false);
        expect(isSafeBlurDataUrl({ src: 'foo' })).toBe(false);
        expect(isSafeBlurDataUrl(['data:image/jpeg;base64,abc'])).toBe(false);
    });

    it('rejects an http: URL', () => {
        expect(
            isSafeBlurDataUrl('http://evil.example/x.png'),
        ).toBe(false);
    });

    it('rejects an https: URL', () => {
        expect(
            isSafeBlurDataUrl('https://gallery.atik.kr/foo.png'),
        ).toBe(false);
    });

    it('rejects a javascript: URL', () => {
        expect(
            isSafeBlurDataUrl('javascript:alert(1)'),
        ).toBe(false);
    });

    it('rejects a data URI with the wrong MIME type', () => {
        expect(
            isSafeBlurDataUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='),
        ).toBe(false);
        expect(
            isSafeBlurDataUrl('data:image/svg+xml;base64,PHN2Zy8+'),
        ).toBe(false);
    });

    it('rejects a data URI with the wrong encoding', () => {
        expect(
            isSafeBlurDataUrl('data:image/jpeg,raw'),
        ).toBe(false);
    });

    it('rejects a payload that exceeds MAX_BLUR_DATA_URL_LENGTH', () => {
        const oversized =
            'data:image/jpeg;base64,' + 'A'.repeat(MAX_BLUR_DATA_URL_LENGTH);
        expect(isSafeBlurDataUrl(oversized)).toBe(false);
    });

    it('accepts a payload at MAX_BLUR_DATA_URL_LENGTH', () => {
        const prefix = 'data:image/jpeg;base64,';
        const padding = 'A'.repeat(MAX_BLUR_DATA_URL_LENGTH - prefix.length);
        expect(isSafeBlurDataUrl(prefix + padding)).toBe(true);
    });
});

describe('assertBlurDataUrl', () => {
    it('returns the value unchanged for a valid input', () => {
        const valid = 'data:image/jpeg;base64,abc';
        expect(assertBlurDataUrl(valid)).toBe(valid);
    });

    it('returns null for null and undefined without warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            expect(assertBlurDataUrl(null)).toBeNull();
            expect(assertBlurDataUrl(undefined)).toBeNull();
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });

    it('returns null and warns for a non-conforming string', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            expect(assertBlurDataUrl('http://evil.example/x.png')).toBeNull();
            expect(warn).toHaveBeenCalledOnce();
        } finally {
            warn.mockRestore();
        }
    });

    it('returns null and warns for a non-string value', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            expect(assertBlurDataUrl(42)).toBeNull();
            expect(warn).toHaveBeenCalledOnce();
        } finally {
            warn.mockRestore();
        }
    });

    /**
     * Cycle 1 RPF loop AGG1-L01 / CR1-LOW-02 / SR1-LOW-01: the warn
     * preview must NOT include arbitrary URL contents past the first
     * 8 chars. A malicious DB-restore payload could carry a token in
     * the query string; the log line must not echo it.
     */
    it('warn preview redacts past the first 8 chars of a rejected string', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const secret = 'https://attacker.example/?token=eyJhbGciOiJIUzI1NiJ9.aabbccdd.eeff';
            assertBlurDataUrl(secret);
            expect(warn).toHaveBeenCalledOnce();
            const callArg = warn.mock.calls[0]?.[0];
            expect(typeof callArg).toBe('string');
            const message = callArg as string;
            // Length is fine to leak (it's coarse).
            expect(message).toContain(`len=${secret.length}`);
            // First 8 chars are the head — `https://` here.
            expect(message).toContain('head="https://"');
            // The token MUST NOT appear anywhere in the warn line.
            expect(message).not.toContain('eyJhbGciOiJIUzI1NiJ9');
            expect(message).not.toContain('attacker.example');
        } finally {
            warn.mockRestore();
        }
    });
});
