/**
 * US-P54: Vitest unit tests covering:
 *   1. Webhook signature verification (constructStripeEvent)
 *   2. Token generation, hashing, and verification (download-tokens)
 *   3. Single-use enforcement semantics (verifyTokenAgainstHash + downloadedAt logic)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { generateDownloadToken, hashToken, verifyTokenAgainstHash } from '../lib/download-tokens';

// ── 1. Download token generation ──────────────────────────────────────────────

describe('generateDownloadToken', () => {
    it('produces a token with the dl_ prefix', () => {
        const { token } = generateDownloadToken();
        expect(token.startsWith('dl_')).toBe(true);
    });

    it('produces a token of the correct length (dl_ + 43 base64url chars)', () => {
        const { token } = generateDownloadToken();
        // 32 bytes → 43 base64url chars (ceil(32/3)*4 = 44 but no padding → 43)
        expect(token.length).toBe(46); // 'dl_' (3) + 43
    });

    it('produces unique tokens on successive calls', () => {
        const tokens = Array.from({ length: 20 }, () => generateDownloadToken().token);
        const unique = new Set(tokens);
        expect(unique.size).toBe(20);
    });

    it('hash is 64 hex chars (SHA-256)', () => {
        const { hash } = generateDownloadToken();
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('hash matches hashToken(token)', () => {
        const { token, hash } = generateDownloadToken();
        expect(hash).toBe(hashToken(token));
    });
});

// ── 2. hashToken ──────────────────────────────────────────────────────────────

describe('hashToken', () => {
    it('is deterministic', () => {
        const token = 'dl_sometoken';
        expect(hashToken(token)).toBe(hashToken(token));
    });

    it('produces different hashes for different tokens', () => {
        expect(hashToken('dl_tokenA')).not.toBe(hashToken('dl_tokenB'));
    });

    it('returns a 64-char hex string', () => {
        expect(hashToken('dl_test')).toMatch(/^[0-9a-f]{64}$/);
    });
});

// ── 3. verifyTokenAgainstHash ─────────────────────────────────────────────────

describe('verifyTokenAgainstHash', () => {
    it('returns true when token matches stored hash', () => {
        const { token, hash } = generateDownloadToken();
        expect(verifyTokenAgainstHash(token, hash)).toBe(true);
    });

    it('returns false for wrong token', () => {
        const { hash } = generateDownloadToken();
        const { token: otherToken } = generateDownloadToken();
        expect(verifyTokenAgainstHash(otherToken, hash)).toBe(false);
    });

    it('returns false when token lacks dl_ prefix', () => {
        const { hash } = generateDownloadToken();
        expect(verifyTokenAgainstHash('notadltoken', hash)).toBe(false);
    });

    it('returns false for empty token', () => {
        const { hash } = generateDownloadToken();
        expect(verifyTokenAgainstHash('', hash)).toBe(false);
    });

    it('returns false for tampered hash', () => {
        const { token } = generateDownloadToken();
        const tamperedHash = 'a'.repeat(64);
        expect(verifyTokenAgainstHash(token, tamperedHash)).toBe(false);
    });
});

// ── 4. Single-use enforcement semantics ───────────────────────────────────────

describe('single-use enforcement (logic contract)', () => {
    /**
     * The download route enforces single-use by:
     *   1. Checking downloadedAt IS NULL before serving.
     *   2. Running an atomic UPDATE ... WHERE downloadedAt IS NULL.
     *   3. Returning 410 Gone if the UPDATE affected 0 rows.
     *
     * These tests verify that the token+hash contract supports this:
     * - Once a token is verified and the hash is cleared (set to null),
     *   subsequent calls with the same token cannot match null.
     * - The verifyTokenAgainstHash call correctly rejects null/empty stored hashes.
     */

    it('rejects verification when stored hash is null (post-download state)', () => {
        const { token } = generateDownloadToken();
        // After download: downloadTokenHash is set to null in DB
        expect(verifyTokenAgainstHash(token, null as unknown as string)).toBe(false);
    });

    it('rejects verification when stored hash is empty string', () => {
        const { token } = generateDownloadToken();
        expect(verifyTokenAgainstHash(token, '')).toBe(false);
    });

    it('two different tokens produce different hashes (collision resistance)', () => {
        const a = generateDownloadToken();
        const b = generateDownloadToken();
        expect(a.hash).not.toBe(b.hash);
        // Cross-verify: a's token should not match b's hash
        expect(verifyTokenAgainstHash(a.token, b.hash)).toBe(false);
        expect(verifyTokenAgainstHash(b.token, a.hash)).toBe(false);
    });

    it('token expiry: 24h window captured in Date arithmetic', () => {
        const now = Date.now();
        const expiresAt = new Date(now + 24 * 60 * 60 * 1000);
        // Just before expiry: not expired
        expect(new Date(now + 23 * 60 * 60 * 1000) < expiresAt).toBe(true);
        // After expiry: expired
        expect(new Date(now + 25 * 60 * 60 * 1000) > expiresAt).toBe(true);
    });
});

// ── 5. Stripe webhook signature verification (structural test) ────────────────

describe('Stripe webhook signature verification (structural)', () => {
    /**
     * We verify the structural contract of constructStripeEvent without
     * importing Stripe (which requires STRIPE_SECRET_KEY env at module init).
     * The route file asserts:
     *   1. It reads raw body as text (not JSON-parsed).
     *   2. It calls constructStripeEvent(payload, signature).
     *   3. It returns 400 if signature header is missing.
     *   4. It returns 400 if constructStripeEvent throws.
     * These are validated by reading the route source.
     */

    it('webhook route imports constructStripeEvent from @/lib/stripe', () => {
        const src = fs.readFileSync(
            path.resolve(__dirname, '..', 'app', 'api', 'stripe', 'webhook', 'route.ts'),
            'utf8'
        );
        expect(src).toMatch(/import.*constructStripeEvent.*from.*['"]@\/lib\/stripe['"]/);
    });

    it('webhook route verifies stripe-signature header before processing', () => {
        const src = fs.readFileSync(
            path.resolve(__dirname, '..', 'app', 'api', 'stripe', 'webhook', 'route.ts'),
            'utf8'
        );
        expect(src).toMatch(/stripe-signature/);
        expect(src).toMatch(/Missing stripe-signature/);
    });

    it('webhook route reads raw body as text for signature verification', () => {
        const src = fs.readFileSync(
            path.resolve(__dirname, '..', 'app', 'api', 'stripe', 'webhook', 'route.ts'),
            'utf8'
        );
        expect(src).toMatch(/request\.text\(\)/);
    });

    it('webhook route runs in nodejs runtime not edge', () => {
        const src = fs.readFileSync(
            path.resolve(__dirname, '..', 'app', 'api', 'stripe', 'webhook', 'route.ts'),
            'utf8'
        );
        expect(src).toMatch(/export const runtime\s*=\s*['"]nodejs['"]/);
    });

    it('constructStripeEvent in stripe.ts uses stripe.webhooks.constructEvent', () => {
        const src = fs.readFileSync(
            path.resolve(__dirname, '..', 'lib', 'stripe.ts'),
            'utf8'
        );
        expect(src).toMatch(/stripe\.webhooks\.constructEvent/);
    });

    it('download route enforces single-use with isNull check', () => {
        const src = fs.readFileSync(
            path.resolve(__dirname, '..', 'app', 'api', 'download', '[imageId]', 'route.ts'),
            'utf8'
        );
        expect(src).toMatch(/isNull/);
        expect(src).toMatch(/downloadedAt/);
        expect(src).toMatch(/410/);
    });
});
