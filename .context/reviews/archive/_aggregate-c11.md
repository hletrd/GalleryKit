# Aggregate Review — Cycle 11 (2026-04-30)

## Review agents that returned

1. **code-reviewer** (`c11-code-reviewer.md`) — 3 findings
2. **security-reviewer** (`c11-security-reviewer.md`) — 2 findings
3. **perf-reviewer** (`c11-perf-reviewer.md`) — 1 finding
4. **test-engineer** (`c11-test-engineer.md`) — 2 findings
5. **architect-debugger** (`c11-architect-debugger.md`) — 2 findings
6. **designer-critic** (`c11-designer-critic.md`) — 2 findings

## AGENT FAILURES

None — all review agents completed successfully.

---

## Deduplicated findings (sorted by severity, then by cross-agent agreement)

### MEDIUM severity

#### C11-MED-01: `uploadImages` does not validate topic exists in DB before inserting images
- **Sources**: C11-CR-01 (Medium/High), C11-TE-01 (Medium/High)
- **2 agents agree** — highest signal finding this cycle
- **File+line**: `apps/web/src/app/actions/images.ts:230-237`
- **Issue**: The function validates topic slug format with `isValidSlug(topic)` but never checks that the topic actually exists in the `topics` table. If an admin deletes a topic while another admin has the upload form open, images are inserted with an orphaned `topic` slug. The image appears in the gallery but topic-level features (label, order, image_filename) fail silently. The schema uses `varchar` without a FK constraint on `images.topic`.
- **Fix**: Add a `SELECT 1 FROM topics WHERE slug = ?` check before the file processing loop. Return an error if the topic is not found.
- **Confidence**: High

#### C11-MED-02: `enqueueImageProcessing` does not check `permanentlyFailedIds` before adding a job
- **Sources**: C11-AR-01 (Medium/Medium), C11-TE-02 (Medium/Medium)
- **2 agents agree**
- **File+line**: `apps/web/src/lib/image-queue.ts:206-220`
- **Issue**: When a claim-retry timer fires (line 247), it calls `enqueueImageProcessing(job)`. The function checks `state.enqueued.has(job.id)` and `state.shuttingDown` but does NOT check `state.permanentlyFailedIds.has(job.id)`. If the image was marked as permanently failed between the claim failure and the retry timer, the job is re-enqueued and attempts processing, wasting a DB query and advisory lock attempt. The claim-check query (line 254-258) catches this, so it's not a correctness bug — just wasted work.
- **Fix**: Add `if (state.permanentlyFailedIds.has(job.id)) return;` at the top of `enqueueImageProcessing`, after the `state.shuttingDown` check.
- **Confidence**: Medium

### LOW severity

#### C11-LOW-01: `proxy.ts` middleware cookie format check accepts 3-part tokens with empty fields
- **Sources**: C11-SR-01 (Medium/Low)
- **File+line**: `apps/web/src/proxy.ts:87`
- **Issue**: `token.split(':').length !== 3` passes for tokens like `::abc`. The full `verifySessionToken` validates each part, so the middleware check is only a fast-path filter. No security impact — just a slightly wasteful redirect.
- **Fix**: Add a minimum-length check per part. Low priority.
- **Confidence**: Low

#### C11-LOW-02: `getImageByShareKey` sequential tag query creates minor timing side-channel
- **Sources**: C11-SR-02 (Low/Low-Medium)
- **File+line**: `apps/web/src/lib/data.ts:868-909`
- **Issue**: Already noted as C6F-06 in deferred items (parallel tag query). Confirming validity — the sequential query creates a minor timing difference between "valid key" and "invalid key" responses. The 57-bit key entropy makes brute-force impractical.
- **Fix**: Already deferred as C6F-06. No new finding.

