/**
 * TE-R9C1-01 (run-9 cycle-1): behavioral coverage for upload-tracker-state.ts.
 *
 * These three functions had NO dedicated behavioral test before this file —
 * the existing `upload-tracker.test.ts` covers `settleUploadTrackerClaim` from
 * the DIFFERENT `upload-tracker.ts` module, and every consumer test mocked the
 * state module away. `hasActiveUploadClaims` is the sole guard (used at
 * `app/actions/settings.ts:70`) that blocks an `image_sizes` /
 * `strip_gps_on_upload` admin change from firing against an in-flight upload
 * (the upload-processing-contract invariant). A false-negative would silently
 * drop that safety lock, so the prune / window-reset / active-claim logic is
 * pinned here. All three functions take an injectable `now`, so the boundary
 * conditions are deterministic.
 *
 * NOTE: getUploadTracker() memoizes the Map on globalThis via
 * Symbol.for('gallerykit.uploadTracker'), so each test clears it first to avoid
 * cross-test contamination. The beforeAll handles cross-file contamination that
 * can occur under non-default Vitest pool configurations (vmThreads, singleFork)
 * where globalThis is shared between files; the beforeEach handles within-file
 * contamination under all pool models (TE-R9C3-01).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    getUploadTracker,
    hasActiveUploadClaims,
    pruneUploadTracker,
    resetUploadTrackerWindowIfExpired,
    type UploadTrackerEntry,
} from '@/lib/upload-tracker-state';

const WINDOW_MS = 60 * 60 * 1000; // mirrors UPLOAD_TRACKING_WINDOW_MS
const MAX_KEYS = 2000; // mirrors UPLOAD_TRACKER_MAX_KEYS

const NOW = 1_700_000_000_000;

function entry(windowStart: number, count = 0, bytes = 0): UploadTrackerEntry {
    return { count, bytes, windowStart };
}

beforeAll(() => {
    getUploadTracker().clear();
});

beforeEach(() => {
    getUploadTracker().clear();
});

describe('pruneUploadTracker — expiry (2x grace period)', () => {
    it('deletes an entry older than 2x the tracking window', () => {
        const tracker = getUploadTracker();
        // windowStart just past the 2x grace boundary -> expired
        tracker.set('old', entry(NOW - WINDOW_MS * 2 - 1, 1, 100));
        pruneUploadTracker(NOW);
        expect(tracker.has('old')).toBe(false);
    });

    it('keeps an entry exactly AT the 2x boundary (strict > comparison)', () => {
        const tracker = getUploadTracker();
        // now - windowStart === 2x window exactly -> NOT > 2x window -> kept
        tracker.set('edge', entry(NOW - WINDOW_MS * 2, 1, 100));
        pruneUploadTracker(NOW);
        expect(tracker.has('edge')).toBe(true);
    });

    it('keeps a fresh entry', () => {
        const tracker = getUploadTracker();
        tracker.set('fresh', entry(NOW, 1, 100));
        pruneUploadTracker(NOW);
        expect(tracker.has('fresh')).toBe(true);
    });
});

describe('pruneUploadTracker — MAX_KEYS cap eviction', () => {
    it('evicts the oldest excess entries (insertion order) down to the cap', () => {
        const tracker = getUploadTracker();
        // Insert MAX_KEYS + 3 FRESH entries (so expiry pruning is a no-op and
        // only the hard cap fires). Map preserves insertion order, so the first
        // 3 inserted are the oldest and must be evicted first.
        const total = MAX_KEYS + 3;
        for (let i = 0; i < total; i++) {
            tracker.set(`k${i}`, entry(NOW, 1, 1));
        }
        pruneUploadTracker(NOW);
        expect(tracker.size).toBe(MAX_KEYS);
        // The 3 oldest (first-inserted) keys are gone; the newest survive.
        expect(tracker.has('k0')).toBe(false);
        expect(tracker.has('k1')).toBe(false);
        expect(tracker.has('k2')).toBe(false);
        expect(tracker.has(`k${total - 1}`)).toBe(true);
    });

    it('does not evict when at or below the cap', () => {
        const tracker = getUploadTracker();
        for (let i = 0; i < MAX_KEYS; i++) {
            tracker.set(`k${i}`, entry(NOW, 1, 1));
        }
        pruneUploadTracker(NOW);
        expect(tracker.size).toBe(MAX_KEYS);
        expect(tracker.has('k0')).toBe(true);
    });
});

describe('resetUploadTrackerWindowIfExpired — 1x window boundary', () => {
    it('zeroes count/bytes and advances windowStart past 1x window', () => {
        const e = entry(NOW - WINDOW_MS - 1, 5, 5000);
        resetUploadTrackerWindowIfExpired(e, NOW);
        expect(e.count).toBe(0);
        expect(e.bytes).toBe(0);
        expect(e.windowStart).toBe(NOW);
    });

    it('leaves the entry untouched exactly AT the 1x boundary (strict > comparison)', () => {
        const e = entry(NOW - WINDOW_MS, 5, 5000);
        resetUploadTrackerWindowIfExpired(e, NOW);
        expect(e.count).toBe(5);
        expect(e.bytes).toBe(5000);
        expect(e.windowStart).toBe(NOW - WINDOW_MS);
    });
});

describe('hasActiveUploadClaims — settings-race safety guard', () => {
    it('returns true when an entry has count > 0', () => {
        getUploadTracker().set('ip', entry(NOW, 3, 0));
        expect(hasActiveUploadClaims(NOW)).toBe(true);
    });

    it('returns true when an entry has bytes > 0 (count 0)', () => {
        getUploadTracker().set('ip', entry(NOW, 0, 4096));
        expect(hasActiveUploadClaims(NOW)).toBe(true);
    });

    it('returns false when the tracker is empty', () => {
        expect(hasActiveUploadClaims(NOW)).toBe(false);
    });

    it('returns false when all entries are window-expired (reset zeroes them)', () => {
        // An entry whose window expired (>1x window) but is not yet 2x-pruned:
        // hasActiveUploadClaims runs the in-place window reset, which zeroes its
        // count/bytes, so it must NOT be counted as an active claim.
        getUploadTracker().set('stale', entry(NOW - WINDOW_MS - 1, 7, 7000));
        expect(hasActiveUploadClaims(NOW)).toBe(false);
        // and the reset persisted on the entry
        const e = getUploadTracker().get('stale');
        expect(e?.count).toBe(0);
        expect(e?.bytes).toBe(0);
    });
});
