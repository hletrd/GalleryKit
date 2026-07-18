import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { images } from '@/db/schema';
import { adminSelectFieldKeys, publicSelectFieldKeys } from '@/lib/data';
import { timelineSelectFieldKeys } from '@/lib/data-timeline';
import { searchEnrichmentSelectFields } from '@/lib/search-enrichment-fields';

const dataSource = readFileSync(resolve(__dirname, '../lib/data.ts'), 'utf8');
const timelineSource = readFileSync(resolve(__dirname, '../lib/data-timeline.ts'), 'utf8');
const searchEnrichmentSource = readFileSync(resolve(__dirname, '../lib/search-enrichment-fields.ts'), 'utf8');

function sourceBetween(source: string, startNeedle: string, endNeedle: string): string {
    const start = source.indexOf(startNeedle);
    const end = source.indexOf(endNeedle, start + startNeedle.length);
    expect(start, `${startNeedle} should exist`).toBeGreaterThanOrEqual(0);
    expect(end, `${endNeedle} should exist after ${startNeedle}`).toBeGreaterThan(start);
    return source.slice(start, end);
}

// C6-13 (run-10 cycle-6): the leak-scan below is a `SENSITIVE_KEYS.filter(...)`
// that returns [] (a PASS) when the extracted block contains no sensitive alias.
// That is vacuously true if a marker rename/reorder/reformat drift makes
// `sourceBetween` capture the wrong (or an empty) region. Assert the extraction
// actually captured a select block — non-empty AND referencing ≥1 expected
// public `images.<col>` — so drift fails loudly instead of passing silently.
// NOTE: the leak regex assumes the schema table is imported as the literal
// identifier `images` (e.g. `images.latitude`); a differently-aliased import
// would need this sentinel + the regex updated in lockstep.
function assertSelectBlockCaptured(block: string, label: string) {
    expect(block.length, `${label}: extracted select block must be non-empty`).toBeGreaterThan(0);
    const capturesPublicColumn = PUBLIC_SAFE_KEYS.some((key) =>
        new RegExp(`\\bimages\\.${key}\\b`).test(block),
    );
    expect(
        capturesPublicColumn,
        `${label}: extraction must reference at least one expected public images.* column — otherwise a marker drift silently passes the leak scan`,
    ).toBe(true);
}

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
    // R17-L2: raw admin user id that performed the upload is PII. Atom uses
    // the configured feed-level author; the raw column itself never reaches
    // public queries.
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

const PUBLIC_SAFE_KEYS = [
    'alt_text_suggested',
    'avif_10bit',
    'camera_model',
    'capture_date',
    'color_primaries',
    'created_at',
    'derivative_max_width',
    'description',
    'exposure_compensation',
    'exposure_program',
    'exposure_time',
    'f_number',
    'filename_avif',
    'filename_jpeg',
    'filename_webp',
    'flash',
    'focal_length',
    'height',
    'id',
    'iso',
    'lens_model',
    'metering_mode',
    'original_height',
    'original_width',
    'title',
    'topic',
    'updated_at',
    'white_balance',
    'width',
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

    it('public select fields match the explicit safe allowlist', () => {
        expect(publicSelectFieldKeys).toEqual([...PUBLIC_SAFE_KEYS].sort());
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
     * The existing `_privacyGuard` in `apps/web/src/lib/data.ts` catches the case
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

    it('search enrichment fields omit every sensitive contract key', () => {
        const enrichmentKeys = Object.keys(searchEnrichmentSelectFields);
        for (const key of SENSITIVE_KEYS) {
            expect(enrichmentKeys).not.toContain(key);
        }
    });

    it('public projection blocks do not alias safe keys to sensitive image columns', () => {
        const publicSelectDerivation = sourceBetween(
            dataSource,
            'const {\n    latitude: _omitLatitude',
            'const publicSelectFields = {',
        );
        for (const key of SENSITIVE_KEYS) {
            expect(publicSelectDerivation, `${key} must be explicitly omitted before publicSelectFields rest-spread`).toContain(`${key}: _omit`);
        }

        const searchFieldsSource = sourceBetween(
            dataSource,
            'const searchFields = {',
            'type _SearchSensitive',
        );
        assertSelectBlockCaptured(searchFieldsSource, 'searchFields');
        const leaked = SENSITIVE_KEYS.filter((key) =>
            new RegExp(`\\b[A-Za-z0-9_]+\\s*:\\s*images\\.${key}\\b`).test(searchFieldsSource),
        );
        expect(
            leaked,
            `Public searchFields must not alias safe keys to sensitive images.* columns: ${leaked.join(', ')}`,
        ).toEqual([]);
    });

    it('standalone public select modules do not alias sensitive image columns', () => {
        const publicSelectBlocks = [
            {
                label: 'timelineSelectFields',
                source: sourceBetween(
                    timelineSource,
                    'const timelineSelectFields = {',
                    '} as const;',
                ),
            },
            {
                label: 'searchEnrichmentSelectFields',
                source: sourceBetween(
                    searchEnrichmentSource,
                    'export const searchEnrichmentSelectFields = {',
                    '};',
                ),
            },
        ];

        for (const { label, source } of publicSelectBlocks) {
            assertSelectBlockCaptured(source, label);
            const leaked = SENSITIVE_KEYS.filter((key) =>
                new RegExp(`\\b[A-Za-z0-9_]+\\s*:\\s*images\\.${key}\\b`).test(source),
            );
            expect(
                leaked,
                `${label} must not alias public keys to sensitive images.* columns: ${leaked.join(', ')}`,
            ).toEqual([]);
        }
    });
});
