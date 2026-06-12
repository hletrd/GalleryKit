/**
 * TEST-R5C1-01 + TEST-R5C1-03
 * Unit tests for verifySessionToken (8 branches) and getSessionSecret (4 cases).
 *
 * DB is mocked following the admin-tokens.test.ts pattern (vi.doMock inside
 * each describe + vi.resetModules in afterEach so module isolation is clean).
 *
 * SESSION_SECRET is stubbed via vi.stubEnv so HMAC signatures are computable
 * in-test without touching a real database.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac, randomBytes } from 'crypto';

// ── helpers ──────────────────────────────────────────────────────────────────

const TEST_SECRET = 'a'.repeat(64); // 64-char hex-like string, satisfies >= 32 check

function makeToken(
    secret: string,
    options: {
        timestamp?: number;
        randomHex?: string;
        corruptSignature?: boolean;
        extraParts?: boolean;
        fewerParts?: boolean;
        shortSignature?: boolean;
    } = {}
): string {
    const ts = options.timestamp ?? Date.now();
    // AGG-R5C2-14: use unique 32-char hex per call so React cache() inside
    // session.ts cannot deduplicate identical token strings across tests.
    // randomBytes(16).toString('hex') produces exactly 32 lowercase hex chars
    // which satisfies the post-HMAC shape assertion /^[0-9a-f]{32}$/.
    const rand = options.randomHex ?? randomBytes(16).toString('hex');
    const data = `${ts}:${rand}`;
    let sig = createHmac('sha256', secret).update(data).digest('hex');
    if (options.corruptSignature) sig = sig.replace(/.$/, sig.endsWith('0') ? '1' : '0');
    if (options.shortSignature) sig = sig.slice(0, 32);
    if (options.extraParts) return `${data}:${sig}:extra`;
    if (options.fewerParts) return `${ts}:${sig}`; // only 2 parts
    return `${data}:${sig}`;
}

// ── verifySessionToken ────────────────────────────────────────────────────────

describe('verifySessionToken', () => {
    const mockQuerySessions = vi.fn();
    const mockDeleteSessions = vi.fn();

    beforeEach(() => {
        vi.stubEnv('SESSION_SECRET', TEST_SECRET);
        vi.doMock('@/db', () => ({
            db: {
                query: {
                    adminSettings: { findFirst: vi.fn() },
                    sessions: { findFirst: mockQuerySessions },
                },
                delete: vi.fn(() => ({
                    where: mockDeleteSessions,
                })),
            },
            adminSettings: {},
            sessions: {},
        }));
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
        vi.resetModules();
    });

    it('(1) wrong HMAC signature → null', async () => {
        const { verifySessionToken } = await import('@/lib/session');
        const token = makeToken(TEST_SECRET, { corruptSignature: true });
        const result = await verifySessionToken(token);
        expect(result).toBeNull();
        expect(mockQuerySessions).not.toHaveBeenCalled();
    });

    it('(2) token age > 24h → null', async () => {
        const { verifySessionToken } = await import('@/lib/session');
        const oldTs = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
        const token = makeToken(TEST_SECRET, { timestamp: oldTs });
        const result = await verifySessionToken(token);
        expect(result).toBeNull();
        expect(mockQuerySessions).not.toHaveBeenCalled();
    });

    it('(3) negative age (future timestamp / clock skew) → null', async () => {
        const { verifySessionToken } = await import('@/lib/session');
        const futureTs = Date.now() + (60 * 60 * 1000); // 1 hour in future
        const token = makeToken(TEST_SECRET, { timestamp: futureTs });
        const result = await verifySessionToken(token);
        expect(result).toBeNull();
        expect(mockQuerySessions).not.toHaveBeenCalled();
    });

    it('(4a) malformed: only 2 parts → null', async () => {
        const { verifySessionToken } = await import('@/lib/session');
        const token = makeToken(TEST_SECRET, { fewerParts: true });
        const result = await verifySessionToken(token);
        expect(result).toBeNull();
        expect(mockQuerySessions).not.toHaveBeenCalled();
    });

    it('(4b) malformed: 4 parts → null', async () => {
        const { verifySessionToken } = await import('@/lib/session');
        const token = makeToken(TEST_SECRET, { extraParts: true });
        const result = await verifySessionToken(token);
        expect(result).toBeNull();
        expect(mockQuerySessions).not.toHaveBeenCalled();
    });

    it('(4c) empty string → null', async () => {
        const { verifySessionToken } = await import('@/lib/session');
        const result = await verifySessionToken('');
        expect(result).toBeNull();
        expect(mockQuerySessions).not.toHaveBeenCalled();
    });

    it('(5) signature length mismatch → null without throwing', async () => {
        const { verifySessionToken } = await import('@/lib/session');
        const token = makeToken(TEST_SECRET, { shortSignature: true });
        // Must not throw; timingSafeEqual pre-check prevents throw on length mismatch
        await expect(verifySessionToken(token)).resolves.toBeNull();
        expect(mockQuerySessions).not.toHaveBeenCalled();
    });

    it('(6) valid signature but no DB row → null', async () => {
        mockQuerySessions.mockResolvedValue(undefined);
        const { verifySessionToken } = await import('@/lib/session');
        const token = makeToken(TEST_SECRET);
        const result = await verifySessionToken(token);
        expect(result).toBeNull();
        expect(mockQuerySessions).toHaveBeenCalled();
    });

    it('(7) expired DB row → row deleted + null', async () => {
        const expiredSession = {
            id: 'hash',
            userId: 1,
            expiresAt: new Date(Date.now() - 1000), // expired 1 second ago
        };
        mockQuerySessions.mockResolvedValue(expiredSession);
        mockDeleteSessions.mockResolvedValue(undefined);
        const { verifySessionToken } = await import('@/lib/session');
        const token = makeToken(TEST_SECRET);
        const result = await verifySessionToken(token);
        expect(result).toBeNull();
        expect(mockDeleteSessions).toHaveBeenCalled();
    });

    it('(8) valid fresh token → session object returned', async () => {
        const validSession = {
            id: 'somehash',
            userId: 7,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
        };
        mockQuerySessions.mockResolvedValue(validSession);
        const { verifySessionToken } = await import('@/lib/session');
        const token = makeToken(TEST_SECRET);
        const result = await verifySessionToken(token);
        expect(result).not.toBeNull();
        expect(result?.userId).toBe(7);
    });
});

// ── getSessionSecret ──────────────────────────────────────────────────────────

describe('getSessionSecret', () => {
    const mockDbFindFirst = vi.fn();
    const mockDbInsert = vi.fn();

    beforeEach(() => {
        // AGG-R5C2-14 (TEST-R5C2-03/-16): resetModules in beforeEach ensures
        // module-level singletons (cachedSessionSecret, sessionSecretPromise)
        // are cleared before every test — not just after the previous one.
        vi.resetModules();
        vi.doMock('@/db', () => ({
            db: {
                query: {
                    adminSettings: { findFirst: mockDbFindFirst },
                },
                insert: vi.fn(() => ({
                    ignore: vi.fn(() => ({
                        values: mockDbInsert,
                    })),
                })),
            },
            adminSettings: {},
            sessions: {},
        }));
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
        vi.resetModules();
    });

    it('(1) NODE_ENV=production + missing SESSION_SECRET → throws', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('SESSION_SECRET', '');
        const { getSessionSecret } = await import('@/lib/session');
        await expect(getSessionSecret()).rejects.toThrow(/SESSION_SECRET/);
        expect(mockDbFindFirst).not.toHaveBeenCalled();
    });

    it('(2) NODE_ENV=production + short (<32 char) secret → throws', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('SESSION_SECRET', 'tooshort');
        const { getSessionSecret } = await import('@/lib/session');
        await expect(getSessionSecret()).rejects.toThrow(/SESSION_SECRET/);
        expect(mockDbFindFirst).not.toHaveBeenCalled();
    });

    it('(3) production + valid 64-hex secret → returns it, no DB call', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('SESSION_SECRET', TEST_SECRET);
        const { getSessionSecret } = await import('@/lib/session');
        const secret = await getSessionSecret();
        expect(secret).toBe(TEST_SECRET);
        expect(mockDbFindFirst).not.toHaveBeenCalled();
    });

    it('(4) dev/test without env → falls through to mocked DB-stored secret', async () => {
        vi.stubEnv('NODE_ENV', 'test');
        vi.stubEnv('SESSION_SECRET', '');
        mockDbFindFirst.mockResolvedValue({ key: 'session_secret', value: 'db-stored-secret-value-32chars!!' });
        const { getSessionSecret } = await import('@/lib/session');
        const secret = await getSessionSecret();
        expect(secret).toBe('db-stored-secret-value-32chars!!');
        expect(mockDbFindFirst).toHaveBeenCalled();
    });
});
