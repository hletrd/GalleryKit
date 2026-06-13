# Deferred + Coverage Accounting — Run-5 Cycle 3

**Source:** `.context/reviews/run5-cycle3/_aggregate.md` (24 merged actionable findings + 12 already-planned pull-forward escalations).
**Coverage rule:** every one of the 24 merged findings appears in plan-324, plan-325, plan-326, OR here. Severities/confidences below are the ORIGINAL aggregate values — **never downgraded** to justify deferral.
**Repo rules consulted before deferral:** CLAUDE.md (root), AGENTS.md (via CLAUDE.md Git Workflow), `.context/` conventions, global CLAUDE.md destructive-action / latest-version rules. **No security, correctness, or data-loss finding is deferred** — the one security-class finding this cycle (AGG-R5C3-12 / SEC-R5C3-01) is SCHEDULED in plan-325 item 3, not here. The two SEC entries below (SEC-R5C3-02, TRC-R5C3-03) are an aggregator-classified dependency-log note and an architectural note respectively — neither is an open vulnerability.

---

## Coverage accounting (24 merged findings)

| Plan | Finding IDs |
|---|---|
| plan-324 (3 HIGH) | AGG-R5C3-01, -02, -03 |
| plan-325 §A/§B (MED + security LOW) | AGG-R5C3-04, -05 (+-17 folded), -06, -07, -09, -10, -12, -13, -21, -22, TRC-R5C3-04 |
| plan-326 (LOW + docs) | AGG-R5C3-11, -15, -23 + DOC-R5C3-07 + TEST-R5C3-08 short-term half |
| **plan-327 (deferred, below)** | **AGG-R5C3-08 (seeding half), -14, -16, -18, -19, -20, -24 (SEC-R5C3-02, TRC-R5C3-03)** |
| **Total** | **24/24 ✓** |

**AGG-R5C3-08 split:** the short-term half (TODO comment + plan-327 cross-reference at `e2e/public.spec.ts:125-140`) is scheduled in plan-326 Unit B; the long-term **seeding** half (seed a real share key into the e2e fixture so the 200-path spec runs) is deferred here (entry 1).
**AGG-R5C3-24 split:** it is a doc/info cluster of four sub-findings. DOC-R5C3-07 (en/ko plural convention note) is scheduled in plan-326 Unit A; TRC-R5C3-04 (applyAltSuggested truthiness guard) is scheduled in plan-325 item 7. The remaining two — SEC-R5C3-02 and TRC-R5C3-03 — are deferred here (entries 6 and 7).

---

## Deferred findings (9 entries)

### 1. AGG-R5C3-08 (seeding half) / TEST-R5C3-08 — `/s/[key]` valid-key e2e spec always skips (200 path uncovered)
- **Original severity/confidence:** MED / Med · likely (test-engineer)
- **Where:** `apps/web/e2e/public.spec.ts:125-140` (the valid-key block is gated on `E2E_SHARE_KEY`, unset in CI); the e2e fixture seed script seeds a *group* key (`/g/[key]`) but no per-photo *share* key (`/s/[key]`).
- **Reason for deferral:** the short-term safety net IS shipping this cycle — plan-326 Unit B adds a TODO comment at the skip site cross-referencing this entry, so the standing skip is documented rather than silent. Seeding a real share key requires extending the e2e fixture/seed harness (a share-link row + its key derivation) and is fixture-infrastructure work, not a one-line fix; the aggregate's own guidance is "Choose seeding if cheap; otherwise record deferral with exit criterion" — seeding is NOT cheap relative to a comment, and the 200-path is exercised by unit/route coverage today. Not security/correctness/data-loss.
- **Exit criterion:** the e2e fixture seed script is next touched for any reason, OR the `/s/[key]` route changes behaviorally → seed a deterministic share key in the fixture, export it as `E2E_SHARE_KEY` in the CI env matrix, and un-skip the 200-path spec. Track under plan-326 Unit B's TODO.

