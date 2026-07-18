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
        processImageFormatsMock: vi.fn(async () => ({ wasDownscaled: false, avif10bit: true, derivativeMaxWidth: 1200 })),
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
    getGalleryConfigDetachedStrict: vi.fn(async () => ({
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

// reprocessOne opens `sharp(originalPath).metadata()` BEFORE detectColorSignals.
// The temp paths here do not exist on disk, so real Sharp would throw and push
// every row down the detection-FAILED branch — masking the version-bump UPDATE
// path both the fatal-only and mixed tests actually intend to exercise. Mock
// Sharp so .metadata() resolves; the (mocked) detectColorSignals then yields
// truthy signals → the version-bump `UPDATE images SET pipeline_version` path.
// The default export must ALSO carry the static methods process-image.ts calls
// at import time (concurrency/cache/versions), since the process-image mock
// below uses importOriginal() and loads the real module.
vi.mock('sharp', () => {
    const instance = { metadata: vi.fn(async () => ({ width: 100, height: 100, format: 'jpeg', space: 'srgb' })) };
    const sharpFn = vi.fn(() => instance) as unknown as {
        (...args: unknown[]): typeof instance;
        concurrency: ReturnType<typeof vi.fn>;
        cache: ReturnType<typeof vi.fn>;
        versions: { heif?: string };
    };
    sharpFn.concurrency = vi.fn();
    sharpFn.cache = vi.fn();
    sharpFn.versions = { heif: '1.0.0' };
    return { default: sharpFn };
});

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

describe('AGG-R8-10 (run-8 c2): a MIXED run reports processed>0 AND errors>0 simultaneously', () => {
    // The fatal-only test above proves errors are surfaced when EVERY row throws.
    // This pins the realistic production shape: some rows re-encode cleanly while
    // others hit a fatal per-row UPDATE. A regression that mis-attributed a fatal
    // row to `processed` (or dropped a success when any error occurred) would pass
    // the fatal-only test but fail here.
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

        // Two candidate rows; the per-row UPDATE succeeds for the first and
        // THROWS for the second. The runner issues a COUNT(*) query AND a
        // separate id-fetch SELECT; distinguish them so COUNT returns 2 and the
        // fetch returns the two rows exactly once (a re-poll returns empty so
        // the run terminates after the single batch).
        let fetchCount = 0;
        let updateCount = 0;
        const mkRow = (id: number) => ({
            id,
            filename_original: `original-${id}.jpg`,
            filename_avif: `a${id}.avif`,
            filename_webp: `a${id}.webp`,
            filename_jpeg: `a${id}.jpg`,
            icc_profile_name: null,
            color_primaries: null,
            width: 100,
        });
        executeMock.mockImplementation(async (arg: unknown) => {
            const text = staticSqlText(arg);
            if (text.includes('COUNT(*)')) {
                return [[{ cnt: 2 }]];
            }
            if (text.includes('SELECT')) {
                fetchCount++;
                if (fetchCount > 1) return [[]];
                return [[mkRow(1), mkRow(2)]];
            }
            if (text.includes('UPDATE images SET')) {
                updateCount++;
                // First successful version-bump, second fatal — one of each.
                if (updateCount >= 2) {
                    throw new Error('ER_LOCK_DEADLOCK: Deadlock found when trying to get lock');
                }
                return [{ affectedRows: 1 }];
            }
            return [{ affectedRows: 0 }];
        });
    });

    it('processed===1 and errors===1 coexist; lastRunHadFailures and lastError set', async () => {
        const result = await triggerAdminBackfill();
        expect(result.status).toBe('queued');
        await vi.waitFor(
            () => {
                if (readAdminBackfillState().running) {
                    throw new Error('backfill runner still draining');
                }
            },
            { timeout: 20_000, interval: 25 },
        );

        const s = readAdminBackfillState();
        // Exactly one row re-encoded, exactly one threw — both counters reflect
        // reality at the same time (the partition the fatal-only test cannot
        // exercise).
        expect(s.processed).toBe(1);
        expect(s.errors).toBe(1);
        expect(s.lastRunHadFailures).toBe(true);
        expect(String(s.lastError)).toContain('Deadlock');
        // Both rows reached the encode step (the fatal was at the UPDATE).
        expect(processImageFormatsMock).toHaveBeenCalledTimes(2);
        expect(s.encodeFailures).toBe(0);
        expect(s.detectionFailures).toBe(0);
        expect(s.completedRuns).toBeGreaterThan(0);
    });
});

describe('AGG-R8c3-11/TEST-2 (run-8 c3): a corrupt-width row is skipped as encode-failed, never re-encoded', () => {
    // AGG-R8-09 (run-8 c2) added a width re-validation BEFORE the lock-critical
    // re-encode block: a legacy/corrupt row with width <= 0 (or non-finite)
    // would otherwise reach processImageFormats → opaque Sharp .resize({width:0})
    // throw. The guard classifies it as 'encode-failed' (NO version bump, stays
    // a candidate) WITHOUT calling processImageFormats. This load-bearing
    // data-integrity contract (a corrupt-width row must never be falsely
    // reported re-encoded) had NO test — all 4 backfill suites used width:100.
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

        // One candidate row with an invalid stored width (0). The guard must
        // fire BEFORE any encode or UPDATE.
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
                            width: 0,
                        },
                    ],
                ];
            }
            return [{ affectedRows: 1 }];
        });
    });

    it('width<=0 → encodeFailures, no processImageFormats call, no version-bump UPDATE', async () => {
        const result = await triggerAdminBackfill();
        expect(result.status).toBe('queued');
        await vi.waitFor(
            () => {
                if (readAdminBackfillState().running) {
                    throw new Error('backfill runner still draining');
                }
            },
            { timeout: 20_000, interval: 25 },
        );

        const s = readAdminBackfillState();
        // Classified as encode-failed (NO version bump → stays a candidate).
        expect(s.encodeFailures).toBe(1);
        // Never falsely reported as re-encoded.
        expect(s.processed).toBe(0);
        // The guard fired BEFORE the encode — processImageFormats not called.
        expect(processImageFormatsMock).not.toHaveBeenCalled();
        // No version-bump UPDATE was issued for the corrupt row.
        const updateCalls = executeMock.mock.calls
            .map((c) => staticSqlText(c[0]))
            .filter((t) => t.includes('UPDATE images SET'));
        expect(updateCalls.length).toBe(0);
        expect(s.completedRuns).toBeGreaterThan(0);
    });
});
