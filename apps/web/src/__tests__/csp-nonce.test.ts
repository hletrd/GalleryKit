/**
 * TEST3-05 / C3-19 (run-10 c3) — first direct coverage for getCspNonce.
 * It runs on effectively every public page render in production (root
 * layout + six public pages) and carries a security-relevant NODE_ENV
 * branch; the only prior reference was an import-boundary source check
 * that never exercised either branch.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';

const { headersMock } = vi.hoisted(() => ({
    headersMock: vi.fn(),
}));

vi.mock('next/headers', () => ({
    headers: headersMock,
}));

import { getCspNonce } from '@/lib/csp-nonce';

afterEach(() => {
    (process.env as Record<string, string>).NODE_ENV = 'test';
    headersMock.mockReset();
});

describe('getCspNonce', () => {
    it('returns undefined outside production without touching headers()', async () => {
        (process.env as Record<string, string>).NODE_ENV = 'development';
        await expect(getCspNonce()).resolves.toBeUndefined();
        expect(headersMock).not.toHaveBeenCalled();
    });

    it('returns the x-nonce response header value in production', async () => {
        (process.env as Record<string, string>).NODE_ENV = 'production';
        headersMock.mockResolvedValue(new Headers({ 'x-nonce': 'abc123nonce' }));
        await expect(getCspNonce()).resolves.toBe('abc123nonce');
    });

    it('returns undefined in production when the header is absent (never null)', async () => {
        (process.env as Record<string, string>).NODE_ENV = 'production';
        headersMock.mockResolvedValue(new Headers());
        await expect(getCspNonce()).resolves.toBeUndefined();
    });
});
