# Architect & Debugger Review — Cycle 13 (architect-debugger)

## Review Scope
Architectural risks, coupling, latent bugs, failure modes, race conditions.

## Findings

### C13-AD-01: `data.ts` approaching 1250 lines — god module risk
- **File+line**: `apps/web/src/lib/data.ts`
- **Severity**: Low | **Confidence**: Medium
- **Issue**: Already deferred as D3-MED / D2-MED in prior cycles. The file contains view-count buffering, image listing, search, SEO settings, cursor pagination, and privacy field definitions. All are related to data access but the file size makes it hard to navigate. This is an architectural concern, not a bug.
- **Fix**: Already deferred.

### C13-AD-02: `viewCountBuffer` swap-then-drain pattern could lose increments during flush
- **File+line**: `apps/web/src/lib/data.ts:71-72`
- **Severity**: Low | **Confidence**: Low
- **Issue**: The swap pattern (`const batch = viewCountBuffer; viewCountBuffer = new Map()`) is correct for preventing data loss during flush. New increments go to the fresh Map while the old one is drained. The `isFlushing` flag prevents concurrent flushes. This is a well-designed pattern.
- **Fix**: No fix needed.

### C13-AD-03: `bootstrapContinuationScheduled` flag could remain set if PQueue `onIdle` never resolves
- **File+line**: `apps/web/src/lib/image-queue.ts:423-437`
- **Severity**: Low | **Confidence**: Low
- **Issue**: Already noted as C12-LOW-03. The `onIdle()` promise has a `.catch()` that resets the flag, but no timeout. If the PQueue hangs, the flag stays set and subsequent bootstrap attempts are skipped. The `bootstrapRetryTimer` provides a partial fallback.
- **Fix**: Already deferred.

### C13-AD-04: `processImageFormats` called without try/catch in queue worker — but outer catch exists
- **File+line**: `apps/web/src/lib/image-queue.ts:296-304`
- **Severity**: Low | **Confidence**: Low
- **Issue**: `processImageFormats` is called inside the queue worker's try block. If it throws, the outer catch (line 337) handles the error and retries. This is correct. However, if `processImageFormats` throws a non-Error value, the `console.error` on line 338 would log it without a stack trace. This is a minor robustness concern.
- **Fix**: Consider logging with `String(err)` fallback for non-Error throws.

### C13-AD-05: `createAdminUser` uses `requireCleanInput` for username but `stripControlChars` for password
- **File+line**: `apps/web/src/app/actions/admin-users.ts:90-92`
- **Severity**: Low | **Confidence**: Low
- **Issue**: The username uses `requireCleanInput` which rejects if sanitization changes the value. The password uses `stripControlChars` which silently strips. This asymmetry is intentional — passwords may contain characters that look like control characters but are intentional (e.g., pasted passwords with special characters). The comment on line 89 explains this.
- **Fix**: No fix needed — the design is correct.

## Summary
- Total findings: 5 (2 carried forward, 3 observations)
- All LOW severity
- No new architectural risks or latent bugs found
