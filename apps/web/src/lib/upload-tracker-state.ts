export type UploadTrackerEntry = {
    count: number;
    bytes: number;
    windowStart: number;
};

const uploadTrackerKey = Symbol.for('gallerykit.uploadTracker');
const UPLOAD_TRACKING_WINDOW_MS = 60 * 60 * 1000;
const UPLOAD_TRACKER_MAX_KEYS = 2000;

type UploadTrackerGlobal = typeof globalThis & {
    [uploadTrackerKey]?: Map<string, UploadTrackerEntry>;
};

export function getUploadTracker() {
    const globalWithTracker = globalThis as UploadTrackerGlobal;
    if (!globalWithTracker[uploadTrackerKey]) {
        globalWithTracker[uploadTrackerKey] = new Map<string, UploadTrackerEntry>();
    }
    return globalWithTracker[uploadTrackerKey]!;
}

/** Prune expired upload tracker entries to prevent unbounded memory growth. */
export function pruneUploadTracker(now: number = Date.now()) {
    const uploadTracker = getUploadTracker();

    // C8-MED-01: collect expired keys first, then delete in a separate pass.
    // ES6 guarantees that Map.prototype.delete() during for...of iteration is
    // safe (the iterator accounts for deletions), but the collect-then-delete
    // pattern is clearer for reviewers and matches BoundedMap.prune() (C7-MED-01).
    const expiredKeys: string[] = [];
    for (const [key, entry] of uploadTracker) {
        if (now - entry.windowStart > UPLOAD_TRACKING_WINDOW_MS * 2) {
            expiredKeys.push(key);
        }
    }
    for (const key of expiredKeys) {
        uploadTracker.delete(key);
    }

    // Hard cap: evict oldest if still over limit after expiry pruning.
    // Same collect-then-delete pattern as above.
    if (uploadTracker.size > UPLOAD_TRACKER_MAX_KEYS) {
        const excess = uploadTracker.size - UPLOAD_TRACKER_MAX_KEYS;
        const evictKeys: string[] = [];
        for (const key of uploadTracker.keys()) {
            if (evictKeys.length >= excess) break;
            evictKeys.push(key);
        }
        for (const key of evictKeys) {
            uploadTracker.delete(key);
        }
    }
}

export function resetUploadTrackerWindowIfExpired(entry: UploadTrackerEntry, now: number) {
    if (now - entry.windowStart > UPLOAD_TRACKING_WINDOW_MS) {
        entry.count = 0;
        entry.bytes = 0;
        entry.windowStart = now;
    }
}

export function hasActiveUploadClaims(now: number = Date.now()) {
    pruneUploadTracker(now);
    for (const entry of getUploadTracker().values()) {
        resetUploadTrackerWindowIfExpired(entry, now);
        if (entry.count > 0 || entry.bytes > 0) {
            return true;
        }
    }
    return false;
}
