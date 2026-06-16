# Plan 353 — Run 6 / Cycle 3 — Deferred Findings

**Source:** `.context/reviews/_aggregate.md` (cycle 3, HEAD b1e9e0da) + per-agent reviews.
**Status:** DEFERRED REGISTER (no implementation this cycle).

Per the review-plan-fix deferred-fix rules: every review finding NOT scheduled in `plan-352` is recorded here with file+line citation, **original** severity/confidence (NOT downgraded to justify deferral), concrete deferral reason, and the exit criterion that re-opens it. The "deferred" list is only for existing review findings — no new refactors/features introduced under this label.

**Repo-rule basis for deferral:** CLAUDE.md documents the single-writer / single-instance topology as an explicit design constraint ("do not horizontally scale the web service unless those coordination states are moved to a shared store"), and explicitly retains `@/lib/storage` as an un-wired future abstraction ("Do not document or expose S3/MinIO switching as a supported admin feature until the upload/processing/serving pipeline is wired end-to-end"). Perf micro-optimizations on bounded/admin-only paths and additional test coverage are not security/correctness/data-loss items and are deferrable. None of the deferred items below are security, correctness, or data-loss defects that the repo's rules forbid deferring; the two security-tagged items (AGG-C3-31 operational secret-rotation, AGG-C3-32 defense-in-depth scanner) are explicitly defense-in-depth/operational, not exploitable code defects at HEAD (security-reviewer rated overall risk LOW, 0 Critical/0 High).

---

## DEFERRED — latent bugs (bounded, framework-only triggers)

