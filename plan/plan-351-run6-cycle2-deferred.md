# Plan 351 — Run-6 Cycle-2 (orchestrator cycle 2/100) — Deferred Findings

**Date:** 2026-06-16
**Source:** `.context/reviews/_aggregate.md` (cycle-2 deep review, 11/11 agents) + per-agent files.
**HEAD at planning:** `8ccc8806`.

**Deferral integrity:** Every cycle-2 review finding is either scheduled in `plan-350-run6-cycle2-fixes.md` or recorded below. Nothing is silently dropped. Severities/confidences are preserved (NOT downgraded to justify deferral). When eventually picked up, deferred work remains bound by repo policy: GPG-signed commits (`-S`), conventional-commit + gitmoji, no `--no-verify`, no force-push to protected branches, `git pull --rebase` before push, run all GATES.

**Security/correctness/data-loss note:** Per CLAUDE.md and the user's global rules, security, correctness, and data-loss findings are NOT deferrable unless a repo rule explicitly allows it. The cycle-2 HIGH security/correctness/data-loss items (async-payment gap AGG-H1, wide-gamut-hint crash AGG-H6, serve-upload fd leak AGG-H5, getMapImages unbounded AGG-H4, `*_views` growth AGG-H2, OG SSRF-hardening AGG-M7, the DB rate-limit test gaps AGG-T1/T2) are ALL scheduled in plan-350 — none are deferred. The items below are perf-at-scale, refactors, a11y-polish, and CLIP-dark latent risks where deferral is justified and rule-permitted.

---

## DEFERRED — performance-at-scale (personal-gallery scope; re-open at scale)

The product is explicitly single-instance / personal-scale (CLAUDE.md "Runtime topology"). These perf items are bounded by per-IP rate limits and small absolute row counts today; the architect's "Scope-Appropriate Tradeoffs" section confirms over-engineering them now is net-negative.

### DEF-1 — `getImagesForFeed()` ORDER BY `updated_at` filesort + temp table (AGG-M9 / perf PERF-07)
- **File:** `apps/web/src/lib/data.ts:771-794`; callers `feed.xml/route.ts:40`, `[topic]/feed.xml/route.ts:62`.
- **Severity/confidence:** MEDIUM / High.
- **Why deferred:** Bounded to 50 output rows; feed cadence is low (crawlers/readers); the sort spans the filtered set which is small at personal scale. Adding index `(processed, updated_at, created_at)` is the fix but adds write-amplification + an index to maintain for a low-traffic path.
- **Exit criterion:** RE-OPEN when the gallery exceeds ~50k processed images OR feed-generation latency is observed > 200 ms; then add the composite index. Until then, document the deliberate omission.

### DEF-2 — `searchImages()` leading-wildcard `LIKE '%term%'` full-scan, no FULLTEXT (AGG-M10 / perf PERF-09)
- **File:** `apps/web/src/lib/data.ts:1404-1543`.
- **Severity/confidence:** MEDIUM / Medium.
- **Why deferred:** Per-IP 30/min rate limit caps abuse; fast at personal-gallery row counts; adding a MySQL FULLTEXT index + `MATCH … AGAINST` is a non-trivial schema + query change with its own ranking-behavior implications.
- **Exit criterion:** RE-OPEN when search latency is observed degrading OR the processed-image count exceeds ~50k; then add FULLTEXT over `(title, description, camera_model, lens_model)` keeping LIKE as fallback.

### DEF-3 — Upload-path tag N+1 (sequential `ensureTagRecord`) (AGG-M11 / perf PERF-05, PERF-06)
- **Files:** `apps/web/src/app/actions/images.ts:399-415`, `apps/web/src/app/actions/tags.ts:397-425`.
- **Severity/confidence:** MEDIUM / Medium.
- **Why deferred:** Deliberate correctness-over-throughput (slug-collision races make naive `Promise.all` unsafe); at personal scale uploads carry a handful of tags, so the serial round-trips are small latency. The batch-resolve-then-create-misses optimization is safe but non-trivial and not load-bearing today.
- **Exit criterion:** RE-OPEN when bulk uploads (50+ files × many tags) become a routine workflow OR upload latency is user-visibly slow; then implement the `WHERE slug IN (...)` pre-resolve + batch INSERT.

