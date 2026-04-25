import { beforeEach, describe, expect, it, vi } from 'vitest';

import { validateSeoOgImageUrl } from '@/lib/seo-og-url';

describe('validateSeoOgImageUrl', () => {
    it('accepts relative OG image URLs', () => {
        expect(validateSeoOgImageUrl('/uploads/og.jpg', 'https://gallery.example.com')).toBe(true);
    });

    it('rejects scheme-relative OG image URLs', () => {
        expect(validateSeoOgImageUrl('//evil.example/og.jpg', 'https://gallery.example.com')).toBe(false);
    });

    it('rejects third-party OG image URLs when BASE_URL is absent and site-config fallback is used', () => {
        expect(validateSeoOgImageUrl('https://cdn.example.com/og.jpg', 'http://localhost:3000')).toBe(false);
    });

    it('accepts same-origin absolute OG image URLs', () => {
        expect(validateSeoOgImageUrl('https://gallery.example.com/og.jpg', 'https://gallery.example.com')).toBe(true);
    });
});

// C6L-SEC-01: action-level coverage that updateSeoSettings rejects
// Unicode bidi/invisible formatting characters in the four free-form
// SEO fields. Mirrors the topics-actions.test.ts / images-actions.test.ts
// pattern for the parallel rejection in topic.label / image.title /
// image.description (C5L-SEC-01).

const {
    selectMock,
    insertMock,
    deleteMock,
    transactionMock,
    isAdminMock,
    getCurrentUserMock,
    getTranslationsMock,
    revalidateAllAppDataMock,
    logAuditEventMock,
    maintenanceMessageMock,
} = vi.hoisted(() => ({
    selectMock: vi.fn(),
    insertMock: vi.fn(),
    deleteMock: vi.fn(),
    transactionMock: vi.fn(),
    isAdminMock: vi.fn(),
    getCurrentUserMock: vi.fn(),
    getTranslationsMock: vi.fn(),
    revalidateAllAppDataMock: vi.fn(),
    logAuditEventMock: vi.fn(),
    maintenanceMessageMock: vi.fn(),
}));

vi.mock('@/db', () => ({
    db: {
        select: selectMock,
        insert: insertMock,
        delete: deleteMock,
        transaction: transactionMock,
    },
    adminSettings: {
        key: 'admin_settings.key',
        value: 'admin_settings.value',
    },
}));

vi.mock('@/app/actions/auth', () => ({
    isAdmin: isAdminMock,
    getCurrentUser: getCurrentUserMock,
}));

vi.mock('next-intl/server', () => ({
    getTranslations: getTranslationsMock,
}));

vi.mock('@/lib/revalidation', () => ({
    revalidateAllAppData: revalidateAllAppDataMock,
}));

vi.mock('@/lib/audit', () => ({
    logAuditEvent: logAuditEventMock,
}));

vi.mock('@/lib/restore-maintenance', () => ({
    getRestoreMaintenanceMessage: maintenanceMessageMock,
}));

// C2R-02: mock the same-origin guard so the unit test doesn't require a
// live request scope. Production callers still enforce the check.
vi.mock('@/lib/action-guards', () => ({
    requireSameOriginAdmin: vi.fn(async () => null),
}));

import { updateSeoSettings } from '@/app/actions/seo';

describe('updateSeoSettings — Unicode-formatting rejection (C6L-SEC-01)', () => {
    beforeEach(() => {
        selectMock.mockReset();
        insertMock.mockReset();
        deleteMock.mockReset();
        transactionMock.mockReset();
        isAdminMock.mockResolvedValue(true);
        getCurrentUserMock.mockResolvedValue({ id: 1 });
        getTranslationsMock.mockResolvedValue((key: string) => key);
        revalidateAllAppDataMock.mockReset();
        logAuditEventMock.mockReset();
        logAuditEventMock.mockResolvedValue(undefined);
        maintenanceMessageMock.mockReturnValue(null);
    });

    it('rejects updateSeoSettings with seoTitleInvalid when seo_title contains a Unicode bidi override (RLO)', async () => {
        await expect(updateSeoSettings({ seo_title: 'MyGallery‮.gpj' })).resolves.toEqual({ error: 'seoTitleInvalid' });
        expect(transactionMock).not.toHaveBeenCalled();
    });

    it('rejects updateSeoSettings with seoDescriptionInvalid when seo_description contains a zero-width space', async () => {
        await expect(updateSeoSettings({ seo_description: 'A friendly​description' })).resolves.toEqual({ error: 'seoDescriptionInvalid' });
        expect(transactionMock).not.toHaveBeenCalled();
    });

    it('rejects updateSeoSettings with seoNavTitleInvalid when seo_nav_title contains a bidi isolate (LRI)', async () => {
        await expect(updateSeoSettings({ seo_nav_title: 'Nav⁦Title' })).resolves.toEqual({ error: 'seoNavTitleInvalid' });
        expect(transactionMock).not.toHaveBeenCalled();
    });

    it('rejects updateSeoSettings with seoAuthorInvalid when seo_author contains a zero-width non-joiner (ZWNJ)', async () => {
        await expect(updateSeoSettings({ seo_author: 'Alice‌Bob' })).resolves.toEqual({ error: 'seoAuthorInvalid' });
        expect(transactionMock).not.toHaveBeenCalled();
    });

    it('rejects updateSeoSettings when seo_title contains a BOM', async () => {
        await expect(updateSeoSettings({ seo_title: 'Hello﻿World' })).resolves.toEqual({ error: 'seoTitleInvalid' });
        expect(transactionMock).not.toHaveBeenCalled();
    });

    it('rejects updateSeoSettings when seo_description contains an LRM', async () => {
        await expect(updateSeoSettings({ seo_description: 'Words‎after' })).resolves.toEqual({ error: 'seoDescriptionInvalid' });
        expect(transactionMock).not.toHaveBeenCalled();
    });
});
