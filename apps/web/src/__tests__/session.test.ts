import { describe, it, expect } from 'vitest';
import { hashSessionToken } from '@/lib/session';

describe('hashSessionToken', () => {
    it('produces a 64-char hex string (SHA-256)', () => {
        const result = hashSessionToken('test-token');
        expect(result).toHaveLength(64);
        expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic (same input gives same output)', () => {
        const a = hashSessionToken('my-session-token');
        const b = hashSessionToken('my-session-token');
        expect(a).toBe(b);
    });

    it('produces different hashes for different tokens', () => {
        const a = hashSessionToken('token-a');
        const b = hashSessionToken('token-b');
        expect(a).not.toBe(b);
    });
});

describe('generateSessionToken format', () => {
    it('produces timestamp:random:signature format', async () => {
        // Import dynamically so we can provide a secret override
        // without needing a DB connection for getSessionSecret
        const { generateSessionToken } = await import('@/lib/session');
        const token = await generateSessionToken('test-secret-key-for-unit-tests');
        const parts = token.split(':');
        expect(parts).toHaveLength(3);

        // timestamp is numeric
        const ts = parseInt(parts[0], 10);
        expect(Number.isFinite(ts)).toBe(true);
        expect(ts).toBeGreaterThan(0);

        // random is 32-char hex (16 bytes)
        expect(parts[1]).toMatch(/^[0-9a-f]{32}$/);

        // signature is 64-char hex (HMAC-SHA256)
        expect(parts[2]).toMatch(/^[0-9a-f]{64}$/);
    });
});
