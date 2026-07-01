import { describe, expect, it } from 'vitest';

import {
    SETTINGS_BACKFILL_WARNING_KEYS,
    hasBackfillRelevantDifference,
    resolveSavedBackfillPendingTransition,
} from '@/lib/settings-backfill-warning';
import {
    DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS,
    getSettingDefaults,
} from '@/lib/gallery-config-shared';

const defaults = getSettingDefaults();

describe('settings backfill warning key contract', () => {
    it('follows the byte-impacting settings list except locked image_sizes', () => {
        expect(SETTINGS_BACKFILL_WARNING_KEYS).toEqual(
            DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS.filter((key) => key !== 'image_sizes'),
        );
        expect(SETTINGS_BACKFILL_WARNING_KEYS).not.toContain('allow_hdr_ingest');
        expect(SETTINGS_BACKFILL_WARNING_KEYS).not.toContain('image_sizes');
    });

    it('treats blank stored values and explicit defaults as equivalent', () => {
        expect(hasBackfillRelevantDifference(
            { image_quality_jpeg: '90', force_srgb_derivatives: 'false' },
            { image_quality_jpeg: '', force_srgb_derivatives: '' },
            defaults,
        )).toBe(false);
    });

    it('detects byte-impacting changes and ignores upload-admission changes', () => {
        expect(hasBackfillRelevantDifference(
            { image_quality_jpeg: '95' },
            { image_quality_jpeg: '' },
            defaults,
        )).toBe(true);

        expect(hasBackfillRelevantDifference(
            { allow_hdr_ingest: 'true' },
            { allow_hdr_ingest: 'false' },
            defaults,
        )).toBe(false);
    });

    it('treats scalar settings with surrounding whitespace as unchanged', () => {
        expect(hasBackfillRelevantDifference(
            { image_quality_jpeg: ' 90 ', avif_effort: '6 ' },
            { image_quality_jpeg: '90', avif_effort: '6' },
            defaults,
        )).toBe(false);
    });
});

describe('resolveSavedBackfillPendingTransition', () => {
    it('keeps a saved settings-only obligation pending after a byte-impacting save', () => {
        const previousBaseline = { image_quality_jpeg: '90' };
        const nextSettings = { image_quality_jpeg: '95' };

        expect(resolveSavedBackfillPendingTransition({
            hasExistingImages: true,
            savedBackfillRelevantChange: true,
            previousBaseline,
            nextSettings,
            pendingBaseline: null,
            defaults,
        })).toEqual({
            hasSavedBackfillPending: true,
            pendingBaseline: previousBaseline,
        });
    });

    it('clears a saved obligation when settings return to the pending baseline', () => {
        const previousBaseline = { image_quality_jpeg: '90' };

        expect(resolveSavedBackfillPendingTransition({
            hasExistingImages: true,
            savedBackfillRelevantChange: true,
            previousBaseline,
            nextSettings: { image_quality_jpeg: '90' },
            pendingBaseline: previousBaseline,
            defaults,
        })).toEqual({
            hasSavedBackfillPending: false,
            pendingBaseline: null,
        });
    });

    it('does not create a saved obligation when there are no existing images', () => {
        const previousBaseline = { image_quality_jpeg: '90' };

        expect(resolveSavedBackfillPendingTransition({
            hasExistingImages: false,
            savedBackfillRelevantChange: true,
            previousBaseline,
            nextSettings: { image_quality_jpeg: '95' },
            pendingBaseline: null,
            defaults,
        })).toEqual({
            hasSavedBackfillPending: false,
            pendingBaseline: null,
        });
    });
});
