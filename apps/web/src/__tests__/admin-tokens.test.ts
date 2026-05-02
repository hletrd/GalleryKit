/**
 * US-P53 — unit tests for admin-tokens lib.
 * Covers: generateToken format, hashToken determinism, tokenHashesEqual
 * constant-time comparison, isWellFormedToken, normalizeScopes,
 * tokenHasScope, and verifyToken (mocked DB).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    generateToken,
    hashToken,
    tokenHashesEqual,
    isWellFormedToken,
    normalizeScopes,
    tokenHasScope,
    TOKEN_PREFIX,
    TOKEN_PLAINTEXT_LENGTH,
    type AdminTokenScope,
} from '@/lib/admin-tokens';

// ── generateToken ────────────────────────────────────────────────────────────

describe('generateToken', () => {
    it('produces a plaintext with the gk_ prefix', () => {
        const { plaintext } = generateToken();
        expect(plaintext.startsWith(TOKEN_PREFIX)).toBe(true);
    });

    it('produces a plaintext of the expected total length', () => {
        const { plaintext } = generateToken();
        expect(plaintext.length).toBe(TOKEN_PLAINTEXT_LENGTH);
    });

    it('produces a valid base64url body', () => {
        const { plaintext } = generateToken();
        const body = plaintext.slice(TOKEN_PREFIX.length);
        expect(/^[A-Za-z0-9_-]+$/.test(body)).toBe(true);
    });

    it('produces a 64-char hex hash', () => {
        const { hash } = generateToken();
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces different tokens on each call', () => {
        const a = generateToken();
        const b = generateToken();
        expect(a.plaintext).not.toBe(b.plaintext);
        expect(a.hash).not.toBe(b.hash);
    });

    it('hash matches hashToken(plaintext)', () => {
        const { plaintext, hash } = generateToken();
        expect(hash).toBe(hashToken(plaintext));
    });
});

// ── hashToken ────────────────────────────────────────────────────────────────

describe('hashToken', () => {
    it('returns a deterministic 64-char hex string', () => {
        const h1 = hashToken('gk_abc');
        const h2 = hashToken('gk_abc');
        expect(h1).toBe(h2);
        expect(h1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces different hashes for different inputs', () => {
        expect(hashToken('gk_aaa')).not.toBe(hashToken('gk_bbb'));
    });
});

// ── tokenHashesEqual ─────────────────────────────────────────────────────────

describe('tokenHashesEqual', () => {
    it('returns true for equal hashes', () => {
        const h = hashToken('gk_test');
        expect(tokenHashesEqual(h, h)).toBe(true);
    });

    it('returns false for different hashes', () => {
        const h1 = hashToken('gk_aaa');
        const h2 = hashToken('gk_bbb');
        expect(tokenHashesEqual(h1, h2)).toBe(false);
    });

    it('returns false when lengths differ', () => {
        const h = hashToken('gk_test');
        expect(tokenHashesEqual(h, h.slice(0, 32))).toBe(false);
    });

    it('returns false for non-hex input', () => {
        const h = hashToken('gk_test');
        const notHex = 'z'.repeat(h.length);
        expect(tokenHashesEqual(h, notHex)).toBe(false);
    });
});

// ── isWellFormedToken ────────────────────────────────────────────────────────

describe('isWellFormedToken', () => {
    it('accepts a freshly generated token', () => {
        const { plaintext } = generateToken();
        expect(isWellFormedToken(plaintext)).toBe(true);
    });

    it('rejects wrong prefix', () => {
        const { plaintext } = generateToken();
        expect(isWellFormedToken('bad_' + plaintext.slice(TOKEN_PREFIX.length))).toBe(false);
    });

    it('rejects wrong length', () => {
        const { plaintext } = generateToken();
        expect(isWellFormedToken(plaintext + 'x')).toBe(false);
        expect(isWellFormedToken(plaintext.slice(0, -1))).toBe(false);
    });

    it('rejects non-base64url body chars', () => {
        const body = '='.repeat(43);
        expect(isWellFormedToken(TOKEN_PREFIX + body)).toBe(false);
    });

    it('rejects empty string', () => {
        expect(isWellFormedToken('')).toBe(false);
    });
});

// ── normalizeScopes ──────────────────────────────────────────────────────────

describe('normalizeScopes', () => {
    it('accepts valid scopes', () => {
        expect(normalizeScopes(['lr:upload', 'lr:delete'])).toEqual(['lr:upload', 'lr:delete']);
    });

    it('filters out unknown scopes', () => {
        expect(normalizeScopes(['lr:upload', 'admin:everything'])).toEqual(['lr:upload']);
    });

    it('de-duplicates scopes', () => {
        expect(normalizeScopes(['lr:upload', 'lr:upload'])).toEqual(['lr:upload']);
    });

    it('returns [] for non-array input', () => {
        expect(normalizeScopes('lr:upload')).toEqual([]);
        expect(normalizeScopes(null)).toEqual([]);
        expect(normalizeScopes(undefined)).toEqual([]);
    });

    it('returns [] for empty array', () => {
        expect(normalizeScopes([])).toEqual([]);
    });
});

// ── tokenHasScope ────────────────────────────────────────────────────────────

describe('tokenHasScope', () => {
    const scopes: AdminTokenScope[] = ['lr:upload', 'lr:read'];

    it('returns true when scope is present', () => {
        expect(tokenHasScope(scopes, 'lr:upload')).toBe(true);
        expect(tokenHasScope(scopes, 'lr:read')).toBe(true);
    });

    it('returns false when scope is absent', () => {
        expect(tokenHasScope(scopes, 'lr:delete')).toBe(false);
    });

    it('returns false for empty scopes array', () => {
        expect(tokenHasScope([], 'lr:upload')).toBe(false);
    });
});

// ── verifyToken (mocked DB) ──────────────────────────────────────────────────

describe('verifyToken', () => {
    // We mock the @/db module to control DB responses.
    const mockExecute = vi.fn();

    beforeEach(() => {
        vi.doMock('@/db', () => ({
            db: { execute: mockExecute },
        }));
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it('returns null for malformed token (no DB call)', async () => {
        const { verifyToken: vt } = await import('@/lib/admin-tokens');
        const result = await vt('bad_token_value');
        expect(result).toBeNull();
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it('returns null when DB throws (table missing)', async () => {
        mockExecute.mockRejectedValue(new Error('Table does not exist'));
        const { verifyToken: vt } = await import('@/lib/admin-tokens');
        const { plaintext } = generateToken();
        const result = await vt(plaintext);
        expect(result).toBeNull();
    });

    it('returns null when no rows returned', async () => {
        mockExecute.mockResolvedValue([[], []]);
        const { verifyToken: vt } = await import('@/lib/admin-tokens');
        const { plaintext } = generateToken();
        const result = await vt(plaintext);
        expect(result).toBeNull();
    });

    it('returns null when token is expired', async () => {
        const { plaintext, hash } = generateToken();
        const expiredDate = new Date(Date.now() - 1000);
        mockExecute.mockResolvedValue([[{
            id: 1,
            user_id: 42,
            label: 'test',
            token_hash: hash,
            scopes: JSON.stringify(['lr:upload']),
            created_at: new Date(),
            last_used_at: null,
            expires_at: expiredDate,
        }], []]);
        const { verifyToken: vt } = await import('@/lib/admin-tokens');
        const result = await vt(plaintext);
        expect(result).toBeNull();
    });

    it('returns VerifiedToken for valid non-expired token', async () => {
        const { plaintext, hash } = generateToken();
        mockExecute.mockResolvedValue([[{
            id: 7,
            user_id: 42,
            label: 'my LR token',
            token_hash: hash,
            scopes: JSON.stringify(['lr:upload', 'lr:read']),
            created_at: new Date(),
            last_used_at: null,
            expires_at: null,
        }], []]);
        const { verifyToken: vt } = await import('@/lib/admin-tokens');
        const result = await vt(plaintext);
        expect(result).not.toBeNull();
        expect(result?.id).toBe(7);
        expect(result?.userId).toBe(42);
        expect(result?.scopes).toContain('lr:upload');
        expect(result?.scopes).toContain('lr:read');
    });

    it('scope enforcement: upload route requires lr:upload', async () => {
        // token with only lr:read should NOT satisfy lr:upload requirement
        const { plaintext, hash } = generateToken();
        mockExecute.mockResolvedValue([[{
            id: 8,
            user_id: 42,
            label: 'read-only',
            token_hash: hash,
            scopes: JSON.stringify(['lr:read']),
            created_at: new Date(),
            last_used_at: null,
            expires_at: null,
        }], []]);
        const { verifyToken: vt } = await import('@/lib/admin-tokens');
        const verified = await vt(plaintext);
        expect(verified).not.toBeNull();
        // Scope check (as withAdminAuth does it)
        const { tokenHasScope: ths } = await import('@/lib/admin-tokens');
        expect(ths(verified!.scopes, 'lr:upload')).toBe(false);
        expect(ths(verified!.scopes, 'lr:read')).toBe(true);
    });
});
