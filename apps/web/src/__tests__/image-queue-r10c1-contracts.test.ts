import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Run-10 cycle-1 image-queue robustness contracts (C1-04, C1-06, C1-19).
 *
 * - C1-04 (TRC-01): claim exhaustion must persist a distinguishable
 *   processing_error + failed_at (admin panel visibility + bootstrap-scan
 *   exclusion via isNull(processing_error)) and track the id as permanently
 *   failed, instead of silently re-enqueueing the same job forever. The
 *   RELEASE_LOCK failure path must log at error level (a leaked advisory lock
 *   on a live pooled session durably wedges future claims).
 * - C1-06 (PERF-01): bootstrapMissingActiveEmbeddings launches must be deduped
 *   by an in-flight guard so overlapping bootstrap invocations cannot stack
 *   concurrent full scans into the shared CLIP inference queue.
 * - C1-19 (TRC-02): the expected delete-race FK rejection of the un-awaited
 *   embedding write logs at debug, not warn.
 */

const queuePath = path.join(__dirname, '..', 'lib', 'image-queue.ts');
const queueSource = fs.readFileSync(queuePath, 'utf8');

describe('C1-04: claim exhaustion surfaces to the admin', () => {
    const giveUpIdx = queueSource.indexOf('failed to acquire claim');
    const giveUpRegion = queueSource.slice(giveUpIdx, giveUpIdx + 1600);

    it('persists processing_error and failed_at on claim exhaustion', () => {
        expect(giveUpIdx).toBeGreaterThan(-1);
        expect(giveUpRegion).toMatch(/permanentlyFailedIds\.add\s*\(\s*job\.id\s*\)/);
        expect(giveUpRegion).toMatch(/processing_error:/);
        expect(giveUpRegion).toMatch(/failed_at:\s*toMySqlDateTime\s*\(/);
        // Conditional UPDATE — never stomp a row another worker just processed.
        expect(giveUpRegion).toMatch(/eq\s*\(\s*images\.processed,\s*false\s*\)/);
    });

    it('logs RELEASE_LOCK failures at error level, not debug', () => {
        const releaseCatchIdx = queueSource.indexOf('Failed to release lock for job');
        expect(releaseCatchIdx).toBeGreaterThan(-1);
        const around = queueSource.slice(releaseCatchIdx - 200, releaseCatchIdx + 100);
        expect(around).toMatch(/console\.error/);
        expect(around).not.toMatch(/console\.debug\s*\(\s*`\[Queue\] Failed to release lock/);
    });
});

describe('C1-06: missing-embedding retry scan is deduped', () => {
    it('declares the in-flight guard on the queue state', () => {
        expect(queueSource).toMatch(/embeddingBootstrapInFlight\?:\s*Promise<void>\s*\|\s*null/);
    });

    it('skips launching a new scan while one is in flight and clears the guard when done', () => {
        expect(queueSource).toMatch(/if\s*\(\s*!state\.embeddingBootstrapInFlight\s*\)/);
        expect(queueSource).toMatch(/\.finally\s*\(\s*\(\)\s*=>\s*\{\s*\n?\s*state\.embeddingBootstrapInFlight\s*=\s*null;/);
    });
});

describe('C1-19: expected delete-race FK rejection is not warn-level noise', () => {
    it('routes missing-image FK errors to debug and keeps real failures at warn', () => {
        expect(queueSource).toMatch(/function isMissingImageFkError/);
        expect(queueSource).toMatch(/ER_NO_REFERENCED_ROW_2/);
        const catchIdx = queueSource.indexOf('Failed to store embedding for image ${job.id}');
        expect(catchIdx).toBeGreaterThan(-1);
        const around = queueSource.slice(catchIdx - 800, catchIdx + 200);
        expect(around).toMatch(/isMissingImageFkError\s*\(\s*embedErr\s*\)/);
        expect(around).toMatch(/console\.debug/);
        expect(around).toMatch(/console\.warn/);
    });
});
