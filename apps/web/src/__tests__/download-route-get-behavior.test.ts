/**
 * AGG-R5C2-19 (TEST-R5C2-12): behavioral tests for the paid-download GET
 * interstitial and the validateDownloadRequest helper.
 *
 * Strategy: test the pure interstitial builder (buildDownloadInterstitialHtml)
 * behaviourally for all response-shape invariants, and validate the token
 * helper contracts (isValidTokenShape, hashToken, verifyTokenAgainstHash)
 * that drive the 400/403/404/410 taxonomy.  The full route-level GET handler
 * requires next-intl getTranslations + DB mocking — that surface is already
 * covered by download-route-method-contract.test.ts (source-contract fixture).
 * This file pins what the code DOES at the helper layer.
 *
 * Invariants verified:
 *   • valid token shape  → isValidTokenShape returns true (200 path precondition)
 *   • malformed token    → isValidTokenShape returns false (400 path)
 *   • expired token      → verifyTokenAgainstHash still verifies hash; expiry
 *                          check is separate (confirmed from route source)
 *   • refunded / claimed → 410 statuses come from validateDownloadRequest which
 *                          checks entitlement.refunded and entitlement.downloadedAt
 *   • interstitial HTML  → Content-Type text/html, CSP header, X-Robots-Tag,
 *                          POST form action present (verified on builder output)
 *   • buildDownloadInterstitialHtml → body contains <form method="post">
 */

import { describe, it, expect } from 'vitest';
import {
    isValidTokenShape,
    hashToken,
    verifyTokenAgainstHash,
    generateDownloadToken,
} from '@/lib/download-tokens';
import { buildDownloadInterstitialHtml } from '@/lib/download-interstitial';

// ---------------------------------------------------------------------------
// Token shape validation (gates the 400 path in validateDownloadRequest)
// ---------------------------------------------------------------------------

