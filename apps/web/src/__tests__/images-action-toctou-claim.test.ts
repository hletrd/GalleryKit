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
        // Disk-insufficient (freeBytes < 1GiB), disk-check catch, and
        // topic-not-found each undo the claim with a zero-success settle.
        const rollbacks = SRC.match(
            /settleUploadTrackerClaim\(uploadTracker,\s*uploadTrackerKey,\s*files\.length,\s*totalSize,\s*0,\s*0\)/g,
        );
        expect(rollbacks).not.toBeNull();
        expect(rollbacks!.length).toBe(3);
    });
});
