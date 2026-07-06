/**
 * Run-2 Cycle 1 AGG-01 / TST-03 — admin-backfill-runner detection-failure
 * version-bump regression test.
 *
 * Contract under test: when `processImageFormats` SUCCEEDS but
 * `detectColorSignals` THROWS, the runner must NOT advance
 * `pipeline_version`. The re-encode is idempotent, so leaving the row behind
 * the current pipeline version lets a later backfill retry detection and
 * recover the (transiently) stale color columns. Bumping the version would
 * permanently strand the row — candidate selection is `pipeline_version <
 * CURRENT`, so a bumped row is never re-picked.
 *
 * Previously the detection-failed branch bumped `pipeline_version`, which
 * contradicted the runner header's "pick up where it left off" resume
 * contract and diverged from the operator script's (correct) semantics.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factories are hoisted above module-scope declarations, so any mock
// fn referenced inside a factory must be created with vi.hoisted().
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
    // AGG-R5C3-05: the runner imports POOL_CONNECTION_LIMIT to budget its
    // concurrency; the mock must export it or the module access throws.
    POOL_CONNECTION_LIMIT: 10,
}));

vi.mock('@/lib/gallery-config', () => ({
    getGalleryConfigUncached: vi.fn(async () => ({
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

// Encode succeeds; detection throws (mock defined via vi.hoisted above).
// This is the exact failure mode the fix targets.
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
    detectColorSignals: vi.fn(async () => {
        throw new Error('transient: ICC parse hiccup');
    }),
}));

vi.mock('@/lib/upload-paths', () => ({
    resolveOriginalUploadPath: vi.fn(async (n: string) => n),
}));

// fs.access must resolve so reprocessOne proceeds past the existence check
// and reaches the encode + detection path. We do NOT mock `sharp`: the real
// module is required by process-image.ts at import time (sharp.concurrency),
// and inside reprocessOne the real `sharp(fakePath).metadata()` rejects on
// the non-existent file — landing in the exact same `signals = null`
// detection-failure branch we are exercising (detectColorSignals is also
// mocked to throw as a belt-and-braces second failure source).
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

import { triggerAdminBackfill, readAdminBackfillState } from '@/lib/admin-backfill-runner';

/**
 * Reconstruct the static SQL text from a Drizzle `sql` template object by
 * concatenating its StringChunk values. Interpolated params contribute no
 * text, which is exactly what we want — we assert on the column names in the
 * static SET clause, not on the bound values.
 */
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

describe('AGG-01: runner does NOT advance pipeline_version when detection fails', () => {
    beforeEach(() => {
        const sym = Symbol.for('gallerykit.adminBackfillState');
        const g = globalThis as Record<symbol, unknown>;
        g[sym] = { running: false, lastQueuedCount: 0, completedRuns: 0, lastError: null };

        queryMock.mockReset();
        releaseMock.mockReset();
        executeMock.mockReset();
        processImageFormatsMock.mockClear();

        queryMock.mockImplementation(async (sqlText: string) => {
            if (typeof sqlText === 'string' && sqlText.includes('GET_LOCK')) return [[{ acquired: 1 }]];
            if (typeof sqlText === 'string' && sqlText.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
            return [[]];
        });

        // db.execute is used for fetchCandidates (returns rows) AND for the
        // per-row UPDATE. Distinguish by inspecting the static SQL: a SELECT
        // returns the candidate row; an UPDATE returns an empty ok packet.
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
            return [{ affectedRows: 1 }];
        });
    });

    it('issues an UPDATE without pipeline_version (so the row is re-picked next run)', async () => {
        const result = await triggerAdminBackfill();
        expect(result.status).toBe('queued');

        // Let the fire-and-forget runner drain: config read, encode, detection
        // throw, UPDATE, queue.onIdle, finally. R4C1 TEST-R4C1-06: a fixed
        // 10×setImmediate drain raced the REAL `sharp(path).metadata()` libuv
        // threadpool I/O (sharp is deliberately unmocked — see the fs/promises
        // mock comment above) and flaked on slow machines: the assertions ran
        // before the UPDATE landed. Poll the runner's own completion signal —
        // `state.running` is reset in runBackfill's `finally`, which is the
        // single authoritative release point (R29-CRIT-1).
        await vi.waitFor(
            () => {
                if (readAdminBackfillState().running) {
                    throw new Error('backfill runner still draining');
                }
            },
            { timeout: 20_000, interval: 25 },
        );

        // Encode was attempted (so we're genuinely on the post-encode path).
        expect(processImageFormatsMock).toHaveBeenCalled();

        // Find the UPDATE issued for the row.
        const updateCalls = executeMock.mock.calls
            .map((c) => staticSqlText(c[0]))
            .filter((t) => t.includes('UPDATE images SET'));
        expect(updateCalls.length).toBeGreaterThan(0);

        // CONTRACT: no UPDATE on the detection-failure path may set
        // pipeline_version. If it did, the row would be stranded forever.
        for (const text of updateCalls) {
            expect(text).not.toContain('pipeline_version');
            // The freshly-encoded derivative flags ARE still persisted.
            expect(text).toContain('was_downscaled');
            expect(text).toContain('avif_10bit');
        }

        // Runner finished cleanly (state released).
        expect(readAdminBackfillState().running).toBe(false);
    });
});
