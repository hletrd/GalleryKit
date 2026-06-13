# Aggregate Review — Run-5 Cycle-3

**Date:** 2026-06-12
**Inputs:** 11 agent reviews in `.context/reviews/run5-cycle3/` (code-reviewer, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer).
**Diff under extra scrutiny:** `aa5266b5..HEAD` (21 run-5 cycle-2 commits, 54 files).
**Suppression honored:** plan-315 / plan-316 / plan-317 / plan-322 items excluded as NEW findings by every lane; cross-references and pull-forward escalations recorded below.

## AGENT FAILURES

None — all 11 agents returned and wrote their review files. Designer performed a full runtime pass (dev server on :3105, agent-browser, 3 viewports, en+ko, dark mode, reduced-motion). Verifier ran the unit/lint/typecheck gates: **all green** (1979 tests / 201 files pass, 4 lint gates exit 0, typecheck clean) — VER-R5C3-02 (gates pending) is hereby RESOLVED by the verifier's own final report.

## Per-agent raw counts

| Agent | CRIT | HIGH | MED | LOW | Notes |
|---|---|---|---|---|---|
| code-reviewer | 0 | 0 | 3 | 5 | COMMENT verdict; reproduced the resources/ leak (+2 files per run) |
| perf-reviewer | 0 | 0 | 1 | 3 | verdict: FIX AND SHIP; deep backfill/queue/SW sweep clean otherwise |
| security-reviewer | 0 | 0 | 0 | 2 | risk LOW; full OWASP coverage table; cycle-2 security commits verified |
| critic | 0 | 0 | 1 | 1 | ACCEPT-WITH-RESERVATIONS; 5 adversarial predictions DISPROVEN (fixes genuine) |
| verifier | 0 | 0 | 1* | 1 | 31/31 plan-319/320/321 criteria VERIFIED (1 PARTIAL); *gate-pending finding resolved |
| test-engineer | 0 | 4 | 4 | 4 | 3 of 4 HIGH are plan-315 pull-forward escalations (items 14/17/19) |
| tracer | 0 | 0 | 1 | 4 | 8 flows traced; cycle-2 backfill lock fix confirmed correct on all exit paths |
| architect | 0 | 0 | 0 | 2 | AGG-R5C2-02 boundary closure verified clean; no migration exposure |
| debugger | 0 | 2 | 4 | 1 | + 1 investigated non-finding (session shape assert SAFE) |
| document-specialist | 0 | 0 | 3 | 4 | 9 cycle-2 doc fixes confirmed; 832/832 i18n key parity |
| designer | 0 | 1 | 2 | 7 | runtime+static; all 3 cycle-2 a11y fixes hold at runtime; 8 findings = plan-315 re-confirmations |

**Raw findings: 61 · Merged after dedupe/already-planned routing: 24 actionable new (3 HIGH, 8 MED, 13 LOW) + 12 already-planned pull-forward escalations + provenance notes.**

---

## MERGED FINDINGS

IDs `AGG-R5C3-NN`. Severity/confidence = max across contributing agents. Multi-agent agreement = higher signal.

### HIGH

