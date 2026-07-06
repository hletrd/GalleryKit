/**
 * TEST3-01 / C3-11 (run-10 c3) — restore-maintenance skip branch in the
 * status-bearing 404 layouts.
 *
 * The three layouts added by the real-404 fix (911cb0f5) gate their
 * existence check behind `isRestoreMaintenanceActive()`: during a restore
 * window the DB is not authoritative, so the check is skipped and the page
 * renders its maintenance panel at 200 (matching every public page). Nothing
 * exercised that branch — a flipped guard would either 404 the whole public
 * surface during every restore window or silently revert to the soft-404
 * bug. This drives each layout component directly (the
 * photo-og-metadata.test.ts mock pattern) across the 2x2 matrix:
 * maintenance {active, inactive} x entity {missing, present}.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { getTopicMock, getImageMock, getCollectionMock, maintenanceMock } = vi.hoisted(() => ({
    getTopicMock: vi.fn(),
    getImageMock: vi.fn(),
    getCollectionMock: vi.fn(),
    maintenanceMock: vi.fn(),
}));

vi.mock('@/lib/data', () => ({
    getTopicBySlugCached: getTopicMock,
    getImageCached: getImageMock,
    getSmartCollectionBySlugCached: getCollectionMock,
}));

vi.mock('@/lib/restore-maintenance', () => ({
    isRestoreMaintenanceActive: maintenanceMock,
}));

import TopicLayout from '@/app/[locale]/(public)/[topic]/layout';
import PhotoLayout from '@/app/[locale]/(public)/p/[id]/layout';
import SmartCollectionLayout from '@/app/[locale]/(public)/c/[slug]/layout';

function isNotFoundError(err: unknown): boolean {
    const digest = (err as { digest?: string } | null)?.digest;
    return typeof digest === 'string'
        && (digest.startsWith('NEXT_HTTP_ERROR_FALLBACK;404') || digest === 'NEXT_NOT_FOUND');
}

const children = 'children-sentinel' as unknown as React.ReactNode;

beforeEach(() => {
    getTopicMock.mockReset();
    getImageMock.mockReset();
    getCollectionMock.mockReset();
    maintenanceMock.mockReset();
});

describe('[topic]/layout.tsx restore-maintenance matrix', () => {
    it('missing topic + maintenance INACTIVE → notFound() throws', async () => {
        maintenanceMock.mockReturnValue(false);
        getTopicMock.mockResolvedValue(null);
        await expect(
            TopicLayout({ children, params: Promise.resolve({ topic: 'ghost' }) }),
        ).rejects.toSatisfy(isNotFoundError);
    });

    it('missing topic + maintenance ACTIVE → renders children (skip check, DB not authoritative)', async () => {
        maintenanceMock.mockReturnValue(true);
        getTopicMock.mockResolvedValue(null);
        await expect(
            TopicLayout({ children, params: Promise.resolve({ topic: 'ghost' }) }),
        ).resolves.toBe(children);
        // The lookup must not even run — the DB is not authoritative.
        expect(getTopicMock).not.toHaveBeenCalled();
    });

    it('present topic + maintenance INACTIVE → renders children', async () => {
        maintenanceMock.mockReturnValue(false);
        getTopicMock.mockResolvedValue({ topic: 'real', label: 'Real' });
        await expect(
            TopicLayout({ children, params: Promise.resolve({ topic: 'real' }) }),
        ).resolves.toBe(children);
    });

    it('present topic + maintenance ACTIVE → renders children without a lookup', async () => {
        maintenanceMock.mockReturnValue(true);
        await expect(
            TopicLayout({ children, params: Promise.resolve({ topic: 'real' }) }),
        ).resolves.toBe(children);
        expect(getTopicMock).not.toHaveBeenCalled();
    });
});

describe('p/[id]/layout.tsx restore-maintenance matrix', () => {
    it('missing image + maintenance INACTIVE → notFound() throws', async () => {
        maintenanceMock.mockReturnValue(false);
        getImageMock.mockResolvedValue(null);
        await expect(
            PhotoLayout({ children, params: Promise.resolve({ id: '12345' }) }),
        ).rejects.toSatisfy(isNotFoundError);
    });

    it('malformed id + maintenance INACTIVE → notFound() throws before any lookup', async () => {
        maintenanceMock.mockReturnValue(false);
        await expect(
            PhotoLayout({ children, params: Promise.resolve({ id: 'not-a-number' }) }),
        ).rejects.toSatisfy(isNotFoundError);
        expect(getImageMock).not.toHaveBeenCalled();
    });

    it('missing image + maintenance ACTIVE → renders children (skip check)', async () => {
        maintenanceMock.mockReturnValue(true);
        await expect(
            PhotoLayout({ children, params: Promise.resolve({ id: '12345' }) }),
        ).resolves.toBe(children);
        expect(getImageMock).not.toHaveBeenCalled();
    });

    it('present image + maintenance INACTIVE → renders children', async () => {
        maintenanceMock.mockReturnValue(false);
        getImageMock.mockResolvedValue({ id: 12345 });
        await expect(
            PhotoLayout({ children, params: Promise.resolve({ id: '12345' }) }),
        ).resolves.toBe(children);
    });
});

describe('c/[slug]/layout.tsx restore-maintenance matrix', () => {
    it('missing collection + maintenance INACTIVE → notFound() throws', async () => {
        maintenanceMock.mockReturnValue(false);
        getCollectionMock.mockResolvedValue(null);
        await expect(
            SmartCollectionLayout({ children, params: Promise.resolve({ slug: 'ghost' }) }),
        ).rejects.toSatisfy(isNotFoundError);
    });

    it('PRIVATE collection + maintenance INACTIVE → notFound() throws (no existence leak)', async () => {
        maintenanceMock.mockReturnValue(false);
        getCollectionMock.mockResolvedValue({ slug: 'secret', is_public: false });
        await expect(
            SmartCollectionLayout({ children, params: Promise.resolve({ slug: 'secret' }) }),
        ).rejects.toSatisfy(isNotFoundError);
    });

    it('missing collection + maintenance ACTIVE → renders children (skip check)', async () => {
        maintenanceMock.mockReturnValue(true);
        await expect(
            SmartCollectionLayout({ children, params: Promise.resolve({ slug: 'ghost' }) }),
        ).resolves.toBe(children);
        expect(getCollectionMock).not.toHaveBeenCalled();
    });

    it('public collection + maintenance INACTIVE → renders children', async () => {
        maintenanceMock.mockReturnValue(false);
        getCollectionMock.mockResolvedValue({ slug: 'open', is_public: true });
        await expect(
            SmartCollectionLayout({ children, params: Promise.resolve({ slug: 'open' }) }),
        ).resolves.toBe(children);
    });
});