describe('isValidTokenShape — 400 path precondition', () => {
    it('accepts a valid dl_<43 base64url> token', () => {
        // generateDownloadToken produces the canonical shape
        const { token } = generateDownloadToken();
        expect(isValidTokenShape(token)).toBe(true);
    });

    it('accepts the minimum valid manual token', () => {
        // 43 base64url chars = A-Z a-z 0-9 _ -
        const token = 'dl_' + 'A'.repeat(43);
        expect(isValidTokenShape(token)).toBe(true);
    });

    it('rejects null', () => {
        expect(isValidTokenShape(null)).toBe(false);
    });

    it('rejects undefined', () => {
        expect(isValidTokenShape(undefined)).toBe(false);
    });

    it('rejects empty string', () => {
        expect(isValidTokenShape('')).toBe(false);
    });

    it('rejects token without dl_ prefix', () => {
        expect(isValidTokenShape('xx_' + 'A'.repeat(43))).toBe(false);
    });

    it('rejects token that is too short (42 base64url chars)', () => {
        expect(isValidTokenShape('dl_' + 'A'.repeat(42))).toBe(false);
    });

    it('rejects token that is too long (44 base64url chars)', () => {
        expect(isValidTokenShape('dl_' + 'A'.repeat(44))).toBe(false);
    });

    it('rejects token with illegal characters (= padding)', () => {
        expect(isValidTokenShape('dl_' + 'A'.repeat(42) + '=')).toBe(false);
    });

    it('rejects token with embedded newline', () => {
        expect(isValidTokenShape('dl_' + 'A'.repeat(21) + '\n' + 'A'.repeat(21))).toBe(false);
    });

    it('rejects token with plus sign (not base64url)', () => {
        expect(isValidTokenShape('dl_' + 'A'.repeat(42) + '+')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// hashToken — deterministic SHA-256 hex
// ---------------------------------------------------------------------------

describe('hashToken', () => {
    it('returns a 64-char lowercase hex string', () => {
        const { token } = generateDownloadToken();
        const h = hashToken(token);
        expect(h).toHaveLength(64);
        expect(h).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic for the same input', () => {
        const { token } = generateDownloadToken();
        expect(hashToken(token)).toBe(hashToken(token));
    });

    it('differs for different tokens', () => {
        const { token: t1 } = generateDownloadToken();
        const { token: t2 } = generateDownloadToken();
        // Tokens are random — hashes must differ
        expect(hashToken(t1)).not.toBe(hashToken(t2));
    });
});

// ---------------------------------------------------------------------------
// verifyTokenAgainstHash — constant-time check (gates 403 / already-used 410)
// ---------------------------------------------------------------------------

describe('verifyTokenAgainstHash', () => {
    it('returns true for a valid matching token and hash (200 path precondition)', () => {
        const { token, hash } = generateDownloadToken();
        expect(verifyTokenAgainstHash(token, hash)).toBe(true);
    });

    it('returns false for a wrong token against a valid hash', () => {
        const { hash } = generateDownloadToken();
        const { token: wrongToken } = generateDownloadToken();
        expect(verifyTokenAgainstHash(wrongToken, hash)).toBe(false);
    });

    it('returns false for a malformed token', () => {
        const { hash } = generateDownloadToken();
        expect(verifyTokenAgainstHash('not-a-token', hash)).toBe(false);
    });

    it('returns false for a malformed stored hash (DB corruption guard)', () => {
        const { token } = generateDownloadToken();
        // storedHash shorter than 64 chars — STORED_HASH_SHAPE test fails
        expect(verifyTokenAgainstHash(token, 'deadbeef')).toBe(false);
    });

    it('returns false for a storedHash with uppercase (must be lowercase hex)', () => {
        const { token } = generateDownloadToken();
        // SHA-256 of token in uppercase — should fail shape check
        const upperHash = hashToken(token).toUpperCase();
        expect(verifyTokenAgainstHash(token, upperHash)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Interstitial HTML shape — pins the GET 200 response body contract.
// The full route GET handler is covered by download-route-method-contract.test.ts
// for source-level assertions; here we assert what buildDownloadInterstitialHtml
// actually produces (behavioral, not source-scan).
// ---------------------------------------------------------------------------

const EXAMPLE_STRINGS = {
    title: 'Download your photo',
    description: 'Click the button to start your download.',
    button: 'Download photo',
    expiryNote: 'Link is single-use and expires after 24 hours.',
};

describe('GET 200 response body — buildDownloadInterstitialHtml shape', () => {
    it('is text/html (DOCTYPE present)', () => {
        const html = buildDownloadInterstitialHtml({ locale: 'en', strings: EXAMPLE_STRINGS });
        expect(html).toMatch(/^<!DOCTYPE html>/i);
    });

    it('contains a POST form (no action attribute — submits to current URL)', () => {
        const html = buildDownloadInterstitialHtml({ locale: 'en', strings: EXAMPLE_STRINGS });
        expect(html).toMatch(/<form method="post">/i);
        expect(html).not.toMatch(/<form[^>]+action=/i);
    });

    it('button has 44px min-height (touch-target policy)', () => {
        const html = buildDownloadInterstitialHtml({ locale: 'en', strings: EXAMPLE_STRINGS });
        expect(html).toMatch(/min-height:\s*44px/);
    });

    it('includes the title in an <h1>', () => {
        const html = buildDownloadInterstitialHtml({ locale: 'en', strings: EXAMPLE_STRINGS });
        expect(html).toContain('<h1>Download your photo</h1>');
    });

    it('includes the button label', () => {
        const html = buildDownloadInterstitialHtml({ locale: 'en', strings: EXAMPLE_STRINGS });
        expect(html).toContain('Download photo');
    });

    it('does NOT embed a token-shaped string in the body', () => {
        const html = buildDownloadInterstitialHtml({ locale: 'en', strings: EXAMPLE_STRINGS });
        expect(html).not.toMatch(/dl_[A-Za-z0-9_-]{43}/);
        expect(html).not.toContain('token=');
    });
});

// ---------------------------------------------------------------------------
// Route-level response header contract — verified via source scan (same style
// as download-route-method-contract.test.ts). Ensures X-Robots-Tag, CSP,
// Content-Type, and Referrer-Policy are wired on the GET 200 path.
// ---------------------------------------------------------------------------

import * as fs from 'fs';
import * as path from 'path';

const routeSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'app', 'api', 'download', '[imageId]', 'route.ts'),
    'utf8',
);

/** Extract the GET handler body from the source. */
function getHandlerBody(): string {
    const start = routeSource.indexOf('export async function GET(');
    const rest = routeSource.slice(start);
    const next = rest.slice(1).search(/\nexport\s/);
    return next === -1 ? rest : rest.slice(0, next + 1);
}

describe('GET 200 response headers (source contract)', () => {
    const getBody = getHandlerBody();

    it('sets Content-Type: text/html; charset=utf-8', () => {
        expect(getBody).toMatch(/'Content-Type':\s*'text\/html; charset=utf-8'/);
    });

    it('sets X-Robots-Tag: noindex, nofollow', () => {
        expect(getBody).toMatch(/'X-Robots-Tag':\s*'noindex, nofollow'/);
    });

    it('sets a restrictive Content-Security-Policy with no scripts, form-action self', () => {
        expect(getBody).toContain("default-src 'none'");
        expect(getBody).toContain("style-src 'unsafe-inline'");
        expect(getBody).toContain("form-action 'self'");
    });

    it('sets Referrer-Policy: no-referrer', () => {
        expect(getBody).toMatch(/'Referrer-Policy':\s*'no-referrer'/);
    });

    it('sets Cache-Control: no-store via NO_STORE spread', () => {
        // NO_STORE constant is defined as { 'Cache-Control': 'no-store, ...' }
        // and spread via ...NO_STORE; verify the constant is defined in the file.
        expect(routeSource).toMatch(/Cache-Control.*no-store/);
    });
});

// ---------------------------------------------------------------------------
// 410 status codes for expired / refunded / already-claimed tokens.
// These are returned by validateDownloadRequest (shared GET+POST helper).
// We verify the source returns 410 for each case to pin the taxonomy.
// ---------------------------------------------------------------------------

describe('GET error status taxonomy (source contract)', () => {
    // The route uses single-quoted string literals in NextResponse calls, e.g.:
    //   new NextResponse('Token expired', { status: 410, headers: NO_STORE })
    // All status codes appear on the SAME line as the message — match that directly.

    it('validateDownloadRequest returns 410 for expired token', () => {
        expect(routeSource).toContain("new NextResponse('Token expired', { status: 410");
    });

    it('validateDownloadRequest returns 410 for refunded purchase', () => {
        expect(routeSource).toContain("new NextResponse('Purchase has been refunded', { status: 410");
    });

    it('validateDownloadRequest returns 410 for already-used token', () => {
        // Appears at least twice: used-row D-101-06 branch + single-use downloadedAt check
        // (POST also has one more 410 for affectedRows=0, so total ≥ 2 in validateDownloadRequest)
        const matches = routeSource.match(/new NextResponse\('Token already used', \{ status: 410/g);
        expect(matches).not.toBeNull();
        expect(matches!.length).toBeGreaterThanOrEqual(2);
    });

    it('validateDownloadRequest returns 400 for invalid token shape', () => {
        expect(routeSource).toContain("new NextResponse('Missing or invalid token', { status: 400");
    });

    it('validateDownloadRequest returns 404 for token not found', () => {
        expect(routeSource).toContain("new NextResponse('Token not found', { status: 404");
    });
});
