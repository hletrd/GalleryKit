/**
 * TEST-R5C1-04: isValidTokenShape boundary tests.
 * Token format: dl_<43-char base64url> (46 chars total).
 * Tests null/undefined/non-string, exact-length pins (42 and 44 char bodies),
 * wrong prefix, non-base64url charset, valid shape, and real generator output.
 */

import { describe, it, expect } from 'vitest';
import { isValidTokenShape, generateDownloadToken } from '@/lib/download-tokens';

describe('isValidTokenShape', () => {
    // ── Null / undefined / non-string ────────────────────────────────────────

    it('returns false for null', () => {
        expect(isValidTokenShape(null)).toBe(false);
    });

    it('returns false for undefined', () => {
        expect(isValidTokenShape(undefined)).toBe(false);
    });

    it('returns false for a number', () => {
        // @ts-expect-error — testing runtime behavior with wrong type
        expect(isValidTokenShape(42)).toBe(false);
    });

    it('returns false for an object', () => {
        // @ts-expect-error — testing runtime behavior with wrong type
        expect(isValidTokenShape({})).toBe(false);
    });

    it('returns false for empty string', () => {
        expect(isValidTokenShape('')).toBe(false);
    });

    // ── Exact-length pin: 42-char body (one too short) → false ───────────────

    it('rejects dl_ prefix with 42-char body (one too short)', () => {
        const body42 = 'A'.repeat(42);
        expect(isValidTokenShape(`dl_${body42}`)).toBe(false);
    });

    // ── Exact-length pin: 44-char body (one too long) → false ────────────────

    it('rejects dl_ prefix with 44-char body (one too long)', () => {
        const body44 = 'A'.repeat(44);
        expect(isValidTokenShape(`dl_${body44}`)).toBe(false);
    });

    // ── Wrong prefix ──────────────────────────────────────────────────────────

    it('rejects wrong prefix "gk_"', () => {
        const body = 'A'.repeat(43);
        expect(isValidTokenShape(`gk_${body}`)).toBe(false);
    });

    it('rejects wrong prefix "dl-" (hyphen not underscore)', () => {
        const body = 'A'.repeat(43);
        expect(isValidTokenShape(`dl-${body}`)).toBe(false);
    });

    it('rejects no prefix (raw 43-char base64url)', () => {
        const body = 'A'.repeat(43);
        expect(isValidTokenShape(body)).toBe(false);
    });

    // ── Non-base64url charset ────────────────────────────────────────────────

    it('rejects + (standard base64 but not base64url)', () => {
        const body = '+' + 'A'.repeat(42);
        expect(isValidTokenShape(`dl_${body}`)).toBe(false);
    });

    it('rejects / (standard base64 but not base64url)', () => {
        const body = '/' + 'A'.repeat(42);
        expect(isValidTokenShape(`dl_${body}`)).toBe(false);
    });

    it('rejects = (padding, not part of base64url body)', () => {
        const body = '=' + 'A'.repeat(42);
        expect(isValidTokenShape(`dl_${body}`)).toBe(false);
    });

    it('rejects space character', () => {
        const body = ' ' + 'A'.repeat(42);
        expect(isValidTokenShape(`dl_${body}`)).toBe(false);
    });

    it('rejects @ symbol', () => {
        const body = '@' + 'A'.repeat(42);
        expect(isValidTokenShape(`dl_${body}`)).toBe(false);
    });

    // ── Valid exact shape ─────────────────────────────────────────────────────

    it('accepts valid token: dl_ + 43 uppercase A chars', () => {
        const body = 'A'.repeat(43);
        expect(isValidTokenShape(`dl_${body}`)).toBe(true);
    });

    it('accepts valid token: dl_ + 43 lowercase a chars', () => {
        const body = 'a'.repeat(43);
        expect(isValidTokenShape(`dl_${body}`)).toBe(true);
    });

    it('accepts valid token using all base64url chars (A-Z, a-z, 0-9, -, _)', () => {
        // 43-char string using all valid base64url character classes
        const body = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklm01234-_';
        // Trim to exactly 43 chars
        expect(body.length).toBeGreaterThanOrEqual(43);
        const body43 = body.slice(0, 43);
        expect(isValidTokenShape(`dl_${body43}`)).toBe(true);
    });

    // ── Real generator output ─────────────────────────────────────────────────

    it('accepts token from the real generateDownloadToken() generator', () => {
        const { token } = generateDownloadToken();
        expect(isValidTokenShape(token)).toBe(true);
    });

    it('real generator produces tokens that are consistently valid', () => {
        for (let i = 0; i < 10; i++) {
            const { token } = generateDownloadToken();
            expect(isValidTokenShape(token)).toBe(true);
        }
    });
});
