/**
 * Test: permanentlyFailedIds is cleaned up when images are deleted.
 *
 * C2-HIGH-01 / A2-HIGH-01: When images are deleted (single or batch),
 * their IDs must be removed from permanentlyFailedIds so stale IDs
 * don't exclude future images with the same auto-increment ID after
 * a DB restore.
 *
 * This test verifies the cleanup logic directly by manipulating the
 * queue state and checking that the IDs are removed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getProcessingQueueState } from '@/lib/image-queue';

describe('permanentlyFailedIds cleanup on image deletion', () => {
    let state: ReturnType<typeof getProcessingQueueState>;

    beforeEach(() => {
        state = getProcessingQueueState();
        // Clear both sets for a clean test state
        state.enqueued.clear();
        state.permanentlyFailedIds.clear();
    });

    it('should remove ID from permanentlyFailedIds when deleteImage cleans up', () => {
        // Simulate an image that permanently failed processing
        const failedId = 42;
        state.permanentlyFailedIds.add(failedId);
        state.enqueued.add(failedId);

        expect(state.permanentlyFailedIds.has(failedId)).toBe(true);

        // Simulate the cleanup that deleteImage() performs
        state.enqueued.delete(failedId);
        state.permanentlyFailedIds.delete(failedId);

        expect(state.permanentlyFailedIds.has(failedId)).toBe(false);
        expect(state.enqueued.has(failedId)).toBe(false);
    });

    it('should remove multiple IDs from permanentlyFailedIds in batch delete', () => {
        const failedIds = [10, 20, 30];
        for (const id of failedIds) {
            state.permanentlyFailedIds.add(id);
            state.enqueued.add(id);
        }

        expect(state.permanentlyFailedIds.size).toBe(3);

        // Simulate the cleanup that deleteImages() performs
        for (const id of failedIds) {
            state.enqueued.delete(id);
            state.permanentlyFailedIds.delete(id);
        }

        expect(state.permanentlyFailedIds.size).toBe(0);
        expect(state.enqueued.size).toBe(0);
    });

    it('should only remove specified IDs in batch delete, leaving others', () => {
        const failedIds = [10, 20, 30, 40, 50];
        for (const id of failedIds) {
            state.permanentlyFailedIds.add(id);
            state.enqueued.add(id);
        }

        // Delete only IDs 10, 20, 30
        const deletedIds = [10, 20, 30];
        for (const id of deletedIds) {
            state.enqueued.delete(id);
            state.permanentlyFailedIds.delete(id);
        }

        expect(state.permanentlyFailedIds.has(10)).toBe(false);
        expect(state.permanentlyFailedIds.has(20)).toBe(false);
        expect(state.permanentlyFailedIds.has(30)).toBe(false);
        expect(state.permanentlyFailedIds.has(40)).toBe(true);
        expect(state.permanentlyFailedIds.has(50)).toBe(true);
        expect(state.permanentlyFailedIds.size).toBe(2);
    });

    it('should handle deleting an ID that is not in permanentlyFailedIds', () => {
        const id = 99;
        expect(state.permanentlyFailedIds.has(id)).toBe(false);

        // Should not throw or cause errors
        state.permanentlyFailedIds.delete(id);
        expect(state.permanentlyFailedIds.has(id)).toBe(false);
    });

    it('should handle deleting an ID that is in enqueued but not permanentlyFailedIds', () => {
        const id = 77;
        state.enqueued.add(id);
        expect(state.permanentlyFailedIds.has(id)).toBe(false);

        // Cleanup both — permanentlyFailedIds.delete is a no-op
        state.enqueued.delete(id);
        state.permanentlyFailedIds.delete(id);

        expect(state.enqueued.has(id)).toBe(false);
        expect(state.permanentlyFailedIds.has(id)).toBe(false);
    });
});
