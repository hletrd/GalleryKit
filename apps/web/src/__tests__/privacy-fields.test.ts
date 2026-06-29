import { describe, it, expect } from 'vitest';
import { images } from '@/db/schema';
import { adminSelectFieldKeys, publicSelectFieldKeys } from '@/lib/data';
import { timelineSelectFieldKeys } from '@/lib/data-timeline';

const SENSITIVE_KEYS = [
    'latitude',
    'longitude',
    'filename_original',
    'user_filename',
    'processed',
    'original_format',
    'original_file_size',
    'color_pipeline_decision',
    'is_hdr',
    'transfer_function',
    'matrix_coefficients',
    // P4-A1 / R4-H1: Apple HDR gain map detection. Admin-only because the
    // gain map is not yet delivered (WI-09 dependency); surfacing
    // has_gain_map=true publicly would imply HDR delivery the SDR pipeline
    // can't fulfill.
    'has_gain_map',
    // R8-H3: bit_depth is technical metadata about photographer workflow.
    // Admin-only to respect the privacy boundary.
    'bit_depth',
    // WI-15: downscale flag is a processing detail, not public metadata.
    'was_downscaled',
    // R17-L2: raw admin user id that performed the upload is PII. Per-entry
    // Atom <author> uses a JOIN-derived display name in getImagesForFeed;
    // the raw column itself never reaches public queries.
    'uploaded_by',
    // R10-H2: processing diagnostics — admin-only retry surface.
    'processing_error',
    'failed_at',
    // C7-13: internal processing-settings snapshot for pending rows.
    'processing_settings_json',
    // R27-CP-HIGH-1: color_space is the EXIF ColorSpace tag value and
    // icc_profile_name is the ICC desc/mluc descriptor (often a custom
    // monitor calibration name); CLAUDE.md flags both as admin-only.
    'color_space',
    'icc_profile_name',
    // R27-CP-MED-2: encoder pipeline version is admin-only internal state.
    'pipeline_version',
] as const;

describe('Privacy field separation', () => {
    it('sensitive fields exist in the images schema', () => {
        for (const key of SENSITIVE_KEYS) {
            expect(images[key]).toBeDefined();
        }
    });

    it('admin select fields still contain the sensitive contract keys', () => {
        for (const key of SENSITIVE_KEYS) {
            expect(adminSelectFieldKeys).toContain(key);
        }
    });

    it('public select fields omit the sensitive contract keys', () => {
        for (const key of SENSITIVE_KEYS) {
            expect(publicSelectFieldKeys).not.toContain(key);
        }
    });

    it('public select fields still expose the intended safe keys', () => {
        expect(publicSelectFieldKeys).toContain('id');
        expect(publicSelectFieldKeys).toContain('title');
        expect(publicSelectFieldKeys).toContain('filename_jpeg');
    });

    /**
     * C6R-RPL-07 / AGG6R-07 — whitelist guard: the set difference between
     * the admin field set and the public field set must equal exactly the
     * SENSITIVE_KEYS contract. If a future schema migration adds a new
     * field to `adminSelectFields` without either (a) also adding it to
     * `publicSelectFields` or (b) adding it to SENSITIVE_KEYS, this test
     * will fail loudly — forcing the developer to make an explicit
     * decision about the new field's privacy disposition.
     *
     * The existing `_privacyGuard` at `data.ts:198-200` catches the case
     * where a KNOWN sensitive key leaks into `publicSelectFields`, but
     * does NOT catch a new unknown sensitive field. This test closes the
     * gap symmetrically.
     */
    it('admin-only keys form exactly the SENSITIVE_KEYS contract (symmetric privacy guard)', () => {
        const publicKeySet = new Set<string>(publicSelectFieldKeys);
        const adminOnlyKeys = [...adminSelectFieldKeys]
            .filter((key) => !publicKeySet.has(key))
            .sort();
        const sensitiveSorted = [...SENSITIVE_KEYS].sort();
        expect(adminOnlyKeys).toEqual(sensitiveSorted);
    });

    /**
     * R4C9 TEST-R4C9-04: lib/data-timeline.ts hand-mirrors the public
     * select shape for the timeline / year-in-review / OnThisDay PUBLIC
     * pages. The mirror had silently drifted — color_space and bit_depth
     * (admin-only since R27-CP-HIGH-1 / R8-H3) were still being selected
     * on public requests. These pins make any future drift a test
     * failure; data-timeline.ts additionally carries the same
     * compile-time Extract guard as data.ts.
     */
    it('timeline select fields omit every sensitive contract key (TEST-R4C9-04)', () => {
        for (const key of SENSITIVE_KEYS) {
            expect(timelineSelectFieldKeys).not.toContain(key);
        }
    });

    it('timeline select fields are a subset of the public select fields', () => {
        const publicKeySet = new Set<string>(publicSelectFieldKeys);
        for (const key of timelineSelectFieldKeys) {
            // tag_names is aggregated separately in both modules; every
            // selected COLUMN must be public-approved.
            expect(publicKeySet.has(key)).toBe(true);
        }
    });

    it('timeline select fields still expose the intended safe keys', () => {
        expect(timelineSelectFieldKeys).toContain('id');
        expect(timelineSelectFieldKeys).toContain('filename_jpeg');
        expect(timelineSelectFieldKeys).toContain('capture_date');
        expect(timelineSelectFieldKeys).toContain('title');
    });
});
