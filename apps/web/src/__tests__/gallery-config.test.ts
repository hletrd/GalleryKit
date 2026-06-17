/**
 * TEST-R5C2-09 / AGG-R5C2-17 — gallery-config resolver coverage.
 *
 * `getGalleryConfig` reads raw string rows from the `admin_settings` table and
 * resolves them into a typed `GalleryConfig`, applying per-key validation with
 * a default-fallback for any corrupted / out-of-range / unknown-shape value.
 * These tests pin that resolution contract:
 *
 *   - a valid DB override wins over the default (representative keys),
 *   - an invalid stored value falls back to the default,
 *   - AGG-C10-02: a stored 'production' semantic_search_mode is type-valid but the
 *     resolver HEALS it to 'disabled' by default (dark feature), and passes it
 *     through ONLY when SEMANTIC_SEARCH_ALLOW_PRODUCTION=true (operator opt-in),
 *   - numeric coercion: a string DB value resolves to a number,
 *   - boolean coercion: 'true' / 'false' strings resolve to booleans,
 *   - unknown keys present in the table are ignored (never widen the config).
 *
 * Mocking strategy mirrors the lib-module db-mock pattern used elsewhere in the
 * suite (e.g. admin-backfill-runner-detection-failure.test.ts): `@/db` is
 * replaced with a chainable `select().from().where()` thenable that resolves to
 * the rows under test. React's `cache()` is mocked to a pass-through identity so
 * each test re-reads the freshly-mocked rows instead of returning a memoized
 * result from a previous test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { selectMock } = vi.hoisted(() => ({
    selectMock: vi.fn(),
}));

// React cache() memoizes a zero-arg function across calls; pass-through it so
// every getGalleryConfig() invocation re-runs the resolver against the current
// mock rows.
vi.mock('react', async () => {
    const actual = await vi.importActual<typeof import('react')>('react');
    return {
        ...actual,
        cache: <T extends (...args: never[]) => unknown>(fn: T): T => fn,
    };
});

vi.mock('@/db', () => ({
    db: {
        select: selectMock,
    },
    adminSettings: { key: 'admin_settings.key', value: 'admin_settings.value' },
}));

import { getGalleryConfig } from '@/lib/gallery-config';
import { getSettingDefaults } from '@/lib/gallery-config-shared';

const DEFAULTS = getSettingDefaults();

/**
 * Point the db.select chain at a fixed set of admin_settings rows.
 * Shape matches `db.select({ key, value }).from(adminSettings).where(...)`.
 */
function mockSettingsRows(rows: Array<{ key: string; value: string }>): void {
    selectMock.mockReturnValue({
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(rows),
        }),
    });
}

describe('getGalleryConfig resolver (TEST-R5C2-09)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses defaults when admin_settings is empty', async () => {
        mockSettingsRows([]);
        const config = await getGalleryConfig();

        expect(config.semanticSearchMode).toBe(DEFAULTS.semantic_search_mode); // 'disabled'
        expect(config.avifEffort).toBe(Number(DEFAULTS.avif_effort)); // 6
        expect(config.stripGpsOnUpload).toBe(DEFAULTS.strip_gps_on_upload === 'true'); // false
    });

    it('DB override wins over default for a representative key', async () => {
        mockSettingsRows([
            { key: 'semantic_search_mode', value: 'stub' },
            { key: 'image_quality_jpeg', value: '72' },
        ]);
        const config = await getGalleryConfig();

        expect(config.semanticSearchMode).toBe('stub');
        expect(config.imageQualityJpeg).toBe(72);
    });

    it('HEALS a stored "production" semantic_search_mode to "disabled" by default (AGG-C10-02)', async () => {
        // CLIP 'production' is operator-gated: it is a type-valid stored value (the real
        // encoder is LIVE in the demo deployment), but without the operator env opt-in the
        // resolver heals it to 'disabled' so production is never activatable via the admin
        // UI. This keeps the Settings UI's documented invariant TRUE for deploys that have
        // not opted in.
        const prev = process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'];
        delete process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'];
        try {
            mockSettingsRows([{ key: 'semantic_search_mode', value: 'production' }]);
            const config = await getGalleryConfig();
            expect(config.semanticSearchMode).toBe('disabled');
        } finally {
            if (prev === undefined) delete process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'];
            else process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] = prev;
        }
    });

    it('passes "production" through ONLY when SEMANTIC_SEARCH_ALLOW_PRODUCTION=true (operator opt-in)', async () => {
        const prev = process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'];
        process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] = 'true';
        try {
            mockSettingsRows([{ key: 'semantic_search_mode', value: 'production' }]);
            const config = await getGalleryConfig();
            expect(config.semanticSearchMode).toBe('production');
        } finally {
            if (prev === undefined) delete process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'];
            else process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] = prev;
        }
    });

    it('falls back to default for an invalid stored value (out-of-range number)', async () => {
        mockSettingsRows([
            { key: 'avif_effort', value: '999' }, // valid range is 0-9
            { key: 'image_quality_webp', value: 'not-a-number' },
        ]);
        const config = await getGalleryConfig();

        expect(config.avifEffort).toBe(Number(DEFAULTS.avif_effort)); // 6
        expect(config.imageQualityWebp).toBe(Number(DEFAULTS.image_quality_webp)); // 90
    });

    it('coerces a numeric string DB value to a number', async () => {
        mockSettingsRows([{ key: 'avif_effort', value: '3' }]);
        const config = await getGalleryConfig();

        expect(config.avifEffort).toBe(3);
        expect(typeof config.avifEffort).toBe('number');
    });

    it('coerces "true" / "false" string DB values to booleans', async () => {
        mockSettingsRows([
            { key: 'strip_gps_on_upload', value: 'true' },
            { key: 'force_srgb_derivatives', value: 'false' },
            { key: 'auto_alt_text_enabled', value: 'true' },
        ]);
        const config = await getGalleryConfig();

        expect(config.stripGpsOnUpload).toBe(true);
        expect(config.forceSrgbDerivatives).toBe(false);
        expect(config.autoAltTextEnabled).toBe(true);
    });

    it('falls back to default boolean for a non-boolean stored value', async () => {
        mockSettingsRows([{ key: 'strip_gps_on_upload', value: 'yes' }]);
        const config = await getGalleryConfig();

        // 'yes' is not 'true'/'false'; the validator rejects it and the resolver
        // heals to the default ('false').
        expect(config.stripGpsOnUpload).toBe(DEFAULTS.strip_gps_on_upload === 'true');
    });

    it('ignores unknown keys present in the table', async () => {
        mockSettingsRows([
            { key: 'totally_unknown_key', value: 'whatever' },
            { key: 'semantic_search_mode', value: 'stub' },
        ]);
        const config = await getGalleryConfig();

        // The unknown key must not leak onto the typed config; the known key
        // still resolves normally.
        expect(config.semanticSearchMode).toBe('stub');
        expect(config as unknown as Record<string, unknown>).not.toHaveProperty('totally_unknown_key');
    });

    it('falls back to all defaults when the settings query throws', async () => {
        selectMock.mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockRejectedValue(new Error('DB down')),
            }),
        });
        const config = await getGalleryConfig();

        expect(config.semanticSearchMode).toBe(DEFAULTS.semantic_search_mode);
        expect(config.avifEffort).toBe(Number(DEFAULTS.avif_effort));
    });
});