### DEF-4 — OFFSET pagination on list queries (deep-offset cost) (AGG-L14 / perf PERF-10)
- **File:** `apps/web/src/lib/data.ts` — `getImages:893-913`, `getImagesLitePage:818-854`, `getAdminImagesLite:915-937`.
- **Severity/confidence:** LOW / Medium.
- **Why deferred:** Keyset cursors already exist for the lite/smart-collection infinite-scroll paths (the hot paths); the remaining OFFSET callers are admin list / less-hot. Deep offsets are rare at personal scale.
- **Exit criterion:** RE-OPEN when admin list pagination or a crawler walking `?offset=` is observed slow on a large gallery; then route the remaining list paths through the existing keyset cursor.

### DEF-5 — Misc LOW perf items (perf PERF-08, PERF-11, PERF-12, PERF-13, PERF-14, PERF-15, PERF-18)
- **Files:** `data.ts` (`getFailedImages:940-954` unindexed filter/sort + no LIMIT; `getTopics:452-473` correlated MAX subquery), `actions/tags.ts:24-34` (`getAdminTags` no LIMIT), `actions/admin-users.ts:64-69` (`getAdminUsers` no LIMIT), `components/photo-navigation.tsx:54-94` (touch `setState` per touchmove), `components/image-zoom.tsx:103` (`getBoundingClientRect` in wheel handler), `rate-limit.ts:419-435` + `actions/auth.ts:131-146` (login two-round-trip rate-limit read).
- **Severity/confidence:** LOW (PERF-14/15 are Medium-confidence but Low-impact, confined to active gestures) / mixed.
- **Why deferred:** All admin-only or per-gesture or tiny-row-count surfaces; impact is negligible at personal scale (the Argon2 verify dominates the login path; admin tables have tens of rows; the gesture re-renders are confined to active swipe/wheel on a single image). Fixing them is polish, not correctness.
- **Exit criterion:** RE-OPEN individually if profiling shows a concrete regression (e.g. `getAdminTags` slow at 10k+ tags, swipe frame drops on a target device). Otherwise carry.

---

## DEFERRED — architecture refactors (mechanical, low-risk; do when touching the files)

### DEF-6 — Complexity concentration in `data.ts` (1,649), `process-image.ts` (1,638), `actions/images.ts` (1,152) (ARCH-01 / ARCH-03)
- **Severity/confidence:** HIGH (structural) / High.
- **Why deferred:** These are refactors (extract the view-count buffer to `lib/shared-group-view-counter.ts`; promote the color-pipeline decision matrix to a declarative `COLOR_PIPELINE_MATRIX` table) with NO behavioral change. The deferred-fix rules state the deferred list is only for existing review findings (not new refactors) — these ARE review findings, but they are large, touch privacy-critical + pipeline-critical code, and carry real regression risk if done speculatively rather than alongside a feature that needs them. Doing them this cycle would be churn against a working, heavily-tested module.
- **Exit criterion:** RE-OPEN the `process-image.ts` color-matrix extraction when WI-09 (HDR `_hdr.avif` encoder) is scheduled (it makes that work tractable). RE-OPEN the `data.ts` view-count extraction the next time the view-count flush subsystem needs a behavioral change. Both must land with full test coverage and no behavior change.

