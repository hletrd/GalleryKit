/**
 * PERF-R5C1-01 + AGG-R5C2-03 (BUG-R5C2-01 / CRT-R5C2-04 / TEST-R5C2-02 / -15 /
 * BUG-R5C2-04): admin-backfill-runner batched candidate fetch.
 *
 * Verifies:
 *  (a) Single-batch case: 50 candidates → exactly 1 batch SELECT.
 *  (b) Multi-batch case: 150 candidates → exactly 2 batch SELECTs, issued with
 *      cursor 0 then 100, returning 100 then 50 rows.
 *  (c) Cursor advances strictly: the second batch SELECT only sees ids > 100.
 *
 * WHY THIS REWRITE (BUG-R5C2-01): the previous mock dispatched purely by call
 * ORDER with a shared `batchIndex` counter, which could not tell a real
 * `fetchCandidateBatch` SELECT apart from a `reprocessOne` UPDATE. The first
 * UPDATE call after batch 1 satisfied `batchIndex*100 < total` and was handed
 * the SECOND batch's rows — so the test "saw" a second batch that the real loop
 * never fetched. A regression that broke loop continuation (always `break`
 * after batch 1) still passed.
 *
 * The fix: dispatch by SQL CONTENT. Drizzle `sql` tagged templates expose
 * `queryChunks`, where the literal SQL fragments are `StringChunk`s and the
 * bare `${...}` interpolations are inlined raw primitive chunks (Number /
 * Boolean / null) in source order. So we can:
 *   - join the StringChunk text to classify the query (batch SELECT vs COUNT vs
 *     UPDATE) by keyword (`LIMIT` + `id >` → batch; `COUNT` → count; `SET`/
 *     `UPDATE` → row update); and
 *   - read the inlined primitive chunks in order to recover the BOUND cursor.
 *     The batch SELECT inlines `[IMAGE_PIPELINE_VERSION, cursor, BATCH_SIZE]`,
 *     so the cursor is the 2nd primitive.
 *
 * Batch SELECT responses come ONLY from the SELECT dispatch path; UPDATE calls
 * get an update-shaped result and NEVER contribute a batch. Completion is
 * awaited deterministically via `vi.waitFor(readAdminBackfillState().running)`
 * — no wall-clock `setTimeout` sleeps remain (BUG-R5C2-04).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock, releaseMock, lockConnection, executeMock } = vi.hoisted(() => {
    const queryMock = vi.fn();
    const releaseMock = vi.fn();
    return {
        queryMock,
        releaseMock,
        lockConnection: { query: queryMock, release: releaseMock },
        executeMock: vi.fn(),
    };
});

vi.mock('@/db', () => ({
    connection: {
        // Every getConnection() — for the global backfill lock AND for each
        // per-image processing claim — returns the same fake lock connection.
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
    getGalleryConfigDetached: vi.fn().mockResolvedValue({
        imageQualityWebp: 80,
        imageQualityAvif: 60,
        imageQualityJpeg: 80,
        imageSizes: [640],
        forceSrgbDerivatives: false,
        wideGamutJpegChroma: '4:4:4' as const,
        avifEffort: 6,
        sdrJpegChroma: '4:2:0' as const,
        wideGamutMaxSourcePixels: 50_000_000,
    }),
}));

vi.mock('@/lib/restore-maintenance', () => ({
    isRestoreMaintenanceActive: vi.fn(() => false),
}));

vi.mock('@/lib/process-image', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
        ...actual,
        processImageFormats: vi.fn(async () => ({ wasDownscaled: false, avif10bit: false })),
        resolveColorPipelineDecision: vi.fn(() => null),
        IMAGE_PIPELINE_VERSION: 7,
    };
});

vi.mock('@/lib/color-detection', () => ({
    detectColorSignals: vi.fn().mockResolvedValue({
        iccProfileName: null,
        colorPrimaries: 'bt709',
        transferFunction: 'srgb',
        matrixCoefficients: null,
        isHdr: false,
        hasGainMap: false,
    }),
    isWideGamutPrimary: vi.fn(() => false),
}));

// reprocessOne constructs a real `sharp(originalPath)` and awaits
// `image.metadata()` BEFORE calling the mocked detectColorSignals. The
// synthetic `/fake/...` paths don't exist on disk, so a real Sharp instance
// would reject in metadata() and push every row down the detection-failed
// branch. Mock sharp so the constructed instance's metadata() resolves.
//
// NOTE: process-image.ts calls sharp.concurrency() / sharp.cache() and reads
// sharp.versions.heif at MODULE LOAD (it is pulled in via importOriginal() in
// the @/lib/process-image mock above). So the mocked default must be a callable
// carrying those statics, not a bare vi.fn(), or the process-image import
// throws `default.concurrency is not a function`.
vi.mock('sharp', () => {
    const sharpFn = vi.fn(() => ({
        metadata: vi.fn().mockResolvedValue({ width: 100, height: 100, depth: 'uchar' }),
    })) as unknown as {
        (...args: unknown[]): unknown;
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
    resolveOriginalUploadPath: vi.fn(async (n: string) => `/fake/${n}`),
    ensureUploadDirectories: vi.fn(),
}));

vi.mock('fs/promises', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    const access = vi.fn().mockResolvedValue(undefined);
    // The runner uses `import fs from 'fs/promises'` (DEFAULT import). Under this
    // interop config the default binding resolves to the module's `default`
    // object, NOT the named exports — so the mocked `access` must also live on
    // `default` or `fs.access` silently falls through to the real fs (ENOENT on
    // the synthetic `/fake/...` paths, which would make every row skip as
    // 'missing-original'). Provide both the named override and a `default`.
    return {
        ...actual,
        access,
        default: { ...(actual.default as object), access },
    };
});

import {
    triggerAdminBackfill,
    readAdminBackfillState,
    _resetAdminBackfillStateForTesting,
} from '@/lib/admin-backfill-runner';

const BATCH_SIZE = 100;

function makeRow(id: number) {
    return {
        id,
        filename_original: `orig-${id}.jpg`,
        filename_avif: `${id}.avif`,
        filename_webp: `${id}.webp`,
        filename_jpeg: `${id}.jpg`,
        icc_profile_name: null,
        color_primaries: null,
        width: 100,
    };
}

function resetGlobalState() {
    // AGG-R5C3-22 (TEST-R5C3-11): route the reset through the runner's own
    // test-only export instead of poking Symbol.for(...) and hand-listing every
    // field — the field set lives in one place now and cannot drift.
    _resetAdminBackfillStateForTesting();
}

function setupLockMocks() {
    // Both the global backfill lock and every per-image processing claim go
    // through lockConnection.query — grant every GET_LOCK so no row is skipped
    // as 'locked' (we want processed=150 in the happy path).
    queryMock.mockImplementation(async (sqlText: string) => {
        if (typeof sqlText === 'string' && sqlText.includes('GET_LOCK')) return [[{ acquired: 1 }]];
        if (typeof sqlText === 'string' && sqlText.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
        return [[]];
    });
}

/**
 * Inspect a drizzle `sql` tagged-template object passed to db.execute and
 * recover (a) the joined literal SQL text and (b) the inlined bound primitives
 * in source order. Bare `${number}` / `${boolean}` / `${null}` interpolations
 * are inlined as raw primitive chunks (not Param wrappers) — see the scratch
 * verification in the executor report; this is stable across drizzle's `sql`
 * builder for primitive interpolations.
 *
 * AGG-R5C3-22 (TEST-R5C3-09): this inspector depends on TWO drizzle-orm
 * INTERNALS — the `queryChunks` array on a `sql` template object and the
 * `StringChunk` constructor name for its literal fragments. Verified against
 * drizzle-orm ^0.45.2 (apps/web/package.json). If a future drizzle upgrade
 * renames `StringChunk` or restructures `queryChunks`, `sawStringChunk` stays
 * false and the assertion in the single-batch test below fails LOUD at the
 * upgrade — instead of every batch silently classifying as 'update' (empty text)
 * and the loop-continuation coverage rotting into a vacuous pass.
 */