### AGG-C3-08 — Orphaned `original/{uuid}` file on ungraceful kill mid-upload
- **Severity/Confidence:** LOW / High (tracer D1).
- **Citation:** `apps/web/src/app/actions/images.ts:280` (original write) → `:382` (DB INSERT); sweep `image-queue.ts:32-73` covers only webp/avif/jpeg `.tmp`.
- **Reason for deferral:** Disk-bloat only. The file is never served (not in a public-served dir's served set), never referenced (no DB row), and the UUID name cannot collide. Requires a SIGKILL/OOM in a narrow synchronous window. Not a correctness or data-loss defect.
- **Exit criterion:** Re-open if production disk-usage telemetry shows `original/` orphan accumulation, OR when the startup orphan sweep is next touched (extend it to remove `original/*` files with no matching DB row).

### AGG-C3-09 — Upload-tracker quota claim not released in outer `finally`
- **Severity/Confidence:** LOW / Medium (debugger DBG-L1, re-assessed down from prior HIGH).
- **Citation:** `apps/web/src/app/actions/images.ts:251-253` (claim), `:490/:512` (settle inside outer try), `:538-540` (finally releases only contract lock).
- **Reason for deferral:** The settlement path is reachable only by a throw escaping the per-file inner try/catch (`:271-481`), which catches every realistic per-file fault and `continue`s — i.e. framework-level failure only. Effect is a quota over-count until the window expires (admin self-impact), no data loss / security impact.
- **Exit criterion:** Re-open if quota-exhaustion-without-uploads is observed in production, OR fold the fix (move both settlements into `finally` behind a `let settled` guard) into the next change touching `uploadImages`.

---

## DEFERRED — performance (admin-only / deliberate tradeoff / micro-opt)

### AGG-C3-10 — `process-image.ts` metadata decode discarded for sRGB sources
- **Severity/Confidence:** LOW-MED / Medium (perf-reviewer PERF-C3-01).
- **Citation:** `apps/web/src/lib/process-image.ts:1019-1022`.
- **Reason for deferral:** Pure perf; zero correctness change. Worth doing but lower-value than the cycle's scheduled fixes; a backfill-time CPU optimization. Touching the hot encode path carries regression risk that warrants its own focused change + test.
- **Exit criterion:** Re-open when next optimizing the encode path or running a large backfill where the wasted decode is measurable; gate the `metadata()` read behind `isWideGamutSource`.

### AGG-C3-11 — Admin dashboard grid OFFSET pagination
- **Severity/Confidence:** LOW / Medium (perf-reviewer PERF-C3-03).
- **Citation:** `apps/web/src/lib/data.ts:915-937`, caller `dashboard/page.tsx:16`.
- **Reason for deferral:** Admin-only path, page-clamped to 1000. Bounded; not a public hot path. Migrating to keyset cursors is a non-trivial change to an admin surface.
- **Exit criterion:** Re-open if admin galleries exceed ~50k images and dashboard latency is reported, OR when the admin grid is next reworked.

### AGG-C3-12 — SW per-tile HEAD ETag probe on warm-cache display path
- **Severity/Confidence:** LOW / Medium (perf-reviewer PERF-C3-02).
- **Citation:** `apps/web/public/sw.js:233-257` (probe), `:38` (300ms AbortSignal timeout).
- **Reason for deferral:** Deliberate color-freshness guarantee (backfill rewrites bytes under unchanged filenames, so the HEAD probe catches stale derivatives), already bounded by a 300ms timeout. An age-floor mitigation is optional and must not regress the freshness contract.
- **Exit criterion:** Re-open if slow-network INP regression is measured on masonry scroll; add an age-floor (skip re-probe for entries cached < 60s) or `effectiveType` gate without weakening freshness.

### AGG-C3-13 — Misc perf LOWs (filesort / unindexed / correlated subquery / re-render thrash)
- **Severity/Confidence:** LOW / Medium (perf-reviewer LOW batch).
- **Citation:** feed `ORDER BY updated_at` filesort (`data.ts:771-794`); `getFailedImages` unindexed+unLIMITed (`data.ts:940-954`); `getTopics` correlated subquery (`data.ts:452-473`); touch-swipe `setSwipeOffset`/touchmove re-render (`photo-navigation.tsx:93`); wheel-handler `getBoundingClientRect` read-then-write (`image-zoom.tsx:103,110`).
- **Reason for deferral:** Micro-optimizations; admin-only or low-frequency surfaces. No user-visible impact at current scale.
- **Exit criterion:** Re-open per-item if profiling flags any as a real bottleneck (e.g. `getFailedImages` if the failed-images admin view grows large; touch-swipe if INP regresses on mobile).

---

## DEFERRED — architecture / structural

### AGG-C3-14 — `@/lib/storage` is fully-built dead weight
- **Severity/Confidence:** HIGH (structural) / High (architect A1).
- **Citation:** `apps/web/src/lib/storage/` (390 LOC, zero importers; `index.ts:25` single-member union makes `switchStorageBackend` a no-op).
- **Reason for deferral — QUOTED REPO RULE (CLAUDE.md):** "The `@/lib/storage` module still exists as an internal abstraction, but the product currently supports local filesystem storage only. Do not document or expose S3/MinIO switching as a supported admin feature until the upload/processing/serving pipeline is wired end-to-end." The module is intentionally retained as a future abstraction; deletion vs. wiring is an explicit roadmap decision the repo has made, not a defect to fix mid-loop. (Note: it re-implements path-traversal containment that also lives in `upload-paths.ts`/`serve-upload.ts` — a divergence trap to watch.)
- **Exit criterion:** Re-open when storage backends become a roadmap item — at that point either wire it end-to-end OR delete it (and consolidate the duplicated path-containment logic).

### AGG-C3-15 — Restore-maintenance flag process-local while restore lock server-scoped
- **Severity/Confidence:** HIGH (architect A2) — but critic REFUTED the data-corruption framing to "bounded" / Medium.
- **Citation:** `db-actions.ts:290` (`LOCK_DB_RESTORE`), `:302` (`LOCK_UPLOAD_PROCESSING_CONTRACT`, server-scoped, held across the whole restore window) vs `restore-maintenance.ts` (process-local boolean).
- **Reason for deferral — QUOTED REPO RULE (CLAUDE.md):** "The shipped Docker Compose deployment is a single web-instance / single-writer topology. Restore maintenance flags, upload quota tracking, and image queue state are process-local; do not horizontally scale the web service unless those coordination states are moved to a shared store." critic confirmed the server-scoped upload-contract lock causes 2nd-instance writes to **block** (not corrupt) during a restore. The corruption scenario requires violating the documented single-instance topology.
- **Exit criterion:** Re-open IF horizontal scaling of the web service is ever attempted — add a startup single-instance advisory lock as a guardrail and move coordination state to a shared store.

### AGG-C3-16 — `reconcileLegacySchema` hand-maintained schema mirror
- **Severity/Confidence:** MEDIUM (architect A3) / High; critic MINOR-2 confirms the residual (name-only tripwire can't catch ALTER/MODIFY/constraint changes on an existing column).
- **Citation:** `apps/web/scripts/migrate.js` (366-line reconcile fn, post-condition `:709-718` checks journal hashes not column production); existing mitigation `migrate-reconcile-coverage.test.ts:106-123`.
- **Reason for deferral:** The migration machinery is robust and fails loud on skipped journal hashes; the residual gap (a SQL migration adding a column/index that the mirror forgets, invisible on fresh/CI DBs) is already documented verbatim in the coverage test and mitigated by a name-only tripwire + manual fresh-DB-diff discipline. A full schema-parity test is valuable hardening but is net-new test infrastructure, not a fix to a live defect.
- **Exit criterion:** Re-open as a dedicated hardening task — add a schema-parity test that diffs `reconcileLegacySchema`'s produced columns/types against `schema.ts` — when the next schema migration lands (highest risk moment) OR if a legacy-prod schema drift is observed.

### AGG-C3-17 — `actions/images.ts` god-action + LR route duplicates upload pipeline
- **Severity/Confidence:** MEDIUM / Medium (architect A4/A5).
- **Citation:** `apps/web/src/app/actions/images.ts` (1157 LOC, `uploadImages` ~435 LOC); the Lightroom publish API route mirrors `uploadImages`.
- **Reason for deferral:** Large refactor of the most security-sensitive flow; not a defect (both copies are currently correct and security-reviewer verified the LR route safe). Extracting a shared `lib/upload-orchestration.ts` core mid-loop risks introducing a regression in a high-blast-radius path without a behavioral driver.
- **Exit criterion:** Re-open when the upload pipeline next needs a behavioral change touching both call sites — extract the shared core then so the change lands once.

---

## DEFERRED — test coverage

### AGG-C3-19 — Per-image processing-claim RACE has no runtime test
- **Severity/Confidence:** MEDIUM / High (test-engineer TE-C3-03).
- **Citation:** `advisory-locks.test.ts` (lock-name pins only), `image-queue-delete-race-cleanup-wiring.test.ts` (source-shape scan, self-admits the gap).
- **Reason for deferral:** Net-new test infrastructure (a real two-worker race harness against MySQL advisory locks + conditional UPDATE). The invariant is currently sound (verified by tracer Flow 1 + debugger). Building a deterministic race test is a focused task, not a quick fix.
- **Exit criterion:** Re-open as a TDD task before any change to the claim/cleanup logic in `image-queue.ts`, OR if a double-processing incident is observed.

### AGG-C3-20 — Untested admin-mutation actions
- **Severity/Confidence:** MEDIUM / High (test-engineer TE-C3-04).
- **Citation:** `actions/settings.ts` `updateGallerySettings` (zero tests — single mutation point for ALL color-pipeline tunables), `actions/auth.ts` `login`/`updatePassword`, smart-collection CRUD action, `backfillClipEmbeddings`.
- **Reason for deferral:** Coverage gap, not a defect — the same-origin guard is structurally enforced by the action-origin lint gate, and validation lives in tested `lib/validation.ts`. Behavioral tests for these actions are valuable but a multi-test effort beyond this cycle's scope.
- **Exit criterion:** Re-open as a dedicated test-coverage task; prioritize `updateGallerySettings` (it gates the color pipeline) before the next change to gallery-settings validation.

### AGG-C3-21 — `lib/analytics-data.ts` has no tests
- **Severity/Confidence:** LOW / High (test-engineer TE-C3-05).
- **Citation:** `apps/web/src/lib/analytics-data.ts` (5 query builders, 213 LOC).
- **Reason for deferral:** Coverage gap; the ONLY_FULL_GROUP_BY exposure is the same class `data-tag-names-sql.test.ts` guards elsewhere, but analytics is admin-only and currently working. Net-new tests.
- **Exit criterion:** Re-open when an analytics query is next modified, OR if an ONLY_FULL_GROUP_BY error surfaces in production.

### AGG-C3-22 — `data-tag-names-sql.test.ts` rebuilds query inline
- **Severity/Confidence:** LOW / Medium (test-engineer TE-C3-06).
- **Citation:** `apps/web/src/__tests__/data-tag-names-sql.test.ts:244`.
- **Reason for deferral:** The "runtime SQL verified" claim is partially detached from the real `getImagesLite` SUT, but source-shape scans cover the gap and the contract is currently green. Refactoring the test to compile the real query is cleanup, not a fix.
- **Exit criterion:** Re-open when `getImagesLite`/`tagNamesAgg` is next changed — wire the test to the real compiled query then.

### AGG-C3-23 — e2e gaps (paid-download, license gating, view-count, webhook→entitlement)
- **Severity/Confidence:** LOW / Medium (test-engineer TE-C3-07).
- **Citation:** `apps/web/e2e/` (no specs for single-use download claim, license gating, shared-group view-count semantics, webhook→entitlement).
- **Reason for deferral:** e2e coverage gaps; the underlying behaviors are unit/source-tested and the Stripe flow is operationally closed (card-only pin). Full e2e specs for the payment surface are a focused effort.
- **Exit criterion:** Re-open before enabling async payment methods (the webhook gap re-opens then anyway), OR when the paid-download flow is next changed.

---

## DEFERRED — designer LOWs (smaller a11y/UX)

### AGG-C3-24 — Timeline + year masonry cards show no photo title on touch
- **Severity/Confidence:** LOW / Medium (designer).
- **Citation:** `timeline`/`year` masonry components (no `sm:hidden` title overlay that home/topic get via HomeClient).
- **Reason for deferral:** Minor discoverability gap on two secondary views; home/topic already have the overlay. Not an a11y blocker (alt text / aria-label still present).
- **Exit criterion:** Re-open when the timeline/year views are next styled, OR if the title-on-touch overlay becomes a product requirement.

### AGG-C3-25 — Lightbox-active loading spinner silent `role=status`
- **Severity/Confidence:** LOW / Medium (designer).
- **Citation:** lightbox loading spinner (empty `role=status`, no accessible text).
- **Reason for deferral:** Minor SR announcement gap; the spinner is transient. Low impact relative to the cycle's scheduled a11y fix (histogram contrast).
- **Exit criterion:** Re-open in the next a11y batch — add visually-hidden loading text to the `role=status` region.

### AGG-C3-26 — Histogram compute overlay lacks a live region
- **Severity/Confidence:** LOW / Medium (designer).
- **Citation:** histogram compute/loading overlay.
- **Reason for deferral:** Minor SR gap on a transient compute state. Bundle with AGG-C3-25.
- **Exit criterion:** Re-open in the next a11y batch alongside AGG-C3-25.

### AGG-C3-27 — Hardcoded `outline-blue-500` instead of `ring-ring` token (4 spots)
- **Severity/Confidence:** LOW / Medium (designer).
- **Citation:** 4 component spots using `outline-blue-500`.
- **Reason for deferral:** Token-consistency cleanup; focus rings are still visible (just not theme-token-driven). No functional a11y failure.
- **Exit criterion:** Re-open in a focus-ring token-consistency pass (find+replace `outline-blue-500` → `ring-ring`/`outline-ring`).

### AGG-C3-28 — InfoBottomSheet peek chip can render an empty pill on sRGB
- **Severity/Confidence:** LOW / Medium (designer).
- **Citation:** InfoBottomSheet peek chip.
- **Reason for deferral:** Cosmetic empty-state on sRGB displays; bounded visual nit.
- **Exit criterion:** Re-open when InfoBottomSheet is next touched — suppress the chip when its content is empty.

### AGG-C3-29 — TopicManager dialogs lack `DialogDescription`
- **Severity/Confidence:** LOW / Medium (designer).
- **Citation:** `categories/topic-manager.tsx` dialogs.
- **Reason for deferral:** Radix emits a console warning and SR users miss a description, but the dialogs have titles + labeled fields. Minor.
- **Exit criterion:** Re-open in the next a11y batch — add `DialogDescription` (or `aria-describedby`) to each TopicManager dialog.

### AGG-C3-30 — `ui/sheet.tsx` unused, sub-44px close button (INFO)
- **Severity/Confidence:** INFO / High (designer).
- **Citation:** `apps/web/src/components/ui/sheet.tsx` (unused; close button < 44px).
- **Reason for deferral:** Dead code — no current usage, so no runtime a11y impact. Would only bite if adopted.
- **Exit criterion:** Re-open if `ui/sheet.tsx` is ever imported/used — floor the close button at 44px first (the touch-target audit would catch it if `sheet.tsx` were under SCAN_ROOTS).

---

## DEFERRED — security (defense-in-depth / operational; overall risk LOW per security-reviewer)

### AGG-C3-31 — Real SESSION_SECRET + bootstrap passwords recoverable in git history
- **Severity/Confidence:** MEDIUM (operational) / High (security-reviewer).
- **Citation:** initial commit `d7c32790` `apps/web/.env.local.example` (64-hex `SESSION_SECRET`, `DB_PASSWORD=password`, `ADMIN_PASSWORD=password`), removed in `d068a7fb`. **HEAD is clean** (placeholders only).
- **Reason for deferral:** This is an OPERATIONAL item, not a code defect fixable at HEAD — the working tree is already clean. CLAUDE.md already documents the required mitigation: "If you ever seeded an environment from older checked-in examples, rotate both `SESSION_SECRET` and any bootstrap/admin credentials immediately. Historical git values must be treated as compromised and must not be reused." No code change can remediate a value already in git history; the fix is operational (confirm prod isn't using the historical secret; rotate if uncertain; optionally history-purge). Per Destructive Action Safety, history rewriting / secret rotation requires explicit user confirmation and is out of scope for an autonomous code-fix cycle.
- **Exit criterion:** Re-open only as an explicit operator action: verify the production `SESSION_SECRET` is not the historical `5e47a072…` value and rotate it (plus admin/DB creds) if there is any doubt. NOT a code task.

### AGG-C3-32 — SQL-restore scanner inter-token comment bypass
- **Severity/Confidence:** LOW / High (security-reviewer).
- **Citation:** `apps/web/src/lib/sql-restore-scan.ts:104` (deleting `/**/` turns `DROP/**/TABLE`→`DROPTABLE`, evading `\bDROP\s+TABLE\b`).
- **Reason for deferral:** Defense-in-depth only. The restore path is already gated by admin-auth + same-origin + `--one-database`, AND app-table drops are intentionally allowed during restore anyway, so the scanner bypass grants nothing an authenticated admin couldn't already do. Not an exploitable vulnerability.
- **Exit criterion:** Re-open if the restore scanner is ever relied upon as a primary control (it is not today); the fix is one line (replace stripped comments with a space rather than deleting them).

### AGG-C3-33 — `admin-tokens.verifyToken` bumps `last_used_at` before scope check
- **Severity/Confidence:** LOW / High (security-reviewer, cosmetic).
- **Citation:** `apps/web/src/lib/admin-tokens.ts` `verifyToken`.
- **Reason for deferral:** Cosmetic ordering — `last_used_at` may update for a token that then fails its scope check. No security or correctness impact (the request is still rejected).
- **Exit criterion:** Re-open if `last_used_at` is ever used for security auditing/anomaly detection (then move the bump after the scope check).

---

## CLOSED — verified at HEAD, NOT deferred and NOT re-planned

These were flagged by an agent working from a pre-fix snapshot but verified already-fixed by document-specialist at HEAD b1e9e0da. Recorded here only to prevent future re-reporting:
- "settings-hash covers **5** COLOR_IMPACTING_KEYS" → CLAUDE.md:264 already says **9** (AGG-R7-08 fix present).
- "cache() wraps **9** data-access functions" → CLAUDE.md:361 already says **10** and lists `getLatestImageForOgCached`.
- All ~58 prior-cycle findings (OG SSRF pin, Stripe card-only guard, bidi stripping in OG/JSON-LD/CSV, SW LRU head-walk, map LIMIT, serve-upload FD leak, CLIP embedding round-trip, analytics retention sweep, config re-darkening, build externalization, blur-data-url producer wrap, a11y batch).

**HARD GUARD:** CLIP semantic search remains disabled-by-design. No agent proposed activation; the disable/heal logic is verified correct (verifier claim 2). Nothing in this register touches that.
