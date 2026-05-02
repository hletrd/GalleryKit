# Aggregate Review — Cycle 12 (2026-04-30)

## Review agents that returned

1. **code-reviewer** (`c12-code-reviewer.md`) — 5 findings
2. **security-reviewer** (`c12-security-reviewer.md`) — 4 findings
3. **perf-reviewer** (`c12-perf-reviewer.md`) — 3 findings
4. **test-engineer** (`c12-test-engineer.md`) — 3 findings
5. **architect-debugger** (`c12-architect-debugger.md`) — 3 findings
6. **designer-critic** (`c12-designer-critic.md`) — 3 findings
7. **verifier** (`c12-verifier.md`) — 4 findings

## AGENT FAILURES

None — all review agents completed successfully.

---

## Deduplicated findings (sorted by severity, then by cross-agent agreement)

### MEDIUM severity

#### C12-MED-01: ~~`restoreDatabase` missing `endRestoreMaintenance()` on error paths~~ — FALSE POSITIVE
- **Sources**: C12-CR-01 (Medium/Medium), C12-CR-02 (Medium/Medium), C12-SR-01 (Medium/High), C12-TE-01 (Medium/High), C12-AD-01 (Medium/High), C12-VF-01 (Medium/High)
- **6 agents agreed** — but the finding is a FALSE POSITIVE
- **File+line**: `apps/web/src/app/[locale]/admin/db-actions.ts:293-329`
- **Resolution**: VERIFIED FALSE POSITIVE. JavaScript `finally` blocks execute before `return` in the enclosing `try`. The `catch` at line 326-328 returns early, but the inner `finally` at line 332-345 (which calls `endRestoreMaintenance()`) runs BEFORE that `return` completes. The other early returns (line 298: upload contract lock failure, line 319: `beginRestoreMaintenance()` returning false) occur BEFORE `beginRestoreMaintenance()` sets the flag or when the flag was already set by another caller. The existing code is correct.
- **Lesson**: 6 reviewers missed JavaScript `finally` semantics — `finally` blocks execute before the enclosing `try`/`catch` `return` completes.

### LOW severity

#### C12-LOW-01: Lightbox `alt` attribute falls back to UUID-based filename
- **Sources**: C12-DC-03 (Low/Medium), C12-VF-04 (Low/Low)
- **2 agents agree**
- **File+line**: `apps/web/src/components/lightbox.tsx:309`
- **Issue**: The lightbox `<img>` tag uses `alt={image.title ?? image.filename_jpeg ?? ''}`. When `image.title` is null (default for uploaded images), the fallback is a UUID-based filename like `abc12345_2048.jpg` which is not meaningful for screen reader users. The photo viewer uses `getConcisePhotoAltText()` which falls back to tags or "Photo". The lightbox should use the same accessible alt text logic.
- **Fix**: Import `getConcisePhotoAltText` and use it for the alt text, or pass the computed alt text from the parent component.
- **Confidence**: Medium

#### C12-LOW-02: `exportImagesCsv` uses `results = [] as typeof results` pattern for GC hint
- **Sources**: C12-CR-03 (Low/Low)
- **File+line**: `apps/web/src/app/[locale]/admin/db-actions.ts:98`
- **Issue**: The type-asserted reassignment pattern is misleading. A block scope or `results.length = 0` would be clearer.
- **Fix**: Cosmetic — consider scoping or `length = 0`.
- **Confidence**: Low

#### C12-LOW-03: `image-queue.ts` `bootstrapContinuationScheduled` flag could remain set if PQueue `onIdle` never resolves
- **Sources**: C12-AD-03 (Low/Low)
- **File+line**: `apps/web/src/lib/image-queue.ts:423-437`
- **Issue**: If the PQueue `onIdle` promise never resolves, the continuation flag stays set and subsequent bootstrap attempts are skipped. The `bootstrapRetryTimer` provides a partial fallback. Theoretical risk at personal-gallery scale.
- **Fix**: Consider a timeout on `onIdle()`. Low priority.
- **Confidence**: Low

#### C12-LOW-04: `proxy.ts` middleware cookie format check accepts 3-part tokens with empty fields
- **Sources**: C12-SR-02 (Low/Low), also C11-LOW-01
- **File+line**: `apps/web/src/proxy.ts:87`
- **Issue**: Already deferred as C11-LOW-01. No security impact. Confirming validity.
- **Fix**: Already deferred.

#### C12-LOW-05: Photo viewer info sidebar collapse clips content without fade
- **Sources**: C12-DC-01 (Low/Medium), also C11-LOW-05
- **File+line**: `apps/web/src/components/photo-viewer.tsx:426-429`
- **Issue**: Already deferred as C11-LOW-05. Confirming validity.
- **Fix**: Already deferred.

#### C12-LOW-06: Admin navigation does not indicate active page
- **Sources**: C12-DC-02 (Low/Low), also C11-LOW-06
- **File+line**: `apps/web/src/components/admin-nav.tsx`
- **Issue**: Already deferred as C11-LOW-06. Confirming validity.
- **Fix**: Already deferred.

## Previously fixed findings (confirmed still fixed from cycles 1-11)

All previously fixed items from the cycle 11 aggregate remain fixed:
- A1-HIGH-01: Login rate-limit rollback — FIXED
- A1-HIGH-02: Image queue infinite re-enqueue — FIXED
- C7-HIGH-01: deleteAdminUser advisory lock scoped per-user — FIXED
- C7-MED-01: BoundedMap.prune() collect-then-delete — FIXED
- C7-MED-05: claimRetryCounts cleanup on permanentlyFailedIds eviction — FIXED
- C8-MED-01: uploadTracker prune collect-then-delete — FIXED
- C8-MED-02: searchImages GROUP BY comment — FIXED
- C10-LOW-01: isNotNull(capture_date) guards in buildCursorCondition — FIXED
- C10-LOW-02: isNull() in getImage undated branches — FIXED
- C10-LOW-03: Clean queue retry maps on image deletion — FIXED
- C11-MED-01: Topic existence check in uploadImages — FIXED (verified by C12-VF-02)
- C11-MED-02: permanentlyFailedIds check in enqueueImageProcessing — FIXED (verified by C12-VF-03)

## Deferred items carried forward (no change)

All items from plan-370 (cycle 11 deferred) remain deferred:
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
- C11-LOW-01: proxy.ts middleware cookie format check
- C11-LOW-03: bootstrapImageProcessingQueue calls cleanOrphanedTmpFiles on every continuation
- C11-LOW-04: pruneRetryMaps does not check permanentlyFailedIds size
- C11-LOW-05: photo-viewer.tsx info sidebar collapse clips content without fade
- C11-LOW-06: admin-nav.tsx navigation items don't indicate active page
- C11-LOW-07: db-restore.ts re-exports MAX_RESTORE_FILE_BYTES under different name

## Summary statistics

- Total findings across all agents: 25 (before dedup)
- Deduplicated findings: 6 new + 7 carried-forward confirmations
- MEDIUM severity: 1 (C12-MED-01 — 6-agent consensus)
- LOW severity: 5 new + 7 confirmations of prior deferred items
- Cross-agent agreement (2+ agents): 2 findings (C12-MED-01, C12-LOW-01)
