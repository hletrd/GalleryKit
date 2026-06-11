# Deferred + Disproven — Run-5 Cycle 2

**Source:** `.context/reviews/run5-cycle2/_aggregate.md` (48 merged actionable findings). Coverage rule: every merged finding appears in plan-319/320/321 or here. Severities/confidences below are ORIGINAL aggregate values — never downgraded to justify deferral. Repo rules consulted before deferral: CLAUDE.md (root), AGENTS.md (via CLAUDE.md Git Workflow section), `.context/` conventions. No security/correctness/data-loss finding is deferred.

**Coverage accounting (48 merged findings):**
- plan-319: 6 (AGG-R5C2-01..06)
- plan-320: 13 (AGG-R5C2-07..19, incl. the doc-half of AGG-R5C2-11)
- plan-321: 25 (AGG-R5C2-20..23 MED-doc + AGG-R5C2-30, 32, 33, 37..54 LOW)
- deferred (below): 4 (AGG-R5C2-31, 34, 35, 36 + the index-tuning half of AGG-R5C2-11)
- Total: 6 + 13 + 25 + 4 = 48 ✓ (AGG-R5C2-11 split: doc-comment scheduled in plan-320 item 13; index re-order deferred here)

---

## Deferred findings (4 + 1 split-half)

### 1. AGG-R5C2-34 / PERF-R5C2-02 — backfill candidate scan lacks `pipeline_version` index
- **Original severity/confidence:** LOW / High · confirmed (perf-reviewer)
- **Where:** `apps/web/src/lib/admin-backfill-runner.ts:164-176`; `apps/web/scripts/backfill-color-pipeline.ts`; schema gap `apps/web/src/db/schema.ts:113-118`
- **Reason for deferral:** invisible at personal-gallery scale; the finding itself says "Defer until there's evidence" — adding an index to the hottest table for a rare admin operation is write-amplification without proof. Not security/correctness/data-loss.
- **Exit criterion:** large-gallery (≥100k images) backfill latency observed, or operator report of slow sparse-stale runs → add `(processed, pipeline_version, id)` composite via the migration runbook.

### 2. AGG-R5C2-35 / PERF-R5C2-03 — `getTopPhotosByViews` has no supporting `(bot, viewed_at, image_id)` index
- **Original severity/confidence:** LOW / Med · needs-manual-validation (EXPLAIN on seeded data)
- **Where:** `apps/web/src/lib/analytics-data.ts:28-54`
- **Reason for deferral:** classified needs-manual-validation by the reporting agent; index changes on the hot analytics INSERT path require EXPLAIN evidence first (same discipline as deferred PERF-R5C1-04/-06).
- **Exit criterion:** EXPLAIN on a seeded ≥1M-row `image_views` table shows full scan + temp table on the admin analytics page, or the page appears in slow-query logs → add `(bot, viewed_at, image_id)` and `(bot, viewed_at)` on topic/shared view tables together, after measuring write amplification.

### 3. AGG-R5C2-11 (index-tuning half) / PERF-R5C2-01 — `'all'`-window GROUP BY loose-scan optimization
- **Original severity/confidence:** MED / High · confirmed — but explicitly "not a regression; strict improvement over no-index; safe to ship and tune later"
- **Where:** `apps/web/src/db/schema.ts:232-233`; `apps/web/drizzle/0021_*.sql`
- **Reason for deferral:** the reporting agent's own fix guidance: "Do NOT add four indexes to a high-INSERT analytics table without measuring write amplification first"; the windowed (default) case is fully served by the shipped index. The doc-comment half IS scheduled (plan-320 item 13).
- **Exit criterion:** view-event retention (plan-315 item 12) lands AND EXPLAIN evidence shows the `'all'` window spilling temp tables at production scale → consider `(bot, country_code)` / `(bot, referrer_host)` replacements.

### 4. AGG-R5C2-36 / PERF-R5C2-04 — SW `recordAndEvict` full-meta-document rewrite per cache write
- **Original severity/confidence:** LOW / High · confirmed (pre-existing)
- **Where:** `apps/web/public/sw.template.js:77-117`
- **Reason for deferral:** rider on already-planned plan-315 item 16 (PERF-R5C1-07 SW background-revalidate rework) — coalescing meta writes belongs inside that same rework, not as a standalone change to soon-restructured code.
- **Exit criterion:** implemented together with plan-315 item 16; the item's spec now includes "coalesce/batch LRU meta writes (per-paint debounce or per-URL meta entries)".

### 5. AGG-R5C2-31 / SEC-R5C2-02 — OG fallback 302 relies on write-time validator
- **Original severity/confidence:** LOW / Med · likely-covered-by-planned-work (security-reviewer's own verdict: "Recommend [treating as covered by SEC-R5C1-04] and close")
- **Where:** `apps/web/src/app/api/og/photo/[id]/route.tsx:246-258`
- **Reason for deferral (security finding — repo-rule justification):** the reporting security agent itself classified this as fully covered by already-planned plan-316 SEC-R5C1-04 (seo-og-url validator hardening) with "no independent action required"; admin-only writer under the documented single-trust-level admin model (CLAUDE.md: "no role/capability separation"). This is a traceability note, not an open vulnerability; the planned validator hardening is the fix of record.
- **Exit criterion:** plan-316 SEC-R5C1-04 ships; if its implementation does NOT cover scheme assertions, add the emit-time `https://`-or-relative assert then.

---

## Disproven during aggregation (1)

### BUG-R5C2-06 — "retryFailedImage double-wraps a Response in `{ error: }`"
- **Original severity/confidence:** MED / Med · likely (debugger)
- **Evidence of non-issue (aggregator-verified 2026-06-12):** `apps/web/src/lib/action-guards.ts:37` — `requireSameOriginAdmin(): Promise<string | null>` returns a localized STRING, and its docblock prescribes exactly the caller pattern used at `images.ts:1044-1045` (`if (originError) return { error: originError }`). Independently verified correct by code-reviewer, security-reviewer, verifier, and critic. No action.

---

## Already-planned cross-references (recorded by agents; owners unchanged)

| This-cycle ID | Already planned as | Note |
|---|---|---|
| TEST-R5C2-07 | plan-315 item 14 | migration-journal vitest guard — still not created; plan-315 owns it |
| TEST-R5C2-06 | plan-315 item 19 | RIDER added: pin ALL 5 lock constants + `getImageProcessingLockName`, not only LOCK_ADMIN_DELETE |
| VER-R5C2-01 / DOC-R5C2-10 | plan-316 DOC-R5C1-03 | site-config path in Deployment Checklist |
| DOC-R5C2-07 | plan-316 VER-R5C1-03 | SESSION_SECRET min-length note |
| COR-R5C2-05 | plan-316 Unit C (COR-R5C1-02) | IP-literal referrer hosts — fresh IPv6 trace recorded |
| PERF-R5C2-05 / PERF-R5C2-06 | — | reporting agent's own verdict: no action (verified safe / bounded); listed for provenance only |
| COR-R5C2-07 | — | reporting agent's own verdict: confirmed intentional non-issue (badge aria-hidden footprint) |

## Explicitly NOT invented here

No new work added under the deferred label. Every entry maps 1:1 to an aggregate finding ID. Deferred work, when picked up, remains bound by repo policy: GPG-signed commits (`git commit -S`), conventional commits + gitmoji, migration runbook for any index addition, fine-grained commit-and-push per change.
