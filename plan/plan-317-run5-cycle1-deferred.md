# Deferred + Verified Non-Issues — Run-5 Cycle 1

**Source:** `.context/reviews/_aggregate.md` (93 merged findings). Coverage rule: every indexed finding appears in plan-501/502/503 or here. Severities/confidences below are the ORIGINAL aggregate values — never downgraded by this planner.

**Coverage accounting (all 93 indexed findings):**
- plan-501: 18 IDs (17 items; COR-R5C1-04 folded into item 3)
- plan-502: 35 IDs (33 items; TRC-R5C1-01/PERF-R5C1-11 folded into item 15, COR-R5C1-05 into item 16)
- plan-503: 33 IDs (5 work units)
- deferred (below): 6 IDs
- verified non-issue during planning (below): 1 ID (DES-R5C1-02)
- Total: 18 + 35 + 33 + 6 + 1 = **93** ✓

---

## Deferred findings (6)

### 1. PERF-R5C1-05 (+ARCH-R5C1-07) — `revalidate = 0` on every public page
- **Original severity/confidence:** MED / Med · needs-manual-validation · 2 agents (perf-reviewer, architect)
- **Where:** every `apps/web/src/app/[locale]/(public)/**/page.tsx`; `apps/web/src/db/index.ts:19-21` (pool 10 / queue 20)
- **Reason for deferral:** This is the explicitly documented product trade-off. CLAUDE.md, Performance Optimizations:
  > "**Public route freshness**: public photo, topic, shared, and home pages currently set `revalidate = 0` so asynchronous image processing and metadata updates are visible immediately; admin pages remain dynamic. Reintroduce ISR only with an explicit invalidation/freshness plan"
  Flipping it requires the very invalidation audit the doc demands (all mutation paths must call narrow `revalidateLocalizedPaths`; PERF-R5C1-12 re-audit rider) — a design task, not a fix.
- **Exit criterion:** a dedicated ISR-reintroduction plan (mutation-path invalidation audit + chosen `revalidate` windows per route, or an nginx micro-cache decision), OR production evidence of pool saturation (connection-queue rejections in logs / a real traffic spike incident). Re-open as its own plan, not a line item.

### 2. PERF-R5C1-04 — `getTopics` correlated `MAX(updated_at)` subquery per topic row
- **Original severity/confidence:** MED / Med · likely (latent; bounded by ISR-cached sitemap consumer)
- **Where:** `apps/web/src/lib/data.ts:448-469`; consumer `/sitemap.xml` at `revalidate=3600`
- **Reason for deferral:** The finding itself concludes "No action required today — keep on the radar." Blast radius is one sitemap regeneration per hour; not security/correctness/data-loss.
- **Exit criterion:** sitemap generation appears in slow-query logs or exceeds ~1 s on a production-scale gallery; then apply the covering index `(topic, processed, updated_at)` or the single `GROUP BY topic` join from the finding.

### 3. PERF-R5C1-06 — `getImage` prev/next 4-way OR predicate vs index range scan
- **Original severity/confidence:** MED / Med · **needs-manual-validation** (EXPLAIN on a large seeded table required)
- **Where:** `apps/web/src/lib/data.ts:954-1057`
- **Reason for deferral:** needs-manual-validation per aggregate; invisible at current scale. Rewriting the hottest route's adjacency SQL to row-comparator tuples without first capturing the EXPLAIN baseline risks a correctness regression (NULL-capture-date branch) for an unproven win.
- **Exit criterion:** manual validation in a later cycle — seed ≥100k images in dev, EXPLAIN both adjacency SELECTs; if index-merge/full-range confirmed, schedule the `(capture_date, created_at, id)` tuple rewrite with before/after EXPLAIN evidence.

