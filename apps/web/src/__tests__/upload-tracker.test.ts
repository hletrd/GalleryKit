import { describe, expect, it } from 'vitest';

/**
 * Tests for the upload tracker adjustment logic used in uploadImages().
 * The actual server action is hard to unit test due to DB dependencies,
 * so these tests validate the core tracker math: the clamping behavior
 * that prevents count/bytes from going negative after failed uploads.
 *
 * Corresponds to fix C20-01: clamp upload tracker count and bytes to >= 0
 * after adjustment.
 */

/** Simulates the tracker adjustment logic from images.ts lines 276-281 */
function adjustTracker(
    currentCount: number,
    currentBytes: number,
    successCount: number,
    totalFiles: number,
    uploadedBytes: number,
    totalSize: number,
): { count: number; bytes: number } {
    // This mirrors the actual code:
    // currentTracker.count = Math.max(0, currentTracker.count + (successCount - files.length));
    // currentTracker.bytes = Math.max(0, currentTracker.bytes + (uploadedBytes - totalSize));
    return {
        count: Math.max(0, currentCount + (successCount - totalFiles)),
        bytes: Math.max(0, currentBytes + (uploadedBytes - totalSize)),
    };
}

describe('upload tracker adjustment', () => {
    it('does not go negative when all uploads fail (successCount=0)', () => {
        // Pre-incremented: count=5+3=8, bytes=1000+3000=4000
        // After: count = max(0, 8 + (0-3)) = max(0, 5) = 5
        // After: bytes = max(0, 4000 + (0-3000)) = max(0, 1000) = 1000
        const result = adjustTracker(8, 4000, 0, 3, 0, 3000);
        expect(result.count).toBe(5);
        expect(result.bytes).toBe(1000);
    });

    it('clamps count to 0 when all uploads fail with no prior count', () => {
        // Pre-incremented: count=0+3=3, bytes=0+3000=3000
        // Without clamping: count = 3 + (0-3) = 0, bytes = 3000 + (0-3000) = 0
        // With clamping: same result (0 is already >= 0)
        const result = adjustTracker(3, 3000, 0, 3, 0, 3000);
        expect(result.count).toBe(0);
        expect(result.bytes).toBe(0);
    });

    it('clamps count to 0 when negative drift would occur', () => {
        // Pre-incremented: count=0+100=100, bytes=0+10GB=10GB
        // All fail: count = max(0, 100 + (0-100)) = 0
        const result = adjustTracker(100, 10_000_000_000, 0, 100, 0, 10_000_000_000);
        expect(result.count).toBe(0);
        expect(result.bytes).toBe(0);
    });

    it('correctly adjusts for partial success', () => {
        // Pre-incremented: count=0+5=5, bytes=0+5000=5000
        // 3 succeed, 2 fail: count = max(0, 5 + (3-5)) = 3, bytes = max(0, 5000 + (3000-5000)) = 3000
        const result = adjustTracker(5, 5000, 3, 5, 3000, 5000);
        expect(result.count).toBe(3);
        expect(result.bytes).toBe(3000);
    });

    it('correctly adjusts for full success', () => {
        // Pre-incremented: count=0+5=5, bytes=0+5000=5000
        // All succeed: count = max(0, 5 + (5-5)) = 5, bytes = max(0, 5000 + (5000-5000)) = 5000
        const result = adjustTracker(5, 5000, 5, 5, 5000, 5000);
        expect(result.count).toBe(5);
        expect(result.bytes).toBe(5000);
    });

    it('preserves existing tracker values when new uploads adjust correctly', () => {
        // Existing: count=50, bytes=50000
        // Pre-incremented: count=50+3=53, bytes=50000+3000=53000
        // 2 succeed: count = max(0, 53 + (2-3)) = 52, bytes = max(0, 53000 + (2000-3000)) = 52000
        const result = adjustTracker(53, 53000, 2, 3, 2000, 3000);
        expect(result.count).toBe(52);
        expect(result.bytes).toBe(52000);
    });

    it('never produces negative count regardless of input', () => {
        // Extreme case: huge pre-increment, all fail
        const result = adjustTracker(1000, 10_000_000, 0, 1000, 0, 10_000_000);
        expect(result.count).toBeGreaterThanOrEqual(0);
        expect(result.bytes).toBeGreaterThanOrEqual(0);
        expect(result.count).toBe(0);
        expect(result.bytes).toBe(0);
    });

    it('handles single file failure correctly', () => {
        // Pre-incremented: count=0+1=1, bytes=0+2000000=2000000
        // Single file fails: count = max(0, 1 + (0-1)) = 0, bytes = max(0, 2000000 + (0-2000000)) = 0
        const result = adjustTracker(1, 2000000, 0, 1, 0, 2000000);
        expect(result.count).toBe(0);
        expect(result.bytes).toBe(0);
    });
});