### 2. AGG-R5C3-14 / COR-R5C3-07 — `cleanOrphanedTopicTempFiles` never GCs orphaned UUID topic thumbnails
- **Original severity/confidence:** LOW / Med · likely (code-reviewer)
- **Where:** `apps/web/src/lib/process-topic-image.ts:97-108` — the cleanup filters `entries.filter(f => f.startsWith('tmp-'))` only; a committed UUID `.webp` whose `topics.image_filename` reference was later cleared (topic deleted / thumbnail replaced) is never reconciled.
- **Reason for deferral:** LOW severity; the leak rate is bounded to at most one stale thumbnail per topic-thumbnail replacement/delete (a rare admin action), not per-request. The proper fix is a startup/periodic reconciliation scan against `topics.image_filename` (mirroring the image-upload orphan-scan pattern) — a new background-job surface with its own correctness considerations (must not delete a thumbnail mid-write, must read the live topic set atomically), which is more than a drive-by change. Distinct from AGG-R5C3-01 (the *test-suite* `public/resources/` leak, fixed in plan-324 item 1); this is the *production* orphan path. Not security/correctness/data-loss.
- **Exit criterion:** evidence of unbounded `public/resources/` growth on the deploy host from real topic-thumbnail churn (operator report or `ls | wc -l` drift unexplained by test runs), OR the image-upload orphan-scan is next refactored → extend `cleanOrphanedTopicTempFiles` to reconcile committed UUID files against `topics.image_filename` in the same pass.

### 3. AGG-R5C3-16 / COR-R5C3-08 — `formatTitleAsTags` hashtags prose titles (`#Sunrise #over #the #bay`)
- **Original severity/confidence:** LOW / Med · likely (code-reviewer; the AGG-R5C2-12 open design question, re-confirmed)
- **Where:** `apps/web/src/lib/photo-title.ts` (`formatTitleAsTags`) — splits any title on whitespace and prefixes each token with `#`, so a sentence-style title becomes per-word hashtags.
- **Reason for deferral:** this is a **product-decision** item, not a defect — the aggregate explicitly says "requires confirming consumer intent." Gating tag-formatting to tag-shaped titles (vs prose) or dropping it entirely changes user-visible output and needs the consumer's intent confirmed (where is the formatted output rendered, and is hashtagging ever desired?). Shipping a behavioral guess this cycle risks regressing an intentional surface. Not security/correctness/data-loss.
- **Exit criterion:** the consumer of `formatTitleAsTags` is identified and product intent confirmed (hashtag tag-shaped titles only, or drop the helper) → implement the gated behavior with a unit test pinning prose-title vs tag-title output. Re-open as a small product-decision item next cycle.

### 4. AGG-R5C3-18 / PERF-R5C3-02 — `evictHtmlCacheIfNeeded` re-reads up to 50 full HTML bodies per over-cap write
- **Original severity/confidence:** LOW / High · confirmed (perf-reviewer)
- **Where:** `apps/web/public/sw.template.js:119-136` — on an over-cap HTML cache write, the evictor opens and `match()`es every cached entry to read its `sw-cached-at` header, materializing up to `MAX_HTML_ENTRIES` (50) full response bodies just to sort by timestamp. This is the HTML-cache twin of the image-cache meta concern.
- **Reason for deferral:** explicitly **routed as a rider onto plan-315 item 16** (the SW background-revalidate + LRU-meta rework, PERF-R5C1-07), whose scope is image-only today. Coalescing/indexing the HTML-cache eviction belongs inside that same SW restructure, not as a standalone edit to soon-rewritten code — identical reasoning to the cycle-2 deferral 4 (AGG-R5C2-36 SW meta-rewrite rider). Touching `sw.template.js` here would require regenerating + committing `public/sw.js` twice (once now, once when item 16 lands) and risks contract-test churn. Not security/correctness/data-loss.
- **Exit criterion:** plan-315 item 16 (SW rework) is implemented → fold the HTML-cache eviction into the same LRU-meta scheme (store `sw-cached-at` in a side meta document or per-URL meta entry so eviction sorts without reading bodies). The item-16 spec inherits this HTML-cache rider.

