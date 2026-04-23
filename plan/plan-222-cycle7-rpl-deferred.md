# Plan 222 — Cycle 7 RPL deferred findings

**Source review:** `.context/reviews/_aggregate-cycle7-rpl.md`

**Purpose:** record every finding that is NOT being implemented this
cycle, with exit criteria for when it would be picked up.

**Repo rule alignment:** none of these findings are security-critical,
correctness-critical, or data-loss findings that would trigger the
"NOT deferrable" clause from the orchestrator's deferred-fix rules.
Two findings (AGG7R-01 CSV bypass, AGG7R-02 restore lock leak) are
security/correctness items and are therefore being IMPLEMENTED in
plan-221, NOT deferred.

## Deferred findings (preserving original severity/confidence)

### AGG7R-05 — Unicode bidi override strip in CSV export
- **Severity:** LOW
- **Confidence:** MEDIUM
- **File:** `apps/web/src/lib/csv-escape.ts:16`
- **Reason for deferral:** being IMPLEMENTED as T7R-11 in plan-221.
- **Status:** NOT deferred (see plan-221).

### AGG7R-06 — `X-Real-IP` nginx-doc hardening
- **Severity:** LOW
- **Confidence:** MEDIUM
- **File:** `README.md`, deploy docs
- **Reason for deferral:** non-code documentation sweep. No code
  change required. Documentation-only fix can be done later.
- **Exit criterion:** nginx snippet in README explicitly uses
  `proxy_set_header X-Real-IP $remote_addr;` (overwrite) and
  `.env.local.example` includes `TRUST_PROXY=true` as commented
  example with explanation.

### AGG7R-12 — `escapeCsvField` regex pass merge
- **Severity:** LOW
- **Confidence:** MEDIUM
- **File:** `apps/web/src/lib/csv-escape.ts:15-22`
- **Reason for deferral:** micro-optimization. ~10-50ms on a 50k-row
  CSV export. Not a hot path.
- **Exit criterion:** a profiling trace shows `escapeCsvField` is
  the bottleneck in CSV export for any customer workload.

### AGG7R-14 — `FLUSH_CHUNK_SIZE` should track connection pool
- **Severity:** LOW
- **Confidence:** HIGH
- **File:** `apps/web/src/lib/data.ts:46`
- **Reason for deferral:** non-blocking; current size (20) is 2x
  pool (10). Queuing overhead is measurable only under high
  view-count flush load which doesn't happen in practice.
- **Exit criterion:** flush latency p99 exceeds 100ms sustained.

### AGG7R-15 — `purgeOldBuckets` unbatched DELETE
- **Severity:** LOW
- **Confidence:** MEDIUM
- **File:** `apps/web/src/lib/rate-limit.ts:272-275`
- **Reason for deferral:** steady-state table holds ~24h of buckets;
  GC is hourly. A multi-million-row purge would only happen if GC
  was down for days, which would indicate a different infra
  problem. Low practical risk.
- **Exit criterion:** observed GC lock time > 1s, OR gc-paused-
  multi-day operational incident.

### AGG7R-16 — CSV truncation warning UI verification
- **Severity:** LOW
- **Confidence:** MEDIUM
- **File:** admin dashboard export handler (not re-read)
- **Reason for deferral:** UI verification requires running the app
  and inspecting the export flow. Out of scope for a server-side
  cycle.
- **Exit criterion:** manual QA confirms the toast surfaces
  `csvTruncated` when row count ≥ 50 000.

### AGG7R-17 — `searchImagesAction` rate-limit UX sentinel
- **Severity:** LOW
- **Confidence:** HIGH
- **File:** `apps/web/src/app/actions/public.ts:89`
- **Reason for deferral:** changing the return type is a public API
  change that requires coordinating with client callers. Needs a
  dedicated UI task.
- **Exit criterion:** UI task tracks the discriminated-union return
  shape + consumer migration.

### AGG7R-19 — `updatePassword` session-rotation
- **Severity:** LOW
- **Confidence:** HIGH
- **File:** `apps/web/src/app/actions/auth.ts:351-364`
- **Reason for deferral:** by-design tradeoff. Keeping the admin
  logged in after password change is intentional UX. Rotating the
  current session cookie would add complexity without clear win for
  the single-admin personal-gallery target.
- **Exit criterion:** a real-world session-leak incident would
  motivate implementing rotation.

### AGG7R-20 — `cleanOrphanedTmpFiles` log level
- **Severity:** LOW
- **Confidence:** MEDIUM
- **File:** `apps/web/src/lib/image-queue.ts:42`
- **Reason for deferral:** cosmetic inconsistency. `console.info`
  for a rare cleanup event is acceptable.
- **Exit criterion:** operator reports log noise.

### AGG7R-21 — `settleUploadTrackerClaim` double-call refactor
- **Severity:** LOW
- **Confidence:** HIGH
- **File:** `apps/web/src/app/actions/images.ts:307-313`
- **Reason for deferral:** readability refactor. Current behavior is
  correct.
- **Exit criterion:** when refactoring the upload flow for a
  separate feature, unify this.

## Carry-forward from cycle-6-rpl and earlier

All items in `plan/plan-220-cycle6-rpl-deferred.md` remain deferred
with their original severity/confidence. No cycle-7 downgrade.

## Summary

9 cycle-7-rpl items deferred. 2 cycle-7-rpl items (AGG7R-01, AGG7R-02)
are MEDIUM severity and are being IMPLEMENTED this cycle (not
deferred). 10 cycle-7-rpl items are either implemented (T7R-01..T7R-11
in plan-221) or deferred here. All 21 cycle-7-rpl findings are
accounted for.