### DEF-7 — Triple-mirrored privacy field surface; no single `PUBLIC_IMAGE_COLUMNS` allowlist (ARCH-02)
- **File:** `apps/web/src/lib/data.ts` (public + map select sets) + `apps/web/src/lib/data-timeline.ts`.
- **Severity/confidence:** HIGH (privacy is the most expensive-to-reverse invariant) / High.
- **Why deferred (with a guard):** The CORE public/admin split IS by-construction-safe today — the compile-time `Extract` `_privacyGuard` + the symmetric set-difference test (`privacy-fields.test.ts`) would fail CI if a known sensitive key leaked into `publicSelectFields`. The residual risk is a FUTURE 4th read path that hand-writes a select and inherits no guard. That is a latent maintainability risk, not a live leak — so deferral is justified, but it is the highest-priority deferred item. NOTE: this is adjacent to a privacy (security) finding; it is deferred only because no live leak exists and the existing guards protect every CURRENT read path. Per the security-not-deferrable rule, if any new public read path is added before this is done, it MUST be added to the guard immediately (this is the exit trigger).
- **Exit criterion:** RE-OPEN immediately if ANY new public image read path is added (new `lib/data-*.ts`, new public API route hand-writing a select) — at that moment introduce the single exported `PUBLIC_IMAGE_COLUMNS` allowlist that all public reads spread, and lock `publicMapSelectFields` behind its only legitimate caller. Until a 4th path is needed, the existing compile guard + symmetric test cover the live surface.

### DEF-8 — Config sprawl; no central typed `lib/env.ts` (ARCH-04)
- **Files:** 40+ `process.env` reads across `db/index.ts`, `lib/upload-paths.ts`, `lib/rate-limit.ts`, `lib/request-origin.ts`, `lib/process-image.ts`, `lib/image-queue.ts`, `lib/admin-backfill-runner.ts`, `instrumentation.ts`, scripts; duplicate-name knobs `BACKFILL_CONCURRENCY` vs `ADMIN_BACKFILL_CONCURRENCY`.
- **Severity/confidence:** MEDIUM (HIGH-listed by architect) / High.
- **Why deferred:** A single typed env module with boot-time fail-fast is a cross-cutting refactor touching 25+ files; for a single operator who sets env once, the payoff is onboarding/robustness, not correctness. NOTE: the security-relevant slice — `TRUST_PROXY`/`TRUSTED_PROXY_HOPS` read without validation (overlaps SEC-03 / AGG-L7) — is partially addressed by plan-350 TASK-13-adjacent hardening of the Secure-cookie decision; the broader env module is the deferred part.
- **Exit criterion:** RE-OPEN when (a) a second operator/contributor is onboarded, OR (b) an env-misconfiguration incident occurs, OR (c) the duplicate concurrency knobs cause an observed surprise. Then introduce `lib/env.ts` (validate once at boot, frozen typed export, sole `process.env` reader) and collapse `BACKFILL_CONCURRENCY`/`ADMIN_BACKFILL_CONCURRENCY` to one name with a back-compat alias.

### DEF-9 — Orphaned storage abstraction (ARCH-05)
- **Files:** `apps/web/src/lib/storage/{types.ts, local.ts, index.ts}` (zero prod importers; `switchStorageBackend` is local→local dead code).
- **Severity/confidence:** MEDIUM / High.
- **Why deferred:** Honestly documented as not-wired; defuses the "abstraction implies capability" trap. Deleting vs marking is a small decision but the S3 migration it anticipates is genuinely out of scope.
- **Exit criterion:** DECIDE NEXT CYCLE between (a) delete it (YAGNI at this scope — recommended) or (b) add an `@orphaned` no-non-test-importer marker test so it can't quietly gain a half-wired caller. Either is a tiny change; it was not bundled into plan-350 to keep this cycle's commits focused. RE-OPEN the actual S3 backend only when multi-backend storage is a scheduled product requirement.

### DEF-10 — `lib/api-auth.ts` → `app/actions/auth` dependency inversion (ARCH-06)
- **File:** `apps/web/src/lib/api-auth.ts:1` (imports `isAdmin` from `@/app/actions/auth`).
- **Severity/confidence:** MEDIUM / Medium.
- **Why deferred:** The only `lib→app` edge; works today (auth needs request context); contained to auth. Moving the session reads to `lib/auth.ts` is a tidiness/robustness fix, not a live bug.
- **Exit criterion:** RE-OPEN when an auth refactor is otherwise scheduled; then move `getSession`/`getCurrentUser`/`isAdmin` to `lib/` and re-export from `app/actions/auth` for back-compat.

---

## DEFERRED — a11y polish (LOW; bundle with the next UI pass)