### 5. AGG-R5C3-19 / PERF-R5C3-03 — backfill re-decodes every original a second time for `detectColorSignals`
- **Original severity/confidence:** LOW / High · confirmed (perf-reviewer)
- **Where:** `apps/web/src/lib/admin-backfill-runner.ts:295-337` (calls `detectColorSignals` separately from `processImageFormats`, decoding the source a second time); the sidecar `apps/web/scripts/backfill-color-pipeline.ts` mirrors the same double-decode.
- **Reason for deferral:** the fix — thread the color-signal detection OUT of `processImageFormats` so it returns alongside `wasDownscaled`/`avif10bit` and the backfill reuses the single decode — touches the encoder's return contract, which is constrained by **WI-14** (per-format fresh `sharp(inputPath, …)` to eliminate shared-state cross-format contamination). Verifying that the threaded-out detection does not reintroduce the WI-14 contamination class requires care and a full-gallery re-encode cost measurement to justify the contract change; the aggregate's own guidance is "verify WI-14 constraint; or defer with exit criterion (full-gallery re-encode cost evidence)." Backfill is a rare admin maintenance op, so the doubled decode is invisible in normal operation. Not security/correctness/data-loss.
- **Exit criterion:** full-gallery backfill latency is measured on a production-scale gallery and the double-decode is shown to dominate runtime, OR `processImageFormats` is next refactored for another reason → thread `detectColorSignals` output through the encoder return value (both the in-app runner and the sidecar) with a WI-14 cross-format-contamination regression test, applied to both entry points together.

### 6. AGG-R5C3-20 / PERF-R5C3-04 — semantic scan allocates ~15k short-lived objects/request at stub scale
- **Original severity/confidence:** LOW / Med · confirmed (perf-reviewer)
- **Where:** the semantic-search scan path (`apps/web/src/app/api/search/semantic/route.ts` + the stub scorer it calls) allocates a short-lived object per candidate row on every request.
- **Reason for deferral:** the aggregate routes this explicitly as "no action at stub scale — pin to the production-encoder milestone." `semantic_search_mode` ships as `disabled`/`stub` only (the production CLIP encoder is US-P51 stub work, not shipped); at stub scale the candidate set is tiny and the allocation is noise. Optimizing object churn for a code path that is about to be replaced by the real encoder is premature. Not security/correctness/data-loss.
- **Exit criterion:** the production semantic-search encoder milestone (US-P51) lands and `semantic_search_mode` gains a `production` value that scans real candidate volumes → profile the scan under production load; if allocation pressure is shown to matter, switch to a pre-allocated/streaming scorer at that time.

### 7. AGG-R5C3-24 (TRC-R5C3-03 half) — sized-derivative mid-ladder visibility (architectural note)
- **Original severity/confidence:** LOW · architectural note (tracer; "no action")
- **Where:** the sized-derivative serving ladder (`serve-upload.ts` / the `_NNN.{avif,webp,jpg}` derivative selection) — the tracer noted that a mid-ladder derivative size's visibility/selection is an architectural observation, not a defect.
- **Reason for deferral:** the reporting tracer agent itself classified this as **"architectural note, no action"** — it is recorded for provenance, not as open work. There is no acceptance signal to verify against and no behavioral change requested. Not security/correctness/data-loss.
- **Exit criterion:** a future change to the derivative-size ladder (adding/removing a size, or changing the selection heuristic) revisits this note to confirm mid-ladder visibility is still correct. No standalone work scheduled.

### 8. AGG-R5C3-24 (SEC-R5C3-02 half) — npm audit: 2 moderate transitive `postcss` advisories via the Next toolchain
- **Original severity/confidence:** LOW · dependency-log note (security-reviewer; "not exploitable")
- **Where:** dependency tree — transitive `postcss` pulled in by the Next.js build toolchain (`npm audit` reports 2 moderate advisories).
- **Reason for deferral (security finding — repo-rule justification):** the reporting security agent itself classified this as **"not exploitable; record in dependency log, do NOT `audit fix --force`."** This is the same residual already documented in run-5 cycle-1 (`plan-317` verified-non-issues table: SEC-R5C1-03 — "transitive `postcss` moderate CVE via Next's tree; runtime exposure ~nil; track Next releases"). Running `npm audit fix --force` would forcibly bump a build-time transitive against Next's resolved tree and risks breaking the toolchain (a destructive dependency action per the global CLAUDE.md latest-version/destructive rules) for a non-runtime, non-exploitable advisory. The honest action is to record it and track upstream, not to mask it with a forced override. **This is a traceability/dependency-log note, not an open vulnerability.**
- **Exit criterion:** a Next.js release ships that resolves the transitive `postcss` to a patched version → adopt it via the normal latest-version upgrade path (the project already runs latest-Next per global rules), which clears the advisory without `--force`. Re-open as implementation work only if the advisory is ever reclassified as runtime-reachable.

