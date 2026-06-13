/**
 * Run-6 Cycle 1 AGG-1 / AGG-6 — backfill fatal-error counter honesty.
 *
 * Contract under test (the regression the prior AGG-R5C3-04 honesty fix
 * re-introduced): when a candidate row's version-bump `db.execute` UPDATE
 * THROWS (deadlock / lock-timeout / connection-drop — the `catch` around
 * `reprocessOne` in runBackfill), the runner must:
 *   1. count it in `errors` AND mirror that into shared state, so a status
 *      poll sees it (previously `errors` was a function-local never surfaced);
 *   2. populate `lastError` (previously only the encode-failed branch did, so
 *      a fatal-only run had the with-failures flag but NO error message);
 *   3. NOT inflate `processed` — `processed` reflects only rows that genuinely
 *      re-encoded, never the pre-run candidate snapshot (`lastQueuedCount`).
 *
 * Before this fix the admin UI reconstructed `processed` as
 *   lastQueuedCount − encodeFailures − detectionFailures − skips
 * which dropped `errors` entirely: a run where every row's UPDATE threw read
 * "N re-encoded, 0 encode failures, 0 detection failures" with no error line —
 * reporting success AND failure simultaneously. This test pins the runner-state
 * counters so that dishonesty cannot return.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock, releaseMock, lockConnection, executeMock, processImageFormatsMock } = vi.hoisted(() => {
    const queryMock = vi.fn();
    const releaseMock = vi.fn();
    return {
        queryMock,
        releaseMock,
        lockConnection: { query: queryMock, release: releaseMock },
        executeMock: vi.fn(),
        processImageFormatsMock: vi.fn(async () => ({ wasDownscaled: false, avif10bit: true })),
    };
});

vi.mock('@/db', () => ({
    connection: {
        getConnection: vi.fn(async () => lockConnection),
    },
    db: {
        execute: executeMock,
    },
    POOL_CONNECTION_LIMIT: 10,
}));

vi.mock('@/lib/gallery-config', () => ({
    getGalleryConfig: vi.fn(async () => ({
        imageQualityWebp: 80,
        imageQualityAvif: 60,
        imageQualityJpeg: 80,
        imageSizes: [640],
        forceSrgbDerivatives: false,
        wideGamutJpegChroma: '4:4:4' as const,
        avifEffort: 6,
        sdrJpegChroma: '4:2:0' as const,
        wideGamutMaxSourcePixels: 50_000_000,
    })),
}));

vi.mock('@/lib/restore-maintenance', () => ({
    isRestoreMaintenanceActive: vi.fn(() => false),
}));

// Encode succeeds; detection succeeds → the runner reaches the version-bump
// UPDATE, which we make THROW below to drive the fatal `errors` path.
vi.mock('@/lib/process-image', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
        ...actual,
        processImageFormats: processImageFormatsMock,
        resolveColorPipelineDecision: vi.fn(() => null),
        IMAGE_PIPELINE_VERSION: 7,
    };
});

vi.mock('@/lib/color-detection', () => ({
    // Detection succeeds with a minimal signal set so we proceed to the
    // version-bump UPDATE (NOT the detection-failed branch).
    detectColorSignals: vi.fn(async () => ({
        colorPrimaries: null,
        transferFunction: null,
        matrixCoefficients: null,
        iccProfileName: null,
        isHdr: false,
        hasGainMap: false,
        bitDepth: 8,
        colorSpace: null,
    })),
}));

vi.mock('@/lib/upload-paths', () => ({
    resolveOriginalUploadPath: vi.fn(async (n: string) => n),
}));

vi.mock('fs/promises', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
        ...actual,
        default: {
            ...(actual.default as object),
            access: vi.fn(async () => undefined),
        },
        access: vi.fn(async () => undefined),
    };
});

import {
    triggerAdminBackfill,
    readAdminBackfillState,
    _resetAdminBackfillStateForTesting,
} from '@/lib/admin-backfill-runner';

function staticSqlText(arg: unknown): string {
    const chunks = (arg as { queryChunks?: Array<{ value?: unknown }> })?.queryChunks;
    if (!Array.isArray(chunks)) return '';
    let out = '';
    for (const c of chunks) {
        const v = c?.value;
        if (Array.isArray(v)) out += v.join('');
    }
    return out;
}

describe('AGG-1: fatal per-row UPDATE error is counted, surfaced, and never inflates processed', () => {
    beforeEach(() => {
        _resetAdminBackfillStateForTesting();
        queryMock.mockReset();
        releaseMock.mockReset();
        executeMock.mockReset();
        processImageFormatsMock.mockClear();

        queryMock.mockImplementation(async (sqlText: string) => {
            if (typeof sqlText === 'string' && sqlText.includes('GET_LOCK')) return [[{ acquired: 1 }]];
            if (typeof sqlText === 'string' && sqlText.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
            return [[]];
        });

        // SELECT (candidate fetch) returns exactly one row; the per-row UPDATE
        // THROWS — the precise fatal failure mode (deadlock / conn-drop) the fix
        // targets. Distinguish by static SQL text.
        executeMock.mockImplementation(async (arg: unknown) => {
            const text = staticSqlText(arg);
            if (text.includes('SELECT')) {
                return [
                    [
                        {
                            id: 1,
                            filename_original: 'original-1.jpg',
                            filename_avif: 'a.avif',
                            filename_webp: 'a.webp',
                            filename_jpeg: 'a.jpg',
                            icc_profile_name: null,
                            color_primaries: null,
                            width: 100,
                        },
                    ],
                ];
            }
            if (text.includes('UPDATE images SET')) {
                throw new Error('ER_LOCK_DEADLOCK: Deadlock found when trying to get lock');
            }
            return [{ affectedRows: 0 }];
        });
    });

    it('exposes errors>0, lastRunHadFailures, lastError, and processed===0 after a fatal-only run', async () => {
        const result = await triggerAdminBackfill();
        expect(result.status).toBe('queued');

        // Drain the fire-and-forget runner via its authoritative completion
        // signal (state.running reset in runBackfill's finally).
        await vi.waitFor(
            () => {
                if (readAdminBackfillState().running) {
                    throw new Error('backfill runner still draining');
                }
            },
            { timeout: 20_000, interval: 25 },
        );

        const s = readAdminBackfillState();
        // The fatal UPDATE error is counted AND surfaced.
        expect(s.errors).toBeGreaterThan(0);
        // A run with a fatal error is "with failures", not clean.
        expect(s.lastRunHadFailures).toBe(true);
        // lastError carries the fatal message (NOT null) — the prior code left
        // it null because only the encode-failed branch wrote it.
        expect(s.lastError).toBeTruthy();
        expect(String(s.lastError)).toContain('Deadlock');
        // processed reflects the REAL successful count (0 here — the only row
        // threw), NEVER the pre-run candidate snapshot. This is the core of the
        // AGG-1 dishonesty fix: a fatal-only run must NOT report the row as
        // re-encoded.
        expect(s.processed).toBe(0);
        // The encode WAS attempted (we're genuinely on the post-encode path),
        // and the fatal happened at the UPDATE, not as an encode/detection skip.
        expect(processImageFormatsMock).toHaveBeenCalled();
        expect(s.encodeFailures).toBe(0);
        expect(s.detectionFailures).toBe(0);
        // completedRuns still increments — a run that finished is "complete".
        expect(s.completedRuns).toBeGreaterThan(0);
    });
});