### DEF-11 — Admin login form lacks `aria-invalid`/`aria-describedby` on auth error (AGG-L9 / designer DES-03)
- **File:** `apps/web/src/app/[locale]/admin/login-form.tsx:56,76`.
- **Severity/confidence:** LOW (WCAG 3.3.1/3.3.3 AA) / Medium.
- **Why deferred:** Admin-only surface; errors ARE announced via a toast live region (just not field-associated). Low blast radius (single admin login form). Not bundled into plan-350 to keep the a11y commits focused on the higher-impact public-surface fixes (DES-01/02/04).
- **Exit criterion:** RE-OPEN in the next admin-UI a11y pass, OR when admin becomes a screen-reader-priority surface; wire `aria-invalid` + `aria-describedby` to a field-adjacent error element.

### DEF-12 — `<main focus:outline-none>` suppresses focus ring for all focus (AGG-L10 / designer DES-06)
- **File:** `apps/web/src/app/[locale]/(public)/layout.tsx:12`.
- **Severity/confidence:** LOW (WCAG 2.4.7/2.4.11) / Medium.
- **Why deferred:** This is the widely-accepted shadcn skip-link-target pattern; the practical risk (a keyboard user landing focus directly on `<main>` and seeing no ring) is marginal because skip-link navigation is intentional/programmatic. Cosmetic precision improvement.
- **Exit criterion:** RE-OPEN in the next a11y pass; change to `focus-visible:outline-none` or a `#main-content:focus:not(:focus-visible)` rule.

### DEF-13 — `lightbox-color-pip.tsx` cycle/copy buttons use `ring-1` not `ring-2` (AGG-L11 / designer DES-07)
- **File:** `apps/web/src/components/lightbox-color-pip.tsx:186,268`.
- **Severity/confidence:** LOW (WCAG 2.4.11 AA — 2px perimeter) / Medium.
- **Why deferred:** Inconsistency with the lightbox toolbar (which uses `ring-2`); a 1px white/50 ring on near-black likely fails the 2px-perimeter criterion but is a minor visual-only focus-indicator issue on a niche control. Bundle with the next focus-ring sweep.
- **Exit criterion:** RE-OPEN in the next a11y pass; change to `focus-visible:ring-2 focus-visible:ring-white/70` to match the toolbar.

### DEF-14 — `<OnThisDayWidget>` not wrapped in `<Suspense>`/Error Boundary (AGG-L12 / designer DES-10)
- **File:** `apps/web/src/app/[locale]/(public)/page.tsx:223`.
- **Severity/confidence:** LOW / Medium.
- **Why deferred:** A slow/failing "on this day" DB query could degrade the home render, but the widget is a small enhancement and the query is bounded; not a correctness bug. Needs a deliberate fallback design (skeleton + error boundary) rather than a one-liner.
- **Exit criterion:** RE-OPEN when home-page render latency/errors from this widget are observed, OR in the next public-page resilience pass; wrap in `<Suspense fallback=…>` + an Error Boundary.

### DEF-15 — Mobile nav focus-restoration on close not confirmed (designer DES-09)
- **File:** `apps/web/src/components/nav-client.tsx`.
- **Severity/confidence:** LOW (WCAG 2.4.3) / Low.
- **Why deferred:** Designer could not confirm statically whether focus returns to the hamburger on Escape/outside-click close; it MAY already be handled by Radix. Not yet a confirmed finding — needs a live keyboard test to promote.
- **Exit criterion:** RE-OPEN to verify via live keyboard nav (agent-browser); if focus is NOT restored on Escape/outside-click, add `hamburgerRef.current?.focus()` on collapse. Until confirmed, this is a suspected-not-confirmed item.

### DEF-16 — `h-8` dead class on the search modal input (AGG-L / designer DES-05, DOWNGRADED)
- **File:** `apps/web/src/components/search.tsx:356`.
- **Severity/confidence:** LOW (cosmetic/clarity) / High. NOTE: originally reported by the static designer as a HIGH 32px touch-target VIOLATION; the orchestrator REFUTED that — the base `Input` primitive (`ui/input.tsx:11`) hard-floors `min-h-11`, and CSS `min-height` wins over the `h-8` `height`, so the input renders at 44px at runtime (matching the prior-cycle live measurement). It is a misleading dead class, NOT a WCAG violation.
- **Why deferred:** Not a real touch-target failure; removing `h-8` is a clarity cleanup so the class list isn't misleading and the touch-target audit isn't theoretically fooled. Cosmetic.
- **Exit criterion:** RE-OPEN to drop the `h-8` (and any sibling misleading height overrides on `Input`-based controls) in the next UI tidy-up; no runtime change.