### 4. TRC-R5C1-02 — SW ETag-format mismatch across static/route-handler crossover
- **Original severity/confidence:** LOW / Med · **needs-manual-validation**
- **Where:** `apps/web/public/sw.js:44-50, 222`; CLAUDE.md serving-precedence note
- **Reason for deferral:** Edge case requiring a reproduced layer-flip (file materializing in `public/` after first dynamic serve). The plan-502 item 16 SW rework (background revalidate + same-ETag-200-as-304) changes the probe economics anyway — validate after that lands to avoid testing soon-dead code.
- **Exit criterion:** manual validation in a later cycle, AFTER plan-502 item 16 ships: reproduce a backfill/restore layer flip and observe whether affected cached entries thrash; if real, treat any 200-with-body probe response as the new cache entry.

### 5. TRC-R5C1-13 — Failed restore ends maintenance in `finally`; bootstrap runs against possibly inconsistent DB
- **Original severity/confidence:** LOW / Med · **needs-manual-validation** (recoverable via bootstrap retry)
- **Where:** `apps/web/src/lib/image-queue.ts:673-714`; `db-actions.ts` restore finally
- **Reason for deferral:** The failure mode is recoverable (bootstrap SELECT fails into `scheduleBootstrapRetry`) and the proposed fix — keeping maintenance mode latched after a failed restore until explicit admin acknowledgment — is a product/UX decision that can strand the site in maintenance if the admin misses the prompt. Needs a deliberate design, not a drive-by change to the restore path (historically bug-prone per C7R-RPL-02 lineage).
- **Exit criterion:** manual validation in a later cycle: simulate a corrupt-dump mid-restore failure in dev; measure the retry-loop noise window; then decide latch-vs-current with the evidence in hand.

### 6. DES-R5C1-24 — 12 px EXIF labels at ~6.1:1 contrast
- **Original severity/confidence:** LOW / High · confirmed — aggregate verdict: "passes AA, **no fix strictly required**"
- **Where:** `apps/web/src/components/photo-viewer.tsx:852-855`; same pattern in info-bottom-sheet EXIF grid
- **Reason for deferral:** WCAG AA compliant today; the finding explicitly marks the fix optional. Pure polish with no acceptance signal to verify against.
- **Exit criterion:** low-vision user feedback, or a future design pass raising the gallery-wide minimum label size — then bump size/contrast in both EXIF grids together.

---

## Verified non-issues (planner-verified during this pass) (1)

### DES-R5C1-02 — "Password form submit button renders 40 px — below the 44 px floor"
- **Original severity/confidence:** HIGH / High · confirmed (designer)
- **Where claimed:** `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:108`
- **Evidence of non-issue (planner-verified 2026-06-11):** the claim assumes shadcn default `h-10` (40 px). This repo's `apps/web/src/components/ui/button.tsx` floors EVERY size variant at ≥44 px (R4C15/OBS-R4C14-A, documented in CLAUDE.md Touch-Target Audit):
  ```
  default: "min-h-11 px-4 py-2 has-[>svg]:px-3",   // button.tsx:24 — 44 px
  sm:      "min-h-11 rounded-md gap-1.5 px-3 …",   // :25
  lg:      "min-h-12 rounded-md px-6 …",           // :26
  icon:    "size-11",                              // :27
  ```
  The password form's `<Button type="submit">` uses the default variant → renders `min-h-11` = 44 px. The finding's own hedge ("If ui/button.tsx variant floors apply here…reconcile") resolves to: floors apply. CLAUDE.md: "`ui/button.tsx` now floors every size variant at ≥ 44 px (`min-h-11`/`size-11`/`min-h-12`/`size-12`), so these hits are 44 px-compliant at runtime today". No code change; the touch-target audit fixture already covers a future variant downgrade.
