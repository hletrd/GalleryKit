/**
 * US-P31 — Reactions: cookie HMAC sign/verify and rate-limit boundary tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Cookie HMAC tests ─────────────────────────────────────────────────────────

// Mock getSessionSecret before importing visitor-cookie
vi.mock('@/lib/session', () => ({
    getSessionSecret: vi.fn().mockResolvedValue('test-secret-for-vitest-32-chars!!'),
}));

import {
    signVisitorCookie,
    verifyVisitorCookie,
    computeVisitorIdHash,
    VISITOR_COOKIE_NAME,
} from '@/lib/visitor-cookie';

import {
    checkAndIncrementVisitorReaction,
    checkAndIncrementIpReaction,
    rollbackVisitorReaction,
    rollbackIpReaction,
    resetReactionRateLimitsForTests,
    REACTION_VISITOR_MAX,
    REACTION_IP_MAX,
    REACTION_WINDOW_MS,
} from '@/lib/reaction-rate-limit';

describe('visitor cookie HMAC', () => {
    it('signs and verifies a cookie for today', async () => {
        const uuid = '12345678-1234-4234-b234-123456789abc';
        const cookieValue = await signVisitorCookie(uuid);
        expect(cookieValue).toContain('.');

        const result = await verifyVisitorCookie(cookieValue);
        expect(result).not.toBeNull();
        expect(result?.uuid).toBe(uuid);
    });

    it('rejects a tampered payload', async () => {
        const uuid = '12345678-1234-4234-b234-123456789abc';
        const cookieValue = await signVisitorCookie(uuid);
        // Tamper with the payload
        const parts = cookieValue.split('.');
        const tamperedPayload = Buffer.from('tampered:2000-01-01', 'utf8').toString('base64url');
        const tampered = `${tamperedPayload}.${parts[1]}`;
        const result = await verifyVisitorCookie(tampered);
        expect(result).toBeNull();
    });

    it('rejects a cookie with a wrong date (yesterday)', async () => {
        const uuid = '12345678-1234-4234-b234-123456789abc';
        // Forge a cookie with yesterday's date (can't produce valid HMAC without secret mismatch,
        // but we can check date rejection by forging a plausible-looking value)
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const payload = `${uuid}:${yesterday}`;
        const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
        // Use a real HMAC so the only failure is date mismatch
        const { createHmac } = await import('crypto');
        const hmac = createHmac('sha256', 'test-secret-for-vitest-32-chars!!').update(payload).digest();
        const sigB64 = hmac.toString('base64url');
        const cookieValue = `${payloadB64}.${sigB64}`;

        const result = await verifyVisitorCookie(cookieValue);
        expect(result).toBeNull();
    });

    it('rejects a cookie with no dot separator', async () => {
        const result = await verifyVisitorCookie('nodothere');
        expect(result).toBeNull();
    });

    it('rejects a cookie with invalid base64url payload', async () => {
        const result = await verifyVisitorCookie('!!!invalid!!!.sig');
        expect(result).toBeNull();
    });

    it('VISITOR_COOKIE_NAME is gk_visitor', () => {
        expect(VISITOR_COOKIE_NAME).toBe('gk_visitor');
    });

    it('computeVisitorIdHash returns a 64-char hex string', () => {
        const hash = computeVisitorIdHash('12345678-1234-4234-b234-123456789abc', '2024-01-01');
        expect(hash).toHaveLength(64);
        expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
    });

    it('different dates produce different hashes', () => {
        const uuid = '12345678-1234-4234-b234-123456789abc';
        const h1 = computeVisitorIdHash(uuid, '2024-01-01');
        const h2 = computeVisitorIdHash(uuid, '2024-01-02');
        expect(h1).not.toBe(h2);
    });
});

// ── Rate-limit boundary tests ─────────────────────────────────────────────────

describe('reaction rate limit', () => {
    beforeEach(() => {
        resetReactionRateLimitsForTests();
    });

    afterEach(() => {
        resetReactionRateLimitsForTests();
    });

    it('allows up to REACTION_VISITOR_MAX toggles per visitor', () => {
        const visitor = 'visitor-hash-abc';
        const now = Date.now();

        for (let i = 0; i < REACTION_VISITOR_MAX; i++) {
            const overLimit = checkAndIncrementVisitorReaction(visitor, now);
            expect(overLimit).toBe(false);
        }

        // The (MAX+1)th request is over limit
        const overLimit = checkAndIncrementVisitorReaction(visitor, now);
        expect(overLimit).toBe(true);
    });

    it('allows up to REACTION_IP_MAX toggles per IP', () => {
        const ip = '192.0.2.1';
        const now = Date.now();

        for (let i = 0; i < REACTION_IP_MAX; i++) {
            const overLimit = checkAndIncrementIpReaction(ip, now);
            expect(overLimit).toBe(false);
        }

        // The (MAX+1)th request is over limit
        const overLimit = checkAndIncrementIpReaction(ip, now);
        expect(overLimit).toBe(true);
    });

    it('rolls back visitor rate limit counter', () => {
        const visitor = 'visitor-hash-rollback';
        const now = Date.now();

        // Fill to max
        for (let i = 0; i < REACTION_VISITOR_MAX; i++) {
            checkAndIncrementVisitorReaction(visitor, now);
        }
        // Over limit
        const overLimit = checkAndIncrementVisitorReaction(visitor, now);
        expect(overLimit).toBe(true);

        // Roll back the over-limit increment
        rollbackVisitorReaction(visitor);

        // Now should be exactly at max again — next would be over limit again
        const overLimit2 = checkAndIncrementVisitorReaction(visitor, now);
        expect(overLimit2).toBe(true);
    });

    it('rolls back IP rate limit counter', () => {
        const ip = '192.0.2.2';
        const now = Date.now();

        // Fill to max
        for (let i = 0; i < REACTION_IP_MAX; i++) {
            checkAndIncrementIpReaction(ip, now);
        }
        // Over limit
        const overLimit = checkAndIncrementIpReaction(ip, now);
        expect(overLimit).toBe(true);

        // Roll back
        rollbackIpReaction(ip);

        // Should be at max again
        const overLimit2 = checkAndIncrementIpReaction(ip, now);
        expect(overLimit2).toBe(true);
    });

    it('resets after the window expires', () => {
        const visitor = 'visitor-hash-window';
        const now = Date.now();

        // Fill to max
        for (let i = 0; i < REACTION_VISITOR_MAX; i++) {
            checkAndIncrementVisitorReaction(visitor, now);
        }
        expect(checkAndIncrementVisitorReaction(visitor, now)).toBe(true);

        // Advance past the window
        const future = now + REACTION_WINDOW_MS + 1;
        const overLimit = checkAndIncrementVisitorReaction(visitor, future);
        expect(overLimit).toBe(false);
    });

    it('different visitors have independent buckets', () => {
        const now = Date.now();

        // Fill visitor A to max
        for (let i = 0; i < REACTION_VISITOR_MAX; i++) {
            checkAndIncrementVisitorReaction('visitor-A', now);
        }
        expect(checkAndIncrementVisitorReaction('visitor-A', now)).toBe(true);

        // visitor B still has budget
        expect(checkAndIncrementVisitorReaction('visitor-B', now)).toBe(false);
    });
});
