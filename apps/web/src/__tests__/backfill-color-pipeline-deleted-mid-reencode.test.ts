/**
 * AGG-C5-01 (run-9 c2 TE-1 + tracer TRC-C5-01) — sidecar backfill
 * delete-mid-reencode orphan-cleanup contract.
 *
 * The PRODUCTION backfill path is `scripts/backfill-color-pipeline.ts` (the prod
 * runtime container lacks `tsx`, so the `--rm` sidecar IS how prod re-encodes per
 * CLAUDE.md). Commit `300009d4` added the `affectedRows===0 → cleanup` guard to
 * the sidecar's `flushBatch`, mirroring the in-app runner's AGG-C4-05 fix — but
 * `flushBatch` is a closure inside `main()` and was left UNTESTED, while its
 * in-app twin got a dedicated proven-RED test. A refactor dropping the sidecar's
 * `affectedRows===0` partition, the `[]` dir-scan arg, or the post-commit cleanup
 * call would orphan derivative files on every prod backfill with a green suite.
 *
 * Cycle 5 (run-9 c2) extracted the decision into two module-level exports —
 * `collectDeletedMidReencodeFiles` (the affectedRows===0 partition) and
 * `cleanupDeletedMidReencodeVariants` (the dir-scan unlink) — so the contract is
 * now unit-testable in isolation. This file pins:
 *   1. the partition: only rows with affectedRows===0 AND confirmed absence are
 *      selected for cleanup, preserving per-row file association and order;
 *   2. the cleanup: webp/avif/jpeg are ALL unlinked with `[]` sizes (full
 *      directory scan, so every variant is removed regardless of the configured
 *      image_sizes list — the non-default-size orphan case).
 *
 * Proven NON-VACUOUS: dropping the `affectedRows === 0` filter (selecting all
 * rows) OR changing the `[]` arg to default sizes flips the assertions RED.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { deleteImageVariantsMock } = vi.hoisted(() => ({
    deleteImageVariantsMock: vi.fn(
        async (_dir: string, _baseFilename: string, _sizes?: number[]) => undefined,
    ),
}));

// Mock only deleteImageVariants — the cleanup primitive whose `[]` (dir-scan)
// argument is load-bearing. processImageFormats etc. are not exercised here
// (we test the post-encode partition + cleanup, not the encode). The `@` alias
// maps to ./src, so this intercepts the script's relative `../src/lib/process-image`
// import (same resolved module) as well.
vi.mock('@/lib/process-image', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/process-image')>();
    return { ...actual, deleteImageVariants: deleteImageVariantsMock };
});

import * as fs from 'fs';
import * as path from 'path';
import {
    collectDeletedMidReencodeFiles,
    confirmBackfillUpdateResults,
    cleanupDeletedMidReencodeVariants,
    countDeletedMidReencodeDetectionFailures,
    computeBackfillExitCode,
    type BatchFilenames,
} from '../../scripts/backfill-color-pipeline';
import { UPLOAD_DIR_WEBP, UPLOAD_DIR_AVIF, UPLOAD_DIR_JPEG } from '@/lib/upload-paths';

function files(prefix: string): BatchFilenames {
    return {
        filename_webp: `${prefix}.webp`,
        filename_avif: `${prefix}.avif`,
        filename_jpeg: `${prefix}.jpeg`,
    };
}

describe('sidecar backfill delete-mid-reencode partition (collectDeletedMidReencodeFiles)', () => {
    it('selects ONLY rows whose UPDATE changed 0 rows and no longer exist', () => {
        const a = files('aaa');
        const b = files('bbb');
        const c = files('ccc');
        const result = collectDeletedMidReencodeFiles([
            { affectedRows: 1, rowStillExists: true, files: a }, // alive — must NOT be cleaned up
            { affectedRows: 0, rowStillExists: false, files: b }, // deleted mid-reencode — MUST be cleaned up
            { affectedRows: 1, rowStillExists: true, files: c }, // alive — must NOT be cleaned up
        ]);
        expect(result).toEqual([b]);
        // Non-vacuity guard: if the filter were dropped (select-all), this would
        // be [a, b, c] and the length check below would fail.
        expect(result).toHaveLength(1);
    });

    it('returns an empty array when every row is alive (the common case — no cleanup)', () => {
        expect(
            collectDeletedMidReencodeFiles([
                { affectedRows: 1, rowStillExists: true, files: files('x') },
                { affectedRows: 1, rowStillExists: true, files: files('y') },
                // C76-01: MySQL reports changed rows by default; a same-value
                // UPDATE can report 0 while the row still exists.
                { affectedRows: 0, rowStillExists: true, files: files('same-value') },
            ]),
        ).toEqual([]);
    });

    it('selects all rows when every UPDATE matched 0 rows', () => {
        const x = files('x');
        const y = files('y');
        expect(
            collectDeletedMidReencodeFiles([
                { affectedRows: 0, rowStillExists: false, files: x },
                { affectedRows: 0, rowStillExists: false, files: y },
            ]),
        ).toEqual([x, y]);
    });
});

describe('sidecar backfill update confirmation (confirmBackfillUpdateResults)', () => {
    it('marks changed rows live without probing for row existence', async () => {
        const rowExists = vi.fn(async () => false);
        const a = files('changed-row');

        await expect(confirmBackfillUpdateResults([
            { id: 7, affectedRows: 1, files: a },
        ], rowExists)).resolves.toEqual([
            { id: 7, affectedRows: 1, files: a, rowStillExists: true },
        ]);
        expect(rowExists).not.toHaveBeenCalled();
    });

    it('keeps same-value zero-row updates live when the row still exists', async () => {
        const rowExists = vi.fn(async () => true);
        const a = files('same-value-row');
        const confirmed = await confirmBackfillUpdateResults([
            { id: 8, affectedRows: 0, files: a },
        ], rowExists);

        expect(confirmed).toEqual([
            { id: 8, affectedRows: 0, files: a, rowStillExists: true },
        ]);
        expect(rowExists).toHaveBeenCalledExactlyOnceWith(8);
        expect(collectDeletedMidReencodeFiles(confirmed)).toEqual([]);
    });

    it('marks zero-row updates absent when the follow-up probe misses', async () => {
        const rowExists = vi.fn(async () => false);
        const a = files('deleted-row');
        const confirmed = await confirmBackfillUpdateResults([
            { id: 9, affectedRows: 0, files: a },
        ], rowExists);

        expect(confirmed).toEqual([
            { id: 9, affectedRows: 0, files: a, rowStillExists: false },
        ]);
        expect(rowExists).toHaveBeenCalledExactlyOnceWith(9);
        expect(collectDeletedMidReencodeFiles(confirmed)).toEqual([a]);
    });
});

describe('sidecar backfill delete-mid-reencode cleanup (cleanupDeletedMidReencodeVariants)', () => {
    beforeEach(() => {
        deleteImageVariantsMock.mockClear();
    });

    it('unlinks webp/avif/jpeg with [] sizes (full dir scan — catches non-default sizes)', async () => {
        await cleanupDeletedMidReencodeVariants(files('deleted-row'));

        expect(deleteImageVariantsMock).toHaveBeenCalledTimes(3);
        // Each format cleaned up with the EMPTY sizes array — the dir-scan form
        // that removes every {name}_{size}{ext} variant regardless of the
        // configured image_sizes list. A regression to default sizes (the 2-arg
        // form) would leave non-default-size derivatives orphaned.
        expect(deleteImageVariantsMock).toHaveBeenCalledWith(UPLOAD_DIR_WEBP, 'deleted-row.webp', []);
        expect(deleteImageVariantsMock).toHaveBeenCalledWith(UPLOAD_DIR_AVIF, 'deleted-row.avif', []);
        expect(deleteImageVariantsMock).toHaveBeenCalledWith(UPLOAD_DIR_JPEG, 'deleted-row.jpeg', []);

        // Every call's 3rd arg must be the empty array (non-vacuity: a default
        // sizes value or a missing 3rd arg would fail this).
        for (const call of deleteImageVariantsMock.mock.calls) {
            expect(call[2]).toEqual([]);
        }
    });

    it('logs cleanup failures without rejecting the committed batch path', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        deleteImageVariantsMock.mockRejectedValueOnce(new Error('unlink failed'));

        await expect(cleanupDeletedMidReencodeVariants(files('deleted-row'))).resolves.toBeUndefined();

        expect(deleteImageVariantsMock).toHaveBeenCalledTimes(3);
        expect(warnSpy).toHaveBeenCalledWith(
            '[backfill-color-pipeline] Failed to clean deleted-mid-reencode derivative:',
            expect.any(Error),
        );
        warnSpy.mockRestore();
    });
});

describe('sidecar flushBatch wires the delete-mid-reencode helpers (AGG-C5-01, architect Rec 1)', () => {
    // The helper unit tests above pin the partition + cleanup in isolation. This
    // source-shape pin (same idiom as image-queue-delete-race-cleanup-wiring) pins
    // that the in-`main` flushBatch closure actually INVOKES them and adjusts the
    // counter, so a main() refactor that drops the partition/cleanup/tally is
    // caught — flushBatch is a closure and cannot be driven directly from a test.
    const scriptSrc = fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'scripts', 'backfill-color-pipeline.ts'),
        'utf8',
    );

    it('flushBatch calls collectDeletedMidReencodeFiles to partition the UPDATE results', () => {
        expect(scriptSrc).toMatch(/collectDeletedMidReencodeFiles\(\s*confirmedUpdateResults\s*\)/);
    });

    it('flushBatch calls confirmBackfillUpdateResults to probe zero-row updates', () => {
        expect(scriptSrc).toMatch(/confirmBackfillUpdateResults\(\s*updateResults\s*,\s*rowExists\s*\)/);
    });

    it('both sidecar UPDATE branches advance updated_at for freshness validators', () => {
        const occurrences = scriptSrc.match(/updated_at\s*=\s*CURRENT_TIMESTAMP/g) ?? [];
        expect(occurrences.length).toBeGreaterThanOrEqual(2);
    });

    it('flushBatch maps the deleted-row files through cleanupDeletedMidReencodeVariants', () => {
        expect(scriptSrc).toMatch(/\.map\(\s*cleanupDeletedMidReencodeVariants\s*\)/);
    });

    it('flushBatch adjusts the processed/deletedMidReencode tally for deleted rows', () => {
        // The deleted-mid-reencode rows are NOT successes — both counters move.
        expect(scriptSrc).toMatch(/deletedMidReencode\s*\+=\s*deletedMidReencodeFiles\.length/);
        expect(scriptSrc).toMatch(/processed\s*-=\s*deletedMidReencodeFiles\.length/);
    });

    it('flushBatch decrements detectionFailures for rows that were both detection-failed AND deleted (AGG-C4-04)', () => {
        // The exit code keys on detectionFailures; a row that incremented it but
        // was then deleted mid-reencode must be walked back, else the sidecar
        // exits non-zero for a row that no longer exists.
        expect(scriptSrc).toMatch(
            /detectionFailures\s*-=\s*countDeletedMidReencodeDetectionFailures\(/,
        );
    });

    it('main() computes the exit code via the exported helper (AGG-C4-03)', () => {
        expect(scriptSrc).toMatch(/process\.exit\(\s*computeBackfillExitCode\(/);
    });

    it('main() awaits queued task promises and counts task rejections before summary', () => {
        // Cycle 38: p-queue's onIdle() can resolve even when an individual task
        // promise rejects. The sidecar must retain and settle the queue.add()
        // promises so a flushBatch/task failure is counted as an explicit
        // backfill error instead of surfacing as an unhandled rejection.
        expect(scriptSrc).toContain('const queuedTasks: Promise<void>[] = [];');
        expect(scriptSrc).toMatch(/queuedTasks\.push\(\s*queue\.add\(async \(\) =>/);
        expect(scriptSrc).toContain('const taskResults = await Promise.allSettled(queuedTasks);');
        expect(scriptSrc).toContain('errors += rejectedTaskResults.length;');
        expect(scriptSrc).toContain("[backfill-color-pipeline] queued task failed:");
    });
});

describe('countDeletedMidReencodeDetectionFailures (AGG-C4-04 — detection-failure∩deleted overlap)', () => {
    it('counts only the detection-failure-slice rows whose UPDATE matched 0 (deleted mid-reencode)', () => {
        // flushBatch passes ONLY the derivative-slice UPDATE results here, so a
        // 0 means the detection-failed row was deleted mid-reencode and must not
        // keep detectionFailures elevated.
        expect(
            countDeletedMidReencodeDetectionFailures([
                { affectedRows: 1, rowStillExists: true }, // detection-failed row still alive — keep counted
                { affectedRows: 0, rowStillExists: false }, // detection-failed AND deleted — walk back
                { affectedRows: 0, rowStillExists: false }, // detection-failed AND deleted — walk back
                { affectedRows: 0, rowStillExists: true }, // same-value update — keep counted
            ]),
        ).toBe(2);
    });

    it('returns 0 when every detection-failure row is still alive (the common case)', () => {
        expect(
            countDeletedMidReencodeDetectionFailures([
                { affectedRows: 1, rowStillExists: true },
                { affectedRows: 0, rowStillExists: true },
            ]),
        ).toBe(0);
    });

    it('returns 0 for an empty derivative slice (no detection failures in the batch)', () => {
        expect(countDeletedMidReencodeDetectionFailures([])).toBe(0);
    });
});

describe('computeBackfillExitCode (AGG-C4-03 — sidecar exit-code matrix)', () => {
    it('exits 0 only when there are neither errors nor detection failures', () => {
        expect(computeBackfillExitCode({ errors: 0, detectionFailures: 0 })).toBe(0);
    });

    it('exits 1 on hard errors', () => {
        expect(computeBackfillExitCode({ errors: 2, detectionFailures: 0 })).toBe(1);
    });

    it('exits 1 on detection failures (re-encoded but color metadata left stale)', () => {
        expect(computeBackfillExitCode({ errors: 0, detectionFailures: 3 })).toBe(1);
    });

    it('exits 1 when both are present', () => {
        expect(computeBackfillExitCode({ errors: 1, detectionFailures: 1 })).toBe(1);
    });
});
