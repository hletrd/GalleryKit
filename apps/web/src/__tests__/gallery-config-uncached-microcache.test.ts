/**
 * PERF3-01 / C3-16 (run-10 c3) — getGalleryConfigDetached TTL micro-cache.
 *
 * The image queue's per-image side-effect gate calls the uncached accessor
 * once per processed image (a 17-row admin_settings SELECT each). The
 * accessor now carries a tiny module-level TTL cache (2 s) with in-flight
 * dedupe so a bootstrap storm collapses to ~one query per interval while a
 * settings flip is still observed within the skew window (the detached-
 * context freshness contract from C2-10). These tests pin: cache hit within
 * TTL, refetch after TTL, and concurrent-call dedupe.
 *
 * Mocking mirrors gallery-config.test.ts: @/db select chain thenable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { selectMock } = vi.hoisted(() => ({
    selectMock: vi.fn(),
}));

vi.mock('@/db', () => ({
    db: {
        select: selectMock,
    },
    adminSettings: { key: 'admin_settings.key', value: 'admin_settings.value' },
}));

import {
    DETACHED_CONFIG_TTL_MS,
    getGalleryConfigDetached,
    getGalleryConfigUncached,
    invalidateDetachedGalleryConfigCache,
} from '@/lib/gallery-config';

function mockSettingsRows(rows: Array<{ key: string; value: string }>): void {
    selectMock.mockReturnValue({
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(rows),
        }),
    });
}

describe('getGalleryConfigDetached micro-cache (C3-16)', () => {
    beforeEach(() => {
        selectMock.mockReset();
        invalidateDetachedGalleryConfigCache();
        vi.useRealTimers();
    });

    it('serves a second call within the TTL from the cache (one DB read)', async () => {
        mockSettingsRows([{ key: 'image_quality_webp', value: '77' }]);
        const first = await getGalleryConfigDetached();
        const second = await getGalleryConfigDetached();
        expect(first.imageQualityWebp).toBe(77);
        expect(second.imageQualityWebp).toBe(77);
        expect(selectMock).toHaveBeenCalledTimes(1);
    });

    it('re-reads the DB after the TTL expires (settings flip observed within skew)', async () => {
        vi.useFakeTimers();
        try {
            mockSettingsRows([{ key: 'image_quality_webp', value: '77' }]);
            await getGalleryConfigDetached();
            expect(selectMock).toHaveBeenCalledTimes(1);

            mockSettingsRows([{ key: 'image_quality_webp', value: '88' }]);
            vi.advanceTimersByTime(2_100);
            const refreshed = await getGalleryConfigDetached();
            expect(selectMock).toHaveBeenCalledTimes(2);
            expect(refreshed.imageQualityWebp).toBe(88);
        } finally {
            vi.useRealTimers();
        }
    });

    it('dedupes concurrent calls onto one in-flight DB read', async () => {
        let resolveRows!: (rows: Array<{ key: string; value: string }>) => void;
        const pending = new Promise<Array<{ key: string; value: string }>>((resolve) => {
            resolveRows = resolve;
        });
        selectMock.mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue(pending),
            }),
        });

        const a = getGalleryConfigDetached();
        const b = getGalleryConfigDetached();
        resolveRows([{ key: 'image_quality_webp', value: '66' }]);
        const [ra, rb] = await Promise.all([a, b]);
        expect(ra.imageQualityWebp).toBe(66);
        expect(rb.imageQualityWebp).toBe(66);
        expect(selectMock).toHaveBeenCalledTimes(1);
    });

    it('caches the fallback config for the TTL on a failed read, then observes recovery (TEST4-02 real contract)', async () => {
        // C4-07/TEST4-02: _getGalleryConfig catches internally and RESOLVES
        // with defaults — it never rejects — so a DB blip pins the fallback
        // for up to one TTL window by design. This test pins that contract
        // directly (the previous version masked it with a manual reset).
        vi.useFakeTimers();
        try {
            selectMock.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockRejectedValue(new Error('db down')),
                }),
            });
            const fallback = await getGalleryConfigDetached();
            expect(fallback.imageQualityWebp).toBeTypeOf('number');
            expect(selectMock).toHaveBeenCalledTimes(1);

            // DB recovers, but within the TTL the cached FALLBACK is served —
            // no second DB read.
            mockSettingsRows([{ key: 'image_quality_webp', value: '91' }]);
            const stillFallback = await getGalleryConfigDetached();
            expect(selectMock).toHaveBeenCalledTimes(1);
            expect(stillFallback.imageQualityWebp).toBe(fallback.imageQualityWebp);

            // After the TTL, the recovered value is observed.
            vi.advanceTimersByTime(DETACHED_CONFIG_TTL_MS + 100);
            const recovered = await getGalleryConfigDetached();
            expect(selectMock).toHaveBeenCalledTimes(2);
            expect(recovered.imageQualityWebp).toBe(91);
        } finally {
            vi.useRealTimers();
        }
    });

    it('invalidateDetachedGalleryConfigCache makes the next call re-read immediately (settings-write invalidation, PERF4-08)', async () => {
        mockSettingsRows([{ key: 'image_quality_webp', value: '77' }]);
        await getGalleryConfigDetached();
        expect(selectMock).toHaveBeenCalledTimes(1);

        // A settings mutation calls this after commit — the very next
        // detached read must observe the new value with no TTL wait.
        mockSettingsRows([{ key: 'image_quality_webp', value: '95' }]);
        invalidateDetachedGalleryConfigCache();
        const fresh = await getGalleryConfigDetached();
        expect(selectMock).toHaveBeenCalledTimes(2);
        expect(fresh.imageQualityWebp).toBe(95);
    });

    it('bounds the TTL at 2s and keeps the deprecated alias pointing at the same accessor (CRIT4-01)', () => {
        // The safety argument for the micro-cache ("far below any human
        // flip-setting-then-act latency") was previously protected by
        // NOTHING — a future bump to 60s/5min would silently defeat the
        // C3-04 detached-freshness fix. Bound it here.
        expect(DETACHED_CONFIG_TTL_MS).toBeLessThanOrEqual(2_000);
        expect(getGalleryConfigUncached).toBe(getGalleryConfigDetached);
    });
});
