/**
 * Cycle 24: foreground image queue concurrency is capped against the shared DB
 * pool reserve. Each image-processing job can hold one advisory-lock
 * connection across Sharp work and can need one transient DB connection while
 * that lock is still held, so the effective queue size must keep live request
 * headroom.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({
    connection: { getConnection: vi.fn() },
    db: { select: vi.fn(), update: vi.fn(), delete: vi.fn() },
    images: {},
    sessions: {},
    imageEmbeddings: {},
    POOL_CONNECTION_LIMIT: 10,
}));
vi.mock('p-queue', () => ({
    default: class MockPQueue {
        add = vi.fn();
        start = vi.fn();
    },
}));
vi.mock('sharp', () => {
    const sharpFn = vi.fn() as unknown as {
        (...a: unknown[]): unknown;
        concurrency: ReturnType<typeof vi.fn>;
        cache: ReturnType<typeof vi.fn>;
        versions: { heif?: string };
    };
    sharpFn.concurrency = vi.fn();
    sharpFn.cache = vi.fn();
    sharpFn.versions = { heif: '1.0.0' };
    return { default: sharpFn };
});

import { IMAGE_QUEUE_RESERVED_LIVE_CONNECTIONS, resolveImageQueueConcurrency } from '@/lib/image-queue';

describe('resolveImageQueueConcurrency', () => {
    it('clamps foreground queue requests to leave live DB headroom', () => {
        expect(resolveImageQueueConcurrency(8, 10)).toBe(2);
        expect(resolveImageQueueConcurrency(5, 10)).toBe(2);
        expect(resolveImageQueueConcurrency(100, 10)).toBe(2);
    });

    it('passes through requests below the pool-budget cap', () => {
        expect(resolveImageQueueConcurrency(1, 10)).toBe(1);
        expect(resolveImageQueueConcurrency(2, 10)).toBe(2);
    });

    it('never returns less than one and floors fractional values', () => {
        expect(resolveImageQueueConcurrency(0, 10)).toBe(1);
        expect(resolveImageQueueConcurrency(-4, 10)).toBe(1);
        expect(resolveImageQueueConcurrency(Number.NaN, 10)).toBe(1);
        expect(resolveImageQueueConcurrency(2.9, 10)).toBe(2);
    });

    it('keeps at least the reserved half-pool free at the cap', () => {
        const limit = 10;
        const cap = resolveImageQueueConcurrency(100, limit);
        const reserved = IMAGE_QUEUE_RESERVED_LIVE_CONNECTIONS(limit);

        expect(limit - cap * 2).toBeGreaterThanOrEqual(reserved);
    });
});

/**
 * DOC3-01 / C3-15 (run-10 c3): an operator raising QUEUE_CONCURRENCY on the
 * default pool silently got an effective concurrency of 2 with no signal —
 * unlike the admin backfill runner, which warns on clamp. The module now
 * logs a boot-time warning when the requested value is clamped down.
 */
describe('QUEUE_CONCURRENCY clamp warning (DOC3-01 / C3-15)', () => {
    it('warns at module load when the requested concurrency is clamped by the pool budget', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const prev = process.env.QUEUE_CONCURRENCY;
        process.env.QUEUE_CONCURRENCY = '8';
        vi.resetModules();
        try {
            await import('@/lib/image-queue');
            const clampWarning = warnSpy.mock.calls.find((call) =>
                String(call[0]).includes('clamped to'));
            expect(clampWarning).toBeTruthy();
            expect(String(clampWarning?.[0])).toContain('QUEUE_CONCURRENCY=8');
            expect(String(clampWarning?.[0])).toContain('clamped to 2');
        } finally {
            if (prev === undefined) delete process.env.QUEUE_CONCURRENCY;
            else process.env.QUEUE_CONCURRENCY = prev;
            vi.resetModules();
            warnSpy.mockRestore();
        }
    });

    it('does not warn when the requested concurrency fits the budget', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const prev = process.env.QUEUE_CONCURRENCY;
        process.env.QUEUE_CONCURRENCY = '2';
        vi.resetModules();
        try {
            await import('@/lib/image-queue');
            const clampWarning = warnSpy.mock.calls.find((call) =>
                String(call[0]).includes('clamped to'));
            expect(clampWarning).toBeFalsy();
        } finally {
            if (prev === undefined) delete process.env.QUEUE_CONCURRENCY;
            else process.env.QUEUE_CONCURRENCY = prev;
            vi.resetModules();
            warnSpy.mockRestore();
        }
    });
});