#### C11-LOW-03: `bootstrapImageProcessingQueue` calls `cleanOrphanedTmpFiles()` on every continuation pass
- **Sources**: C11-PR-01 (Low/Medium)
- **File+line**: `apps/web/src/lib/image-queue.ts:496-497`
- **Issue**: The cleanup runs on every bootstrap call including continuation passes. For a large backlog, this means repeated `fs.readdir()` on 3 directories. Idempotent but wasteful.
- **Fix**: Add a flag to skip cleanup on continuation passes, or move cleanup to the GC interval.
- **Confidence**: Low

#### C11-LOW-04: `pruneRetryMaps` does not check `permanentlyFailedIds` size
- **Sources**: C11-CR-02 (Low/Medium)
- **File+line**: `apps/web/src/lib/image-queue.ts:89-101`
- **Issue**: `pruneRetryMaps` handles `retryCounts` and `claimRetryCounts` but not `permanentlyFailedIds`. The `permanentlyFailedIds` set has its own cap but is only pruned at insertion time (one-at-a-time). Could momentarily exceed the cap during rapid failures.
- **Fix**: Add a size check for `permanentlyFailedIds` in the GC interval or `pruneRetryMaps`.
- **Confidence**: Low

#### C11-LOW-05: `photo-viewer.tsx` info sidebar collapse clips content without fade
- **Sources**: C11-CT-01 (Low/Medium)
- **File+line**: `apps/web/src/components/photo-viewer.tsx:426-429`
- **Issue**: When `showInfo` transitions to false, the sidebar width animates from 350px to 0 with `overflow-hidden`, clipping the content visually. Adding an opacity transition would improve the UX.
- **Fix**: Add `opacity-0` / `opacity-100` transition alongside the width transition.
- **Confidence**: Medium

#### C11-LOW-06: `admin-nav.tsx` navigation items don't indicate active page
- **Sources**: C11-CT-02 (Low/Low)
- **File+line**: `apps/web/src/components/admin-nav.tsx`
- **Issue**: The admin sidebar doesn't visually distinguish the currently active page.
- **Fix**: Add `aria-current="page"` and a visual active indicator.
- **Confidence**: Low

#### C11-LOW-07: `db-restore.ts` re-exports `MAX_RESTORE_FILE_BYTES` under a different name
- **Sources**: C11-CR-03 (Low/Low)
- **File+line**: `apps/web/src/lib/db-restore.ts:1-3`
- **Issue**: `MAX_RESTORE_FILE_BYTES` is re-exported as `MAX_RESTORE_SIZE_BYTES`. Naming inconsistency.
- **Fix**: Add a comment explaining the alias, or use the same name.
- **Confidence**: Low

## Previously fixed findings (confirmed still fixed from cycles 1-10)

All previously fixed items from the cycle 8 aggregate remain fixed:
- A1-HIGH-01: Login rate-limit rollback — FIXED
- A1-HIGH-02: Image queue infinite re-enqueue — FIXED
- C7-HIGH-01: deleteAdminUser advisory lock scoped per-user — FIXED
- C7-MED-01: BoundedMap.prune() collect-then-delete — FIXED
- C7-MED-05: claimRetryCounts cleanup on permanentlyFailedIds eviction — FIXED
- C8-MED-01: uploadTracker prune collect-then-delete — FIXED
- C8-MED-02: searchImages GROUP BY comment — FIXED (C10-LOW-02 added the comment)
- C10-LOW-01: isNotNull(capture_date) guards in buildCursorCondition — FIXED
- C10-LOW-02: isNull() in getImage undated branches — FIXED
- C10-LOW-03: Clean queue retry maps on image deletion — FIXED

## Deferred items carried forward (no change)

All items from plan-368 (cycle 10 deferred) remain deferred:
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

## Summary statistics

- Total findings across all agents: 12 (before dedup)
- Deduplicated findings: 9
- MEDIUM severity: 2
- LOW severity: 7
- Cross-agent agreement (2+ agents): 2 findings (C11-MED-01, C11-MED-02)
