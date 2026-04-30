# Plan 370 — Cycle 11: Deferred findings

## Origin

Cycle 11 review findings that are explicitly deferred per the plan directory rules.

## C11-LOW-01-DEFER (Low): `proxy.ts` middleware cookie format check accepts 3-part tokens with empty fields

- **File+line**: `apps/web/src/proxy.ts:87`
- **Original severity/confidence**: Low / Low
- **Reason for deferral**: The middleware check is a fast-path filter, not a security boundary. The full `verifySessionToken` validates each part (timestamp is finite, HMAC comparison with timing-safe equality). A token with empty parts would fail verification and redirect to login — the only waste is an extra redirect round-trip. Adding per-part length checks would make the middleware slightly more precise but adds maintenance burden for zero security benefit.
- **Exit criterion**: When the middleware is refactored to share validation logic with `verifySessionToken`, or when a concrete performance issue from spurious redirects is observed.

## C11-LOW-02-DEFER (Low): `getImageByShareKey` sequential tag query creates minor timing side-channel

- **File+line**: `apps/web/src/lib/data.ts:868-909`
- **Original severity/confidence**: Low / Low-Medium
- **Reason for deferral**: Already deferred as C6F-06 in prior cycles. The share key has 57 bits of entropy (10-char base56), making brute-force impractical. The timing difference is negligible (<1ms). Fixing this requires refactoring to a JOIN or subquery approach which is a larger change.
- **Exit criterion**: When C6F-06 is picked up for implementation (parallel tag query refactor).

## C11-LOW-03-DEFER (Low): `bootstrapImageProcessingQueue` calls `cleanOrphanedTmpFiles()` on every continuation pass

- **File+line**: `apps/web/src/lib/image-queue.ts:496-497`
- **Original severity/confidence**: Low / Medium
- **Reason for deferral**: The cleanup is idempotent (no .tmp files after the first scan). The `fs.readdir()` cost is ~10-30ms per call, which is negligible compared to the bootstrap batch processing. Adding a flag adds code complexity for minimal benefit at personal-gallery scale.
- **Exit criterion**: When the bootstrap is refactored for horizontal scaling, or when .tmp file accumulation is observed in production logs.

## C11-LOW-04-DEFER (Low): `pruneRetryMaps` does not check `permanentlyFailedIds` size

- **File+line**: `apps/web/src/lib/image-queue.ts:89-101`
- **Original severity/confidence**: Low / Medium
- **Reason for deferral**: The `permanentlyFailedIds` set has its own cap (`MAX_PERMANENTLY_FAILED_IDS = 1000`) with FIFO eviction at insertion time. The set can momentarily exceed the cap by at most 1 entry (the entry being added). At personal-gallery scale, the set rarely approaches capacity. Adding a prune check would add code complexity for negligible benefit.
- **Exit criterion**: When the queue is refactored for horizontal scaling, or when the permanently-failed set approaches capacity in production.

## C11-LOW-05-DEFER (Low): `photo-viewer.tsx` info sidebar collapse clips content without fade

- **File+line**: `apps/web/src/components/photo-viewer.tsx:426-429`
- **Original severity/confidence**: Low / Medium
- **Reason for deferral**: The current collapse animation is functional — content is clipped by `overflow-hidden` during the 500ms width transition. Adding an opacity fade would improve the UX but is a visual polish, not a correctness or accessibility issue. The fix is low-risk but requires careful testing to avoid layout shift during the animation.
- **Exit criterion**: When the photo viewer is next refactored for animation improvements, or when a user reports the clipping as visually distracting.

## C11-LOW-06-DEFER (Low): `admin-nav.tsx` navigation items don't indicate active page

- **File+line**: `apps/web/src/components/admin-nav.tsx`
- **Original severity/confidence**: Low / Low
- **Reason for deferral**: The admin navigation works functionally — admins can navigate between sections. Adding an active indicator requires tracking the current route in the client component, which adds state management complexity. The admin is a keyboard-primary surface where the lack of visual indicator has minimal impact on usability.
- **Exit criterion**: When the admin layout is refactored for mobile support, or when an admin reports navigation confusion.

## C11-LOW-07-DEFER (Low): `db-restore.ts` re-exports `MAX_RESTORE_FILE_BYTES` under a different name

- **File+line**: `apps/web/src/lib/db-restore.ts:1-3`
- **Original severity/confidence**: Low / Low
- **Reason for deferral**: The re-export exists for semantic clarity in the restore context (`MAX_RESTORE_SIZE_BYTES` is more descriptive than `MAX_RESTORE_FILE_BYTES`). Adding a comment explaining the alias would be sufficient but is a cosmetic documentation change with no functional impact.
- **Exit criterion**: When the restore module is next modified, or when a contributor reports confusion about the naming.

## Carry-forward of prior deferred items

All prior deferred items from plan-368 (cycle 10) and earlier remain valid and deferred with no change in status:

- C9-TE-03-DEFER: `buildCursorCondition` cursor boundary test coverage
- C7-MED-02: uploadTracker prune/evict duplicates BoundedMap pattern
- C7-MED-04: searchImages GROUP BY lists all columns — fragile under schema changes
- C7-LOW-04: Health route DB probe lacks timing info
- C7-LOW-05: CSP style-src-attr/style-src-elem split
- C7-LOW-06: admin-users.ts deleteAdminUser lock release on error paths
- D1-MED: No CSP header on API route responses
- D1-MED: getImage parallel queries / UNION optimization
- D2-MED: data.ts approaching 1500-line threshold
- D1-MED: CSV streaming
- D2-MED: auth patterns inconsistency
- D3-MED: data.ts god module
- D4-MED: CSP unsafe-inline
- D5-MED: getClientIp "unknown" without TRUST_PROXY
- D6-MED: restore temp file predictability
- D7-LOW: process-local state
- D8-LOW: orphaned files
- D9-LOW: env var docs
- D10-LOW: oversized functions
- D11-LOW: lightbox auto-hide UX
- D12-LOW: photo viewer layout shift
- C5F-02: sort-order condition builder consolidation
- C6F-06: getImageByShareKey parallel tag query
