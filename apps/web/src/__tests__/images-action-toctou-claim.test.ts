/**
 * R16C16 CR-16-01: lock the upload-tracker check-then-claim ordering.
 *
 * The quota CLAIM (`tracker.bytes += totalSize; tracker.count += files.length`)
 * must happen synchronously AFTER the (synchronous) limit checks and BEFORE the
 * first `await` (disk pre-check + topic-exists query). Otherwise two concurrent
 * same-key uploads can both pass the checks before either claims and jointly
 * exceed the per-window limits. Each awaited validation that follows the claim
 * must roll it back (`settleUploadTrackerClaim(..., 0, 0)`) on early return.
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

    it('rolls the claim back on every awaited early-return path', () => {
        // Disk-insufficient (freeBytes < 1GiB), disk-check catch, topic-query
        // catch (R17C17), and topic-not-found each undo the claim with a
        // zero-success settle.
        const rollbacks = SRC.match(
            /settleUploadTrackerClaim\(uploadTracker,\s*uploadTrackerKey,\s*files\.length,\s*totalSize,\s*0,\s*0\)/g,
        );
        expect(rollbacks).not.toBeNull();
        expect(rollbacks!.length).toBe(4);
    });

    it('settles the claim then re-throws if the topic-exists query throws (R17C17 CR-17-1)', () => {
        // The topic SELECT sits AFTER the synchronous claim but the outer try is
        // finally-only (no catch), so an un-caught throw there would leak the
        // claim until the ~1 h window expires. Assert the SELECT is wrapped in a
        // try/catch that settles (0,0) and re-throws — mirroring the disk check.
        const topicQueryIdx = SRC.indexOf('db.select({ slug: topics.slug })');
        expect(topicQueryIdx).toBeGreaterThan(0);
        const after = SRC.slice(topicQueryIdx);
        const catchMatch = after.match(
            /catch \(err\) \{\s*settleUploadTrackerClaim\(uploadTracker,\s*uploadTrackerKey,\s*files\.length,\s*totalSize,\s*0,\s*0\);\s*throw err;\s*\}/,
        );
        expect(catchMatch).not.toBeNull();
    });
});