---

## DEFERRED — CLIP dark-gated latent risks (production-only; re-open at activation)

These are real but INERT today (feature dark by design + user-deferred activation). The HARD GUARD forbids activation. Several overlap existing plan-349 deferrals (DEF-1/2/3/6) — cross-referenced to avoid duplication.

### DEF-17 — Synchronous event-loop-blocking cosine scan in the search routes (AGG-CL1 / perf PERF-02)
- **Files:** `apps/web/src/app/api/search/similar/[id]/route.ts:142-163`, `apps/web/src/app/api/search/semantic/route.ts` (same shape).
- **Severity/confidence:** HIGH (when enabled) / High. **Production-only.**
- **Why deferred:** Inert while the feature is `disabled` (default + healed). Overlaps **plan-349 DEF-1** (production CLIP inference blocks the event loop) and **DEF-2** (5000-row recall cliff + missing index). Fixing requires moving the scan off the loop / a vector index — coupled to the production-activation work that is deferred by explicit user choice.
- **Exit criterion:** RE-OPEN as a BLOCKING HIGH the moment production CLIP activation is scheduled. Production MUST NOT be enabled on the single-instance topology until inference + scan are off the main thread (chunk/yield or worker thread or MySQL-side cosine / ANN index). Pair with plan-349 DEF-1/DEF-2.

### DEF-18 — Runtime CLIP model loader performs no on-disk checksum (AGG-CL2 / debugger LR-1)
- **File:** `apps/web/src/lib/clip-model.ts:63-71`.
- **Severity/confidence:** MEDIUM / Medium. **Production-only.**
- **Why deferred:** The downloader (`download-clip-models.ts`) DOES verify SHA-256 + clean-on-mismatch; the runtime loader trusting on-disk bytes only bites if a partial/truncated ONNX survives the volume AND production is enabled. Dark today.
- **Exit criterion:** RE-OPEN when production activation is scheduled; have `getModelBundle()` verify the ONNX SHA-256 against the manifest (or gate startup on `download-clip-models.ts --verify-only`) before `from_pretrained`.

### DEF-19 — Unbounded fire-and-forget production embedding hook + redundant per-image config read (AGG-CL3 / debugger LR-2)
- **File:** `apps/web/src/lib/image-queue.ts:433-470`.
- **Severity/confidence:** MEDIUM / Medium. **Production-only.**
- **Why deferred:** Inert while dark. Overlaps **plan-349 DEF-3** (detached hooks call request-scoped `getGalleryConfig()`). ONNX `session.run()` is thread-safe (no corruption) — this is CPU-oversubscription on batch upload, only in production mode.
- **Exit criterion:** RE-OPEN with production-activation work; route embedding through a small bounded PQueue (concurrency 1-2) and read `semanticSearchMode` once from the already-fetched config. Bundle with plan-349 DEF-3.

### DEF-20 — Model-reload storm on permanently-absent production volume; no negative-cache backoff; CSP lacks `wasm-unsafe-eval` (AGG-CL4 / debugger LR-3, critic CRT-06)
- **Files:** `apps/web/src/lib/clip-model.ts:74-78`; `apps/web/src/lib/content-security-policy.ts:105-117`.
- **Severity/confidence:** LOW (reload storm) / Low; MEDIUM (CSP latent) / Medium. **Production-only.**
- **Why deferred:** The reload storm only occurs in production mode with the weights volume absent (dark; production deferred). The CSP `wasm-unsafe-eval` gap only bites if production CLIP uses the WASM backend or any onnxruntime-web path — today CLIP is server-side `onnxruntime-node` (native) and disabled. Overlaps **plan-349 DEF-6** (negative-cache backoff + AbortController).
- **Exit criterion:** RE-OPEN with production-activation work; add a short negative-cache TTL on the rejected model load, and add a documented conditional `'wasm-unsafe-eval'` to the CSP gated behind the same `SEMANTIC_SEARCH_ALLOW_PRODUCTION` env so enabling production relaxes CSP exactly as much as needed. Bundle with plan-349 DEF-6.

