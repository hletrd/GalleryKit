/**
 * R16C16 CR-16-01: lock the upload-tracker check-then-claim ordering.
 *
 * The quota CLAIM (`tracker.bytes += totalSize; tracker.count += files.length`)
 * must happen synchronously AFTER the (synchronous) limit checks and BEFORE the
 * first `await` (disk pre-check + topic-exists query). Otherwise two concurrent
 * same-key uploads can both pass the checks before either claims and jointly
 * exceed the per-window limits. A one-shot settlement helper owns every
 * post-claim exit so future branches cannot double-decrement or leak the claim.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(__dirname, '../app/actions/images.ts'), 'utf8');

describe('uploadImages TOCTOU claim ordering (R16C16 CR-16-01)', () => {
    it('claims the quota before the disk pre-check await', () => {
        const claimIdx = SRC.indexOf('tracker.bytes += totalSize');
        const diskAwaitIdx = SRC.indexOf('await ensureUploadDirectories()');
        expect(claimIdx).toBeGreaterThan(0);
        expect(diskAwaitIdx).toBeGreaterThan(0);
        expect(claimIdx).toBeLessThan(diskAwaitIdx);
    });

    it('claims the quota before the topic-exists query await', () => {
        const claimIdx = SRC.indexOf('tracker.count += files.length');
        const topicQueryIdx = SRC.indexOf('db.select({ slug: topics.slug })');
        expect(claimIdx).toBeGreaterThan(0);
        expect(topicQueryIdx).toBeGreaterThan(0);
        expect(claimIdx).toBeLessThan(topicQueryIdx);
    });

    it('uses a one-shot settlement helper for post-claim exits', () => {
        expect(SRC).toContain('let trackerSettled = false');
        expect(SRC).toContain('const settleClaim = (successfulFiles: number, successfulBytes: number)');
        expect(SRC).toMatch(/if\s*\(\s*trackerSettled\s*\)\s*return/);
        const zeroRollbacks = SRC.match(/settleClaim\(0,\s*0\)/g);
        expect(zeroRollbacks).not.toBeNull();
        expect(zeroRollbacks!.length).toBeGreaterThanOrEqual(4);
        expect(SRC).toContain('settleClaim(successCount, uploadedBytes)');
    });

    /**
     * AGG8b-23 / TEST8-03 (run-10 c8b): the two position pins above only
     * relate the claim to TWO NAMED awaits — a NEW `await` inserted anywhere
     * between the synchronous limit checks and the claim (the actual TOCTOU
     * window) would pass them. Pin the whole window: from the first
     * synchronous limit check to the claim there must be NO await token at
     * all, so any future asynchronous insertion in the vulnerability window
     * fails this test by construction.
     */
    it('the check-to-claim window contains no await (atomicity by construction)', () => {
        const checkIdx = SRC.indexOf('if (tracker.count + files.length > UPLOAD_MAX_FILES_PER_WINDOW)');
        const claimIdx = SRC.indexOf('tracker.bytes += totalSize');
        expect(checkIdx).toBeGreaterThan(0);
        expect(claimIdx).toBeGreaterThan(checkIdx);
        // Strip comments first — prose in comments legitimately says "await".
        const windowSrc = SRC.slice(checkIdx, claimIdx)
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '');
        expect(windowSrc).not.toMatch(/\bawait\b/);
        // The window must also stay free of promise chaining that would defer
        // the claim without the `await` keyword.
        expect(windowSrc).not.toContain('.then(');
    });

    it('settles the claim then returns a structured error if the topic-exists query throws', () => {
        // The topic SELECT sits AFTER the synchronous claim but the outer try is
        // finally-only (no catch), so an un-caught throw there would leak the
        // claim until the ~1 h window expires. Assert the SELECT is wrapped in a
        // try/catch that settles (0,0) and returns a normal Server Action error
        // instead of surfacing an unstructured framework exception.
        const topicQueryIdx = SRC.indexOf('db.select({ slug: topics.slug })');
        expect(topicQueryIdx).toBeGreaterThan(0);
        const after = SRC.slice(topicQueryIdx);
        const catchMatch = after.match(
            /catch \(err\) \{\s*settleClaim\(0,\s*0\);\s*console\.error\('Failed to verify upload topic before accepting files', err\);\s*return \{ error: t\('failedToVerifyTopic'\) \};\s*\}/,
        );
        expect(catchMatch).not.toBeNull();
    });
});