- **No action.** (Cosmetic parity with login-form's explicit `h-11` is optional and not scheduled.)

---

## Verified non-issues / documented-intentional (aggregate-classified, provenance preserved) (23)

These were classified by the contributing agents themselves and recorded in the aggregate's DOCUMENTED-INTENTIONAL / VERIFIED NON-ISSUES table. Not part of the 93 indexed findings; listed here so the next review cycle does not re-litigate them.

| ID | Agent | Verdict |
|---|---|---|
| COR-R5C1-03 | code-reviewer | accepted trade-off — `TWO_PART_TLDS` lightweight eTLD+1 approximation, documented in-file |
| COR-R5C1-08 | code-reviewer | verified NON-issue — upload-tracker pre-claim ordering traced sound; contract lock always released |
| SEC-R5C1-03 | security-reviewer | accepted residual — transitive `postcss` moderate CVE via Next's tree; runtime exposure ~nil; track Next releases |
| SEC-R5C1-05 | security-reviewer | documented opt-in — `LOG_PLAINTEXT_DOWNLOAD_TOKENS` is the documented manual-fulfillment interim (see plan-502 item 5 for the re-issue mitigation) |
| SEC-R5C1-06 | security-reviewer | by-design — public analytics in-memory per-IP caps correct for documented single-writer topology |
| PERF-R5C1-08 | perf-reviewer | known, mitigated — `searchImages` LIKE scans rate-capped; FULLTEXT is the documented escape hatch (R2C11-LOW-06) |
| PERF-R5C1-09 | perf-reviewer | fine at realistic scale — per-group view-count UPDATEs chunked/atomic/retry-capped |
| PERF-R5C1-12 | perf-reviewer | no action at 2 locales — `revalidateLocalizedPaths` O(paths×locales); RE-AUDIT if ISR returns (rider on deferred PERF-R5C1-05) |
| TRC-R5C1-03 | tracer | documented acceptable — settings-hash 5 s SWR window on serve-upload ETags |
| TRC-R5C1-04 | tracer | intentional design — middleware cookie check is UX redirect; crypto gate is per-action `verifySessionToken` |
| TRC-R5C1-05 | tracer | known design choice — no session rotation; consistent with documented "Permanently Deferred: 2FA/WebAuthn" posture |
| TRC-R5C1-06 | tracer | acceptable — React `cache()` per-request session memo can't see same-request revocation; not exploitable |
| TRC-R5C1-07 | tracer | documented — `sharedGroups.view_count` buffered counter lossy on SIGKILL; CLAUDE.md: "best-effort approximate analytics" |
| TRC-R5C1-08 | tracer | intentional — fire-and-forget analytics insert swallows FK errors; analytics-only |
| TRC-R5C1-09 | tracer | verified protected — `image_sizes` TOCTOU serialized by `LOCK_UPLOAD_PROCESSING_CONTRACT` |
| TRC-R5C1-10 | tracer | documented gap — `image_sizes` change requires backfill; lock-once + CLAUDE.md documents it |
| TRC-R5C1-11 | tracer | verified handled — delete-while-processing cleans its own derivatives (CLAUDE.md Race Condition Protections) |
| TRC-R5C1-12 | tracer | verified correct — restore-vs-upload interlock fails fast `uploadSettingsLocked` |
| TRC-R5C1-19 | tracer | not a vulnerability — `bulkUpdateImages` origin-before-isAdmin order: both checks present (planner re-read :871-874 — comment documents the order as the standard pattern; no normalization needed) |
| TRC-R5C1-20 | tracer | intentional conservative — `x-gk-admin-render` on cookie PRESENCE; under-caching is the safe direction |
| TRC-R5C1-21 | tracer | verified correct — SW `isSensitiveResponse` scoping |
| DES-R5C1-25 | designer | handled globally — hover-overlay transition suppressed by globals.css reduced-motion blanket |
| DOC-R5C1-10 | document-specialist | unscored, likely correct — `SHARP_CONCURRENCY` comment matches Sharp's documented behavior |

**Verified-clean sweeps:** the aggregate additionally records 24/28 CLAUDE.md claims verified exact by verifier, 9 more by document-specialist, and clean sweeps by code-reviewer / perf-reviewer / debugger across locks, privacy guards, Stripe idempotency, bounded maps, and queue races. See `_aggregate.md` § "Verified-clean sweeps" for the list.

---

## Explicitly NOT invented here

No new work was added under the deferred label. Every entry above maps 1:1 to an aggregate finding ID.
