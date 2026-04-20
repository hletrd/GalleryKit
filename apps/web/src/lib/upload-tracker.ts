export type UploadTrackerEntry = {
    count: number;
    bytes: number;
    windowStart: number;
};

/**
 * Reconcile a pre-claimed upload quota entry against the uploads that
 * actually completed. This helper is used by uploadImages() so tests can
 * exercise the same implementation rather than duplicating the math.
 */
export function settleUploadTrackerClaim(
    tracker: Map<string, UploadTrackerEntry>,
    ip: string,
    claimedCount: number,
    claimedBytes: number,
    successCount: number,
    uploadedBytes: number,
) {
    const currentEntry = tracker.get(ip);
    if (!currentEntry) return;

    currentEntry.count = Math.max(0, currentEntry.count + (successCount - claimedCount));
    currentEntry.bytes = Math.max(0, currentEntry.bytes + (uploadedBytes - claimedBytes));
    tracker.set(ip, currentEntry);
}