### 9. plan-315 items NOT pulled forward into this cycle (owner unchanged — `plan-315-run5-cycle1-medium.md`)
- **Original severity/confidence:** as recorded per-item in `plan-315-run5-cycle1-medium.md` (MED/HIGH-risk security & correctness & test-surface items) — **not downgraded here.**
- **Scope:** This cycle pulled FORWARD plan-315 items **1, 14, 17, 18, 19** (security/correctness/migration-guard/test escalations) and the cheap designer-CSS items **25, 26, 27, 30, 31, 33** into plan-325. Item **6** was completed in run-5 cycle-2 (commit fc4abdcd). The following plan-315 items are **NOT pulled forward this cycle** and **retain their original plan-315 ownership and original severity**:
  - **Item 2** — SEC-R5C1-01: OG route trusted-origin derivation (M). Owner: plan-315. (Cross-referenced in `_aggregate.md` "already-planned" table under "OG Host-steering"; unchanged owner.)
  - **Item 3** — SEC-R5C1-02: PAT failed-verification audit + rate accounting (S). Owner: plan-315. (Cross-referenced under "PAT audit"; unchanged owner.)
  - **Item 4** — TRC-R5C1-14: document the GPS-strip guarantee scope (S, doc/UI). Owner: plan-315.
  - **Item 5** — TRC-R5C1-15: download-token re-issue admin action (M). Owner: plan-315.
  - **Item 7** — TRC-R5C1-17: pin the `affectedRows` claim shape (S). Owner: plan-315 (`_aggregate.md` lists TEST-R5C3-06 "pull forward when budget allows" — NOT this cycle).
  - **Item 8** — BUG-R5C1-01: fixture-test the 10-bit AVIF reject fallback (M). Owner: plan-315.
  - **Item 9** — BUG-R5C1-03: RIFF-walk WebP ICC verification (M). Owner: plan-315.
  - **Item 10** — BUG-R5C1-04: pin TZ stability (S). Owner: plan-315.
  - **Item 11** — BUG-R5C1-05: EXIF-rational output for exposures ≥ 1 s (S). Owner: plan-315.
  - **Item 12** — ARCH-R5C1-02: view-event retention (M, depends on plan-315 item 7 indexes). Owner: plan-315.
  - **Item 13** — ARCH-R5C1-03: geoip-lite deployment robustness (M). Owner: plan-315.
  - **Item 15** — PERF-R5C1-03: zero-cost embedding hook when disabled (S). Owner: plan-315.
  - **Item 16** — PERF-R5C1-07: un-block SW cached-image serving + LRU-meta rework (M). Owner: plan-315. (Also carries the AGG-R5C3-18 HTML-cache rider — entry 4 above.)
  - **Item 20** — TEST-R5C1-10: minimum public e2e specs (M). Owner: plan-315. (Partially advanced by plan-326's `/s/[key]` TODO, but the broad spec set stays plan-315.)
  - **Item 21** — TEST-R5C1-11: paid-download GET→POST claim e2e (L). Owner: plan-315.
  - **Item 22** — TEST-R5C1-13: Stripe webhook behavioral tests (M). Owner: plan-315 (`_aggregate.md`: "pull forward when budget allows" — NOT this cycle).
  - **Item 23** — DES-R5C1-06: search.tsx redundant aria-label / mobile backdrop (S). Owner: plan-315.
  - **Item 24** — DES-R5C1-07: keyboard-shortcut hint visibility (S). Owner: plan-315.
  - **Item 28** — DES-R5C1-11: conditionally render hidden viewer subtree while lightbox open (M). Owner: plan-315.
  - **Item 29** — DES-R5C1-12: info-bottom-sheet peek-state tap-to-dismiss backdrop (M). Owner: plan-315.
  - **Item 32** — DES-R5C1-15: reduced-motion belt-and-suspenders for `.lightbox-image` (S). Owner: plan-315.
- **Reason for deferral:** these are not NEW cycle-3 findings — they are the existing plan-315 backlog. The aggregate pulled forward only the HIGH-risk escalations (migration-journal guard, advisory-lock pins, upload-paths tests, wrong-scope 401, TriState guard) and the cheapest designer-CSS wins where multiple lanes re-confirmed live risk. The remaining plan-315 items keep their owner per the index ("Remaining items keep plan-315 ownership") and are bounded by the same repo policy; deferring the per-cycle pull-forward keeps each cycle's diff reviewable rather than re-opening 21 aging items at once. **No severity downgrade** — each item's plan-315 entry is authoritative.
- **Exit criterion:** per-item, as recorded in `plan-315-run5-cycle1-medium.md`. A future cycle's aggregate re-escalates any of these (as cycle-3 did for items 1/14/17/18/19) when a lane re-confirms live risk, OR budget allows clearing the backlog. The HIGH-risk security items (2, 3, 5) should be prioritized in the next pull-forward pass.

---

## Already-planned cross-references (recorded by agents; owners unchanged)

Per `_aggregate.md` § "ALREADY-PLANNED — pull-forward escalations" — these were re-confirmed open at HEAD but are NOT new findings:

| This-cycle observation | Owner | Status this cycle |
|---|---|---|
| TEST-R5C3-02: migration-journal monotonicity guard still uncreated | plan-315 item 14 | **PULLED FORWARD** → plan-325 item 12 |
| TEST-R5C3-03: only 1/5 advisory-lock constants pinned | plan-315 item 19 (+plan-322 rider) | **PULLED FORWARD** → plan-325 item 13 |
| TEST-R5C3-04: upload-paths behavioral tests missing | plan-315 item 17 | **PULLED FORWARD** → plan-325 item 14 |
| TEST-R5C3-05: withAdminAuth wrong-scope→401 untested | plan-315 item 18 | **PULLED FORWARD** → plan-325 item 15 |
| COR cross-ref: bulkUpdateImages TriState guard | plan-315 item 1 | **PULLED FORWARD** → plan-325 item 16 |
| DES-R5C3-02/-03/-05/-06/-07: cheap designer CSS | plan-315 items 25/26/27/30/31/33 | **PULLED FORWARD** → plan-325 items 17-19 |
| TEST-R5C3-10: stripe webhook behavioral tests | plan-315 item 22 | deferred (entry 9 above; "budget allows") |
| TEST-R5C3-06: download affectedRows-shape pin | plan-315 item 7 | deferred (entry 9 above; "budget allows") |
| DOC-R5C3-01/-03/-04/-05: ETag formula / cache() list / site-config path / blur 4KB | plan-316 VER-R5C1-01 / DOC-R5C1-05/-03/-24 | **PULLED FORWARD** → plan-326 Unit A |
| OG Host-steering / PAT audit / seo-og-url | plan-315 items 2-3, plan-316 Unit D | unchanged owners (entry 9 above) |
| SW HEAD-probe blocking + LRU meta rework | plan-315 item 16 (+AGG-R5C3-18 HTML rider) | unchanged owner (entry 4 above) |
| Backfill candidate index / analytics indexes | plan-322 entries 1-3 | unchanged (needs-EXPLAIN; plan-322) |

---

## Explicitly NOT invented here

No new work was added under the deferred label. Every entry above maps 1:1 to an aggregate finding ID (or, for entry 9, to existing plan-315 line items with their original severities preserved). Deferred work, when picked up, remains bound by repo policy: GPG-signed commits (`git commit -S`), conventional commits + gitmoji, migration runbook for any index addition, fine-grained commit-and-push per change, full gate run, per-cycle deploy.
