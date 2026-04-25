export type UploadTrackerEntry = {
    count: number;
    bytes: number;
    windowStart: number;
};

/**
 * Reconcile a pre-claimed upload quota entry against the uploads that
 * actually completed. This helper is used by uploadImages() so tests can
 * exercise the same implementation rather than duplicating the math.
 *
 * C7L-DOC-01: the third positional parameter is named `key` (not `ip`)
 * because real callers pass a composite identifier shaped like
 * `${userId}:${ip}` — see `apps/web/src/app/actions/images.ts:174`. The
 * function itself does not care about the shape; renaming the parameter
 * keeps the signature self-documenting so future callers don't accidentally
 * pass a bare IP and silently miss the user-id namespace.
 */
export function settleUploadTrackerClaim(
    tracker: Map<string, UploadTrackerEntry>,
    key: string,
    claimedCount: number,
    claimedBytes: number,
    successCount: number,
    uploadedBytes: number,
) {
    const currentEntry = tracker.get(key);
    if (!currentEntry) return;

    currentEntry.count = Math.max(0, currentEntry.count + (successCount - claimedCount));
    currentEntry.bytes = Math.max(0, currentEntry.bytes + (uploadedBytes - claimedBytes));
    tracker.set(key, currentEntry);
}