let sawStringChunk = false;
function inspectSql(arg: unknown): { text: string; values: unknown[] } {
    const chunks = (arg as { queryChunks?: unknown[] })?.queryChunks;
    if (!Array.isArray(chunks)) {
        return { text: '', values: [] };
    }
    const textParts: string[] = [];
    const values: unknown[] = [];
    for (const c of chunks) {
        const ctor = (c as { constructor?: { name?: string } })?.constructor?.name;
        if (ctor === 'StringChunk') {
            sawStringChunk = true;
            const v = (c as { value: unknown }).value;
            textParts.push(Array.isArray(v) ? v.join('') : String(v));
        } else if (c && typeof c === 'object' && 'value' in (c as object)) {
            // Param-style wrapper (defensive — not the primitive-inline path).
            values.push((c as { value: unknown }).value);
        } else {
            // Inlined raw primitive (Number / Boolean / null / String).
            values.push(c);
        }
    }
    return { text: textParts.join(' '), values };
}

type SqlKind = 'count' | 'batch' | 'update';

function classifySql(text: string): SqlKind {
    if (/COUNT\(/i.test(text)) return 'count';
    if (/LIMIT/i.test(text) && /id\s*>/i.test(text)) return 'batch';
    return 'update';
}

interface BatchObservation {
    /** Bound cursor value (the `id > ${cursor}` parameter). */
    cursor: number;
    /** ids of the rows this SELECT returned. */
    ids: number[];
}

/**
 * Build an executeMock that dispatches by SQL CONTENT (not call order):
 *  - COUNT query   → returns the total candidate count.
 *  - batch SELECT  → returns the keyset page `id > cursor` (≤ BATCH_SIZE rows),
 *                    and records the observed cursor + returned ids.
 *  - UPDATE        → returns an update-shaped result, NEVER a batch payload.
 *
 * The returned `batches` array is the GROUND TRUTH for assertions: it only
 * grows when a real batch SELECT is dispatched, so a loop that fails to issue
 * the second fetch cannot fabricate a second entry.
 */
function buildExecuteMock(totalRows: number) {
    const allRows = Array.from({ length: totalRows }, (_, i) => makeRow(i + 1));
    const batches: BatchObservation[] = [];

    executeMock.mockImplementation(async (arg: unknown) => {
        const { text, values } = inspectSql(arg);
        const kind = classifySql(text);

        if (kind === 'count') {
            return [[{ cnt: totalRows }]];
        }

        if (kind === 'batch') {
            // Inlined primitives for the batch SELECT are
            // [IMAGE_PIPELINE_VERSION, cursor, BATCH_SIZE] — cursor is values[1].
            const cursor = Number(values[1]);
            const page = allRows.filter((r) => r.id > cursor).slice(0, BATCH_SIZE);
            batches.push({ cursor, ids: page.map((r) => r.id) });
            return [page];
        }

        // UPDATE — never a batch payload.
        return [[]];
    });

    return batches;
}

describe('PERF-R5C1-01 / AGG-R5C2-03: admin-backfill-runner batched fetch (SQL-content dispatch)', () => {
    beforeEach(() => {
        resetGlobalState();
        sawStringChunk = false;
        queryMock.mockReset();
        releaseMock.mockReset();
        executeMock.mockReset();
        setupLockMocks();
    });

    async function waitForRunnerDone() {
        await vi.waitFor(
            () => {
                expect(readAdminBackfillState().running).toBe(false);
            },
            { timeout: 5000 },
        );
    }

    it('records a zero-candidate trigger as a distinct completed no-op run', async () => {
        const sym = Symbol.for('gallerykit.adminBackfillState');
        (globalThis as typeof globalThis & Record<symbol, unknown>)[sym] = {
            running: false,
            lastQueuedCount: 9,
            processed: 3,
            errors: 2,
            completedRuns: 4,
            lastError: 'old failure',
            skippedMissingOriginal: 1,
            skippedLocked: 1,
            encodeFailures: 1,
            detectionFailures: 1,
            deletedMidReencode: 1,
            lastRunHadFailures: true,
            lastRunNoCandidates: false,
        };
        const batches = buildExecuteMock(0);

        const result = await triggerAdminBackfill();

        expect(result).toEqual({ status: 'queued', affectedRows: 0 });
        expect(batches).toHaveLength(0);
        const state = readAdminBackfillState();
        expect(state.running).toBe(false);
        expect(state.lastQueuedCount).toBe(0);
        expect(state.processed).toBe(0);
        expect(state.errors).toBe(0);
        expect(state.skippedMissingOriginal).toBe(0);
        expect(state.skippedLocked).toBe(0);
        expect(state.encodeFailures).toBe(0);
        expect(state.detectionFailures).toBe(0);
        expect(state.deletedMidReencode).toBe(0);
        expect(state.lastError).toBeNull();
        expect(state.lastRunHadFailures).toBe(false);
        expect(state.lastRunNoCandidates).toBe(true);
        expect(state.completedRuns).toBe(5);
    });

    it('(a) single-batch: 50 candidates → exactly 1 batch SELECT at cursor 0', async () => {
        const batches = buildExecuteMock(50);

        const result = await triggerAdminBackfill();
        expect(result.status).toBe('queued');
        await waitForRunnerDone();

        expect(batches).toHaveLength(1);
        expect(batches[0]!.cursor).toBe(0);
        expect(batches[0]!.ids).toHaveLength(50);

        // AGG-R5C3-22 (TEST-R5C3-09): prove the drizzle `queryChunks` /
        // `StringChunk` shape this whole SQL-content dispatch relies on was
        // actually exercised. If a drizzle upgrade drifts the internals,
        // sawStringChunk stays false and this fails loud rather than letting the
        // dispatch silently misclassify every query.
        expect(sawStringChunk, 'drizzle StringChunk shape drifted — inspectSql is no longer pinning real SQL').toBe(true);

        // All 50 reprocessed cleanly, nothing skipped/failed.
        const state = readAdminBackfillState();
        expect(state.skippedMissingOriginal).toBe(0);
        expect(state.skippedLocked).toBe(0);
        expect(state.encodeFailures).toBe(0);
        expect(state.detectionFailures).toBe(0);
    });

    it('(b) multi-batch: 150 candidates → 2 batch SELECTs at cursor 0 then 100 (100 + 50 rows)', async () => {
        const batches = buildExecuteMock(150);

        const result = await triggerAdminBackfill();
        expect(result.status).toBe('queued');
        await waitForRunnerDone();

        // Exactly two REAL batch fetches — a regression that never issues the
        // second fetch leaves this at length 1 and the test FAILS.
        expect(batches).toHaveLength(2);
        expect(batches.map((b) => b.cursor)).toEqual([0, 100]);
        expect(batches[0]!.ids).toHaveLength(BATCH_SIZE);
        expect(batches[1]!.ids).toHaveLength(50);
        for (const b of batches) {
            expect(b.ids.length).toBeLessThanOrEqual(BATCH_SIZE);
        }

        // Observability: all 150 processed, no skips/failures.
        const state = readAdminBackfillState();
        expect(state.skippedMissingOriginal).toBe(0);
        expect(state.skippedLocked).toBe(0);
        expect(state.encodeFailures).toBe(0);
        expect(state.detectionFailures).toBe(0);
    });

    it('(c) cursor advances strictly: batch 2 only sees ids > 100 (110 candidates)', async () => {
        const batches = buildExecuteMock(110);

        const result = await triggerAdminBackfill();
        expect(result.status).toBe('queued');
        await waitForRunnerDone();

        expect(batches).toHaveLength(2);
        expect(batches[1]!.cursor).toBe(100);

        const maxIdBatch1 = Math.max(...batches[0]!.ids);
        const minIdBatch2 = Math.min(...batches[1]!.ids);
        expect(maxIdBatch1).toBe(100);
        expect(minIdBatch2).toBeGreaterThan(maxIdBatch1);
        expect(batches[1]!.ids).toEqual([101, 102, 103, 104, 105, 106, 107, 108, 109, 110]);
    });

    it('skips rows whose per-image processing lock is held (counted as skippedLocked, no version bump)', async () => {
        // 3 candidates, single batch. Deny the per-image GET_LOCK for image id=2
        // so it is skipped as 'locked'; grant everything else.
        const batches = buildExecuteMock(3);
        queryMock.mockImplementation(async (sqlText: string, params?: unknown[]) => {
            if (typeof sqlText === 'string' && sqlText.includes('GET_LOCK')) {
                const name = Array.isArray(params) ? String(params[0]) : '';
                if (name === 'gallerykit:image-processing:2') return [[{ acquired: null }]];
                return [[{ acquired: 1 }]];
            }
            if (typeof sqlText === 'string' && sqlText.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
            return [[]];
        });

        const result = await triggerAdminBackfill();
        expect(result.status).toBe('queued');
        await waitForRunnerDone();

        expect(batches).toHaveLength(1);
        const state = readAdminBackfillState();
        expect(state.skippedLocked).toBe(1);
        expect(state.skippedMissingOriginal).toBe(0);
        expect(state.encodeFailures).toBe(0);
        expect(state.detectionFailures).toBe(0);
    });
});