---

## RECORD-ONLY — carried prior deferrals (re-confirmed UNCHANGED at HEAD 8ccc8806)

The plan-349 deferrals (DEF-1..DEF-10) and plan-317/322/327/338/340/342/344/346 deferrals remain open and UNCHANGED this cycle. The cycle-2 CLIP latent items above (DEF-17..DEF-20) are the same underlying risks re-surfaced by fresh agents; they do not supersede the plan-349 entries — treat plan-349 as authoritative for the CLIP production-activation checklist and this plan's DEF-17..20 as cross-references confirming they're still valid.

Additionally carried (not re-litigated): `postcss <8.5.10` transitive build-toolchain advisory (plan-349 DEF-4), duplicated search-route scan/enrich logic (plan-349 DEF-5), real-encode AVIF/WebP test-isolation flake (plan-349 DEF-8), `dotProduct` fast-path not swapped into the scan loops because stub embeddings aren't L2-normalized (plan-349 DEF-10).

---

## LOW test items deferred (test-engineer TEST-05, TEST-06, + quiesce timer)

### DEF-21 — Advisory-lock double-release idempotency is source-asserted, not behavioral (TEST-05)
- **File:** `apps/web/src/lib/upload-processing-contract-lock.ts`; test `restore-upload-lock.test.ts`.
- **Severity/confidence:** LOW / Medium.
- **Why deferred:** A `released` guard flag exists; the risk (double `RELEASE_LOCK` query if the guard is removed) is MySQL-silent and low-impact. Source-contract coverage exists.
- **Exit criterion:** RE-OPEN to add a behavioral test (acquire, `release()` twice, assert one `RELEASE_LOCK` query) when the lock module is next touched.

### DEF-22 — Semantic-search route has no source-contract test for the disabled-mode guard (TEST-06)
- **File:** `apps/web/src/app/api/search/semantic/route.ts`.
- **Severity/confidence:** LOW / Medium. **CLIP-dark.**
- **Why deferred:** The route already 503s on any non-stub/non-production resolved mode; the config heals production→disabled. The gap is the absence of a `stripe-webhook-source.test.ts`-style guard asserting the disabled path can't reach inference.
- **Exit criterion:** RE-OPEN when CLIP gets any further hardening; add a source-contract test asserting `semanticSearchMode` is checked before any embed call and the disabled path returns 404/empty. (Low priority — the runtime 503 + config heal already protect it.)

### DEF-23 — `image-queue-quiesce.test.ts:136` real 60s no-op timer without fake timers (test-engineer 3b)
- **File:** `apps/web/src/__tests__/image-queue-quiesce.test.ts:136`.
- **Severity/confidence:** LOW / High.
- **Why deferred:** No assertion impact (the callback is a no-op); the timer hangs in the worker background after the test but doesn't flake the suite (2145 pass, 0 fail).
- **Exit criterion:** RE-OPEN to add `vi.useFakeTimers()`/`vi.useRealTimers()` or a `clearTimeout` in `afterEach` when that test file is next edited.

---

## Deferral integrity statement

All 38 distinct cycle-2 findings (6 HIGH, 12 MEDIUM, 14 LOW, 6 DOC, 3 TEST, 4 CLIP-latent — with overlaps deduped in the aggregate) are accounted for: scheduled in plan-350 (TASK-1..16) or deferred above (DEF-1..23) with severity/confidence preserved, a concrete reason, and an exit criterion. No security/correctness/data-loss finding is deferred without either being scheduled or being inert-by-design (CLIP dark-gated, where deferral is explicitly authorized by the user's activation deferral + the HARD GUARD). The refuted/downgraded findings (TRC-03, DES-11, DES-05-as-violation, and the code-reviewer/critic refutations) are recorded in `_aggregate.md` "VERIFIED NON-ISSUES" and are NOT carried as findings.