#### AGG-R5C3-01 [HIGH/High · confirmed · 3 agents] Test-artifact leak: `process-topic-image.test.ts` writes real webp into `public/resources/`, never cleaned, not gitignored
- **Sources:** BUG-R5C3-01 (HIGH, debugger) + BUG-R5C3-03 (MED) · COR-R5C3-01 (MED, code-reviewer, REPRODUCED: +2 files per `vitest run`) · TRC-R5C3-01/-02 (MED+LOW, tracer, writer traced to file:line).
- **Where:** `apps/web/src/__tests__/process-topic-image.test.ts:88-106` (success-path tests call real Sharp pipeline, never register outputs for cleanup; `afterAll` at :146-149 only cleans `createdFiles[]` populated by the OTHER describe block); `apps/web/src/lib/process-topic-image.ts:11-17` (`RESOURCES_DIR` resolves to live `apps/web/public/resources/` under vitest cwd); `apps/web/.gitignore` (has `/public/uploads/*`, NO entry for `/public/resources/`).
- **Problem:** Every test/gate run permanently leaks 2 UUID `.webp` files into the repo tree (30+ accumulated today, timestamps matching gate runs). Un-ignored → `git add -A` commits binary test garbage; deploy-host worktree accrues files unbounded.
- **Fix:** (a) register every `processTopicImage` return value for `afterAll` unlink in the test; (b) add `/public/resources/*` + `!/public/resources/.gitkeep` to `apps/web/.gitignore` (+ `.gitkeep`); (c) delete the ~30 leaked test files (confirmed synthetic 512×512 solid-color blobs, not real photos — destructive-action confirmation noted; they are this loop's own test output).

#### AGG-R5C3-02 [HIGH/High · confirmed · 2 agents] Deslop pass left a tautology assertion in `caption-generator.test.ts` — cross-module prefix pin is hollow
- **Sources:** BUG-R5C3-02 (HIGH, debugger) · TEST-R5C3-01 (HIGH, test-engineer).
- **Where:** `apps/web/src/__tests__/caption-generator.test.ts:65-69` — `expect(ALT_TEXT_STUB_PREFIX).toBe(ALT_TEXT_STUB_PREFIX)` (introduced by deslop commit 62532c77 when the `caption-generator` re-export import was removed).
- **Problem:** The assertion always passes; the ARCH-R5C2-02 intent (catch caption-generator drifting from the canonical caption-constants prefix) is unenforced. A `'[WRONG] '` hardcode in `generateCaptionStub` would ship green.
- **Fix:** Replace with a behavioral pin: `const result = await generateCaption(BASE_INPUT, true); expect(result!.indexOf(ALT_TEXT_STUB_PREFIX)).toBe(0)` using the constant imported from `caption-constants`. Delete the vacuous line. (Also remove the now-redundant `vi.mock('server-only', …)` at :11 — BUG-R5C3-07, folded here.)

#### AGG-R5C3-03 [HIGH/High · confirmed · designer, runtime-verified] Global skip link targets non-existent `#main-content` on every admin route (WCAG 2.4.1 failure)
- **Source:** DES-R5C3-01 (HIGH).
- **Where:** `apps/web/src/app/[locale]/layout.tsx:124` (global `href="#main-content"` skip link); `apps/web/src/app/[locale]/admin/layout.tsx:20,24` (admin layout sets `id="admin-content"` instead). Runtime evidence: `brokenSkipLinks: ["#main-content"]` on `/en/admin`.
- **Problem:** On admin pages two skip links render; the global one resolves to nothing — keyboard/AT users pressing "Skip to content" get dropped focus and must Tab the full nav+sidebar. The global layout's comment assumes the public sub-layout always provides the id; that assumption fails for admin.
- **Fix:** Add a `id="main-content"` anchor alias inside the admin layout content (or gate the global skip link off admin routes). Simplest robust fix: have `admin/layout.tsx` put `id="main-content"` on its `<main>` (keeping `admin-content` as a secondary anchor if referenced) so the single global skip link always resolves. Verify no duplicate-id collision on public routes.

### MEDIUM

#### AGG-R5C3-04 [MED/High · confirmed · code-reviewer ×2 findings] Backfill observability is write-only: failures never reach the admin UI; `completedRuns` increments on fully-failed runs
- **Sources:** COR-R5C3-02 (MED) + COR-R5C3-03 (MED).
- **Where:** `apps/web/src/lib/admin-backfill-runner.ts:96-153, 455-538` (counters + `completedRuns++` unconditional) vs `apps/web/src/app/actions/admin-backfill.ts:64-83` (`getBackfillStatus` returns only `{ok, running, candidateCount}`).
- **Problem:** Cycle-2's AGG-R5C2-10 fix computed `encodeFailures`/`skipped*`/`detectionFailures`/`lastError` but no UI/action consumer reads them — a run where EVERY row encode-fails shows the same candidateCount, `running:false`, no error, and still bumps `completedRuns`. Admin gets zero in-app diagnostic.
- **Fix:** Extend `getBackfillStatus()` to return the counters + `lastError` + `completedRuns` from `readAdminBackfillState()`; render last-run summary (processed/failed/skipped + error line) in the settings backfill UI; gate the "Run complete" log/`completedRuns++` semantics (split clean vs with-failures, e.g. include failure counts in the completion signal).

#### AGG-R5C3-05 [MED/High · confirmed · 3 agents] Backfill can pin up to `1 + 2×ADMIN_BACKFILL_CONCURRENCY` of the 10 shared pool connections; pool-exhaustion error path spins
- **Sources:** PERF-R5C3-01 (MED, perf) · ARCH-R5C3-02 (LOW, architect) · BUG-R5C3-04 (MED, debugger).
- **Where:** `apps/web/src/lib/admin-backfill-runner.ts:155-220, 273-396` (whole-run lock conn + per-image claim conn held across encode + transient `db.execute` conn); pool `apps/web/src/db/index.ts:13-26` (`connectionLimit: 10`, `queueLimit: 20`). Error path: a pool-exhausted `getConnection()` throw escapes `reprocessOne` and tight-loops `errors++` with no backoff.
- **Problem:** Docs encourage raising `ADMIN_BACKFILL_CONCURRENCY`; at N=4 worst-case 9/10 connections are pinned by a background maintenance op while live traffic queues then 500s. Plus log-spam spin under sustained exhaustion.
- **Fix:** (1) cap effective concurrency vs pool size (export the pool limit; `min(env, floor((POOL_LIMIT-2)/2))`); (2) catch pool-exhaustion in `reprocessOne`'s claim step → treat as `{ok:false, reason:'locked'}` skip (no version bump, retried next run); (3) document the connection-budget arithmetic in the runner header + CLAUDE.md backfill section.

#### AGG-R5C3-06 [MED/High · confirmed · critic] Touch-target regression gate cannot see `<Link>`/`<a>`, and `app/[locale]/` root files are unscanned; plan-320 item 6 closed on a false premise
- **Source:** CRT-R5C3-01 (MED).
- **Where:** `apps/web/src/__tests__/touch-target-audit.test.ts:69-72` (SCAN_ROOTS — `(public)` IS walked, `app/[locale]/*.tsx` root files are NOT), FORBIDDEN set anchors only on Button/button/Badge/select; fixed links at `g/[key]/page.tsx:140,172`, `not-found.tsx:45`, `error.tsx` are unguarded. Plan provenance: `plan/plan-320-run5-cycle2-medium.md:31,67` (asserted `(public)` is NOT scanned — factually wrong).
- **Problem:** All three cycle-2 anchor-based touch-target fixes can silently regress; identical failure class to the R4C15/R4C16 incidents that drove Badge/select into FORBIDDEN.
- **Fix:** (a) add FORBIDDEN patterns for `<Link>`/`<a>` with sub-44 sizing classes lacking a ≥44 override; (b) add `app/[locale]` root-level files (`not-found.tsx`, `error.tsx`, `layout.tsx`) to the scan; (c) correct the stale claim in plan-320 item 6.

#### AGG-R5C3-07 [MED/Med · likely · test-engineer] `semantic-search-route.test.ts` enrichment mock is call-order-dependent — the AGG-R5C2-53 anti-pattern lives on here
- **Source:** TEST-R5C3-07 (MED).
- **Where:** `apps/web/src/__tests__/semantic-search-route.test.ts:221-242` (`callCount === 1` → embeddings, else images).
- **Fix:** dispatch on the schema object passed to `.from()` (sentinel property on `imageEmbeddings` vs `images`), mirroring the checkout-route table-keyed fix.

#### AGG-R5C3-08 [MED/Med · likely · test-engineer] `/s/[key]` valid-key e2e spec always skips (no seeded share key) — 200 path has zero e2e coverage
- **Source:** TEST-R5C3-08 (MED).
- **Where:** `apps/web/e2e/public.spec.ts:125-140` (gated on `E2E_SHARE_KEY`, unset in CI); e2e fixtures seed a group key but no photo share key.
- **Fix:** seed a share key in the e2e fixture script (preferred) or document the standing skip with a TODO + env-matrix note. Choose seeding if cheap; otherwise record deferral with exit criterion.

#### AGG-R5C3-09 [MED-theory/LOW-practice · confirmed · debugger] `ensureDir` singleton in `process-topic-image.ts` races on concurrent failure
- **Source:** BUG-R5C3-06 (MED/Med).
- **Where:** `apps/web/src/lib/process-topic-image.ts:29-37` — catch resets `dirPromise = null` unconditionally; two concurrent callers can clobber each other's promise.
- **Fix:** standard guarded reset: capture `const p = …; p.catch: if (dirPromise === p) dirPromise = null; dirPromise = p`. One-liner; matches the documented `ensureDirs` singleton pattern elsewhere.

#### AGG-R5C3-10 [MED/Med · needs-doc · debugger] Semantic route shares one 30/min bucket for all `'unknown'`-IP clients (TRUST_PROXY unset)
- **Source:** BUG-R5C3-05 (MED, needs-manual-validation; pre-existing pattern, checkout precedent documented it).
- **Where:** `apps/web/src/app/api/search/semantic/route.ts:190-192`; `apps/web/src/lib/rate-limit.ts:186-189`.
- **Fix (doc-level):** comment at the route + rate-limit SECURITY note documenting the shared-bucket effect and the TRUST_PROXY expectation (rate limit is a security control — do NOT omit it like the idempotency key). No behavioral change.

#### AGG-R5C3-11 [MED→LOW resolution note · confirmed · verifier+docs] Verifier/doc residuals from the cycle-2 truth pass (CLAUDE.md)
- **Sources:** VER-R5C3-01 (LOW — line 229 `14/15=BT.2020→gamma22` should be `gamma24 (BT.1886)` per `color-detection.ts` NCLX_TRANSFER_MAP) · DOC-R5C3-02 (MED — line 266 still says "Firefox 124+", contradicting the corrected matrix/R10-H4 prose; should reference FF ≤109 guard) · DOC-R5C3-06 (LOW — SW section heading still says "no-store exemption" while body + sw.template.js say no-cache).
- **Fix:** three surgical CLAUDE.md edits in one docs commit.

### LOW

#### AGG-R5C3-12 [LOW/High · confirmed · security] EXIF-derived caption bypasses the Unicode bidi/zero-width sanitizer on render + persist paths
- **Source:** SEC-R5C3-01.
- **Where:** `process-image.ts:565-574` (`cleanMetadataString` strips NUL only), `image-queue.ts:385-392` (caption stub embeds `camera_model` verbatim), `photo-title.ts:107-118` (render), `images.ts:979-984` (applyAltSuggested persists without `sanitizeAdminString`).
- **Fix:** apply `UNICODE_FORMAT_CHARS` strip in `cleanMetadataString` (source defense); belt-and-braces sanitize at the applyAltSuggested copy; regression fixture with a U+202E-laden Model string. (Security-class finding — scheduled, not deferred.)

#### AGG-R5C3-13 [LOW/High · confirmed · code-reviewer] Stale legacy `semantic_search_mode='production'` renders a BLANK admin Select trigger
- **Source:** COR-R5C3-04. **Where:** `settings-client.tsx:531-545`. **Fix:** coerce controlled value to a valid item (`['disabled','stub'].includes(v) ? v : 'disabled'`); amber legacy warning keeps reading the raw map.

#### AGG-R5C3-14 [LOW/Med · likely · code-reviewer] `cleanOrphanedTopicTempFiles` never GCs orphaned UUID topic thumbnails
- **Source:** COR-R5C3-07. **Where:** `process-topic-image.ts:97-108` (`tmp-*` only). **Fix:** startup/periodic reconciliation against `topics.image_filename` (mirror the orphan-scan pattern), or record as accepted with exit criterion.

#### AGG-R5C3-15 [LOW/High · confirmed · code-reviewer] `clampSemanticTopK` silently defaults numeric strings — caller contract undocumented
- **Source:** COR-R5C3-06. **Fix:** document "raw must be a parsed JSON number" at the export (or accept `/^\d+$/` strings). Comment-level.

#### AGG-R5C3-16 [LOW/Med · likely · code-reviewer] `formatTitleAsTags` still hashtags prose titles (`#Sunrise #over #the #bay`)
- **Source:** COR-R5C3-08 (the AGG-R5C2-12 open design question). **Fix:** gate tag-formatting to tag-shaped titles or drop it for prose; requires confirming consumer intent — schedule as a small product-decision item.

#### AGG-R5C3-17 [LOW/Med · defensive · code-reviewer] Lock-connection acquire→try gap in `reprocessOne` is maintainability-fragile
- **Source:** COR-R5C3-05. **Fix:** move claim acquisition immediately adjacent to the protected try (or add a lock-critical comment). Pairs with AGG-R5C3-05's restructure.

#### AGG-R5C3-18 [LOW/High · confirmed · perf] `evictHtmlCacheIfNeeded` re-reads up to 50 full HTML bodies per over-cap write (HTML twin of the image-cache meta concern)
- **Source:** PERF-R5C3-02. **Where:** `sw.template.js:119-136`. **Routing:** fold into plan-315 item 16's SW rework as an explicit HTML-cache rider (item 16 scope is image-only today).

#### AGG-R5C3-19 [LOW/High · confirmed · perf] Backfill re-decodes every original a second time for `detectColorSignals`
- **Source:** PERF-R5C3-03. **Where:** `admin-backfill-runner.ts:295-337`; sidecar mirrors. **Fix:** thread detection out of `processImageFormats` (returns alongside `wasDownscaled`/`avif10bit`) — verify WI-14 constraint; or defer with exit criterion (full-gallery re-encode cost evidence).

#### AGG-R5C3-20 [LOW/Med · confirmed · perf] Semantic scan allocates ~15k short-lived objects/request at stub scale
- **Source:** PERF-R5C3-04. **Routing:** no action at stub scale — pin to the production-encoder milestone (deferred with exit criterion).

#### AGG-R5C3-21 [LOW/High · confirmed · architect] No fast-loop test guard pins the client→server-only import boundary closed by AGG-R5C2-02
- **Source:** ARCH-R5C3-01. **Fix:** source-scan fixture walking `'use client'` files' transitive `@/lib`/`@/db` imports asserting none contains `import 'server-only'`; pin `photo-title → caption-constants`.

#### AGG-R5C3-22 [LOW · test hygiene cluster · test-engineer] Batching-test drizzle-internals pin + Symbol-keyed reset coupling + e2e rate-limit worker serialization
- **Sources:** TEST-R5C3-09 (drizzle `queryChunks` contract — add version-pin comment + StringChunk presence assert), TEST-R5C3-11 (export `_resetStateForTesting()` instead of `Symbol.for` poke), TEST-R5C3-12 (confirm/document Playwright worker serialization for admin specs vs the 5/15-min login budget).

#### AGG-R5C3-23 [LOW/High · confirmed · critic] Checkout unknown-IP comment undersells the dropped double-click dedup
- **Source:** CRT-R5C3-02. **Fix:** one-line comment amendment at `checkout/[imageId]/route.ts:182-185`. Comment-only.

#### AGG-R5C3-24 [LOW · doc/info cluster] Remaining doc notes
- **Sources:** SEC-R5C3-02 (npm audit: 2 moderate transitive postcss via Next toolchain — not exploitable; record in dependency log, do NOT `audit fix --force`) · DOC-R5C3-07 (en ICU plural vs ko fixed-form — intentional; add a convention note) · TRC-R5C3-04 (applyAltSuggested truthiness guard belt-and-braces `!= null && !== ''`) · TRC-R5C3-03 (sized-derivative mid-ladder visibility — architectural note, no action).

---

## ALREADY-PLANNED — pull-forward escalations (owners unchanged, re-confirmed open at HEAD)

Multiple lanes independently re-confirmed that the plan-315/316 backlog is aging while its risk is real. These are NOT new findings; they are priority escalations:

| This-cycle observation | Owner | Escalation |
|---|---|---|
| TEST-R5C3-02: migration-journal monotonicity test STILL not created (the burned-once prod failure mode) | plan-315 item 14 | HIGH-risk — pull forward THIS cycle |
| TEST-R5C3-03: only 1/5 advisory-lock constants pinned | plan-315 item 19 (+plan-322 rider) | HIGH-risk — pull forward |
| TEST-R5C3-04: upload-paths behavioral tests missing (all consumers mock it) | plan-315 item 17 | HIGH-risk — pull forward |
| TEST-R5C3-05: withAdminAuth wrong-scope→401 untested at wrapper level | plan-315 item 18 | pull forward (cheap) |
| TEST-R5C3-10: stripe webhook has zero behavioral tests | plan-315 item 22 | pull forward when budget allows |
| TEST-R5C3-06: download affectedRows-shape pin | plan-315 item 7 | pull forward when budget allows |
| DES-R5C3-02..-10: designer items re-confirmed unimplemented (runtime evidence) | plan-315 items 23-33 | pull forward the cheap CSS ones (25/27/33 + 26/30/31) |
| DOC-R5C3-01/-03/-04/-05: ETag formula, cache() list, site-config path, blur 4KB | plan-316 VER-R5C1-01 / DOC-R5C1-05 / DOC-R5C1-03 / DOC-R5C1-24 | pull forward in one docs commit |
| COR-R5C3 cross-ref: bulkUpdateImages TriState guard still unimplemented | plan-315 item 1 | pull forward |
| OG Host-steering / PAT audit / seo-og-url | plan-315 items 2-3, plan-316 Unit D | unchanged owners |
| SW HEAD-probe blocking + LRU meta rework | plan-315 item 16 (+AGG-R5C3-18 HTML rider) | unchanged owner |
| Backfill candidate index / analytics indexes | plan-322 entries 1-3 | unchanged (needs-EXPLAIN) |

## Verified-clean highlights (cross-agent)

- All 31 plan-319/320/321 acceptance criteria VERIFIED (verifier; 1 PARTIAL = the gamma22 doc residual).
- Critic's 5 adversarial paper-over predictions all DISPROVEN — cycle-2 honesty cluster, batching test, server-only stub are genuine fixes.
- Backfill per-image lock: correct on all exit paths (tracer flow 3, perf, debugger, architect concur).
- Session shape asserts post-HMAC: no timing oracle (security, code-reviewer, debugger concur).
- i18n parity 832/832 keys; 9 cycle-2 doc fixes confirmed applied (document-specialist).
- All 3 cycle-2 a11y fixes hold at runtime (designer, dev-server verification).

## Gate evidence (verifier, this cycle)

lint ✓ · lint:api-auth ✓ · lint:action-origin ✓ · lint:public-route-rate-limit ✓ · vitest 201 files / 1979 tests ✓ · typecheck ✓ (build + e2e deferred to PROMPT 3 gate run).
