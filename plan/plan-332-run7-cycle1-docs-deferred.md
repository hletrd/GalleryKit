# Plan 332 — Run-7 Cycle 1 docs + deferred + plan-table corrections

**Source:** `.context/reviews/_aggregate.md` (run-7 cycle-1, 12 open + 1 partial + already-owned).
**Coverage rule (STRICT):** every aggregate finding is either scheduled in plan-331, scheduled in this plan's docs batch, or explicitly deferred below with file:line, ORIGINAL severity/confidence (never downgraded), a concrete deferral reason, and an exit criterion.
**Repo rules consulted before any deferral (in order):** CLAUDE.md (root project), AGENTS.md (via CLAUDE.md "Git Workflow"), `.context/` conventions, global CLAUDE.md (destructive-action safety, latest-version, GPG-sign). **No security, correctness, or data-loss finding is deferred** except where the repo's own rules explicitly permit (quoted inline).
**Commit discipline:** identical to plan-331 (GPG-signed, gitmoji, per-item commits, `pull --rebase` then push each, full gate run before close).

---

## Coverage accounting (run-7 findings)

| Plan | Finding IDs |
|---|---|
| plan-331 (MED a11y/maint/test + LOW correctness) | AGG-R7-01, AGG-R7-02, AGG-R7-03, AGG-R7-04, AGG-R7-05, AGG-R7-07, AGG-R7-09 |
| plan-332 Unit A (docs + deferral-note correction) | AGG-R7-06, AGG-R7-08 |
| plan-332 Unit C (stale plan-table corrections) | (hygiene — corrects plan-329/330 tables for AGG-8/10/13/16/18) |
| **plan-332 deferred (below)** | **AGG-R7-A2, AGG-R7-10, AGG-R7-11, AGG-R7-12, AGG-R7-13, AGG-R7-A1, AGG-R7-A3, AGG-R7-A4** |
| **Total open/partial** | **12 open + 1 partial + 1 already-owned, all accounted** |

---

## Unit A — CLAUDE.md doc corrections + the 401/403 deferral-note fix (one or two docs commits)

| Finding | Where | Correction |
|---|---|---|
| AGG-R7-08(a) (LOW, DOC-01/AGG-21) | CLAUDE.md ETag/cache section (~line 260) + `apps/web/src/lib/settings-hash.ts:7-9` module docstring | `COLOR_IMPACTING_KEYS` has **9** keys (5 color: `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`; 3 quality: webp/avif/jpeg; + `image_sizes`). CLAUDE.md says "5" (and elsewhere "3"); the docstring under-lists. Correct CLAUDE.md to "all 9 color/quality/size-impacting keys; see `COLOR_IMPACTING_KEYS`" and fix the docstring count. Confirm the live count from `settings-hash.ts:34-46` before writing the number. |
| AGG-R7-08(b) (LOW, DOC-04/AGG-14-doc) | CLAUDE.md "Image Processing Pipeline" step 6 (~line 216) | "Single Sharp instance with `clone()` (avoids triple buffer decode)" overstates — the encoder opens a FRESH `sharp(inputPath,…)` per output format AND size (WI-14 cross-format isolation, `process-image.ts:1019-1097`), which contradicts CLAUDE.md's own line 246 ("Per-format fresh `sharp()`"). Reword step 6 so it describes the per-format-fresh-instance reality and the within-format `clone()` for the 10-bit fallback only, not blanket decode reuse. |
| AGG-R7-08(c) (LOW, DOC-02/AGG-23) | CLAUDE.md (process-image.ts row, ~line 92) | `IMAGE_PIPELINE_VERSION = 7` is correct in VALUE but DEFINED in `gallery-config-shared.ts:21` and re-exported at `process-image.ts:303`. Attribute the definition to `gallery-config-shared.ts`. |
| AGG-R7-08(d) (LOW, DOC-03/AGG-22) | CLAUDE.md "Backfill" / "Admin tunables (color/HDR)" | Add the connection-budget arithmetic now in the runner header (after plan-331 item 1 corrects it: cap = max(1, floor((LIMIT−RESERVED−1)/2)), RESERVED = max(3, ceil(LIMIT/2)), → cap **2** at pool 10) AND distinguish the two env vars: in-app `ADMIN_BACKFILL_CONCURRENCY` (default 1, clamped to the pool-budget cap of 2) vs sidecar `BACKFILL_CONCURRENCY` (default 2, uncapped — `--rm` container with its own pool). **Must state cap 2, not the old 4.** |
| AGG-R7-06 (LOW, CRT-5/TEST-4) | plan/plan-330 AGG-17 deferred entry (#4) | The deferral misreads the auth status codes. `withAdminAuth` wrong-SCOPE (token scope) returns **401** and is ALREADY pinned by `api-auth-response-headers.test.ts:103`; **403** is the cross-ORIGIN (CSRF / cookie-path mismatch) branch. Annotate plan-330's AGG-17 entry with a `[CORRECTION run-7]` note: the 401-vs-403 framing was wrong, the wrong-scope status IS tested (401), and the only genuinely-unpinned branch is the cross-origin 403 (LOW; re-open when withAdminAuth status semantics change). Do NOT write a test asserting 403-for-wrong-scope — it would contradict the existing passing 401 test. (Recorded as deferred entry #6 below for the remaining 403 gap.) |

**Acceptance (Unit A):** every corrected count/attribution/formula matches the code at HEAD (re-grep each before writing); CLAUDE.md i18n / plural-asymmetry sections untouched (verified parity 837=837 keys); no history rewrite (use `[CORRECTION run-7]` annotations on prior plans, do not delete their text).

---

## Unit C — correct the stale plan-329 / plan-330 PROGRESS tables (one docs commit · hygiene, MANDATORY)

Five agents converged: the prior run's plans mark items TODO/deferred that are DONE and test-backed at HEAD. Leaving the tables stale risks a future cycle re-scheduling closed work or writing contradictory tests. Update IN PLACE with a `[CORRECTION run-7: verified DONE at HEAD]` note + commit/evidence, do NOT delete the items.

| Plan item | Current marker | Corrected marker | Evidence |
|---|---|---|---|
| plan-329 #2 AGG-10 (home title) | TODO | DONE | `(public)/page.tsx:50` `{ absolute: title }`, both branches; commit 8fc403a2 |
| plan-329 #3 AGG-11 (aria-describedby) | TODO | PARTIAL → remaining wired in plan-331 item 4 | 8 wired at HEAD; ~10 hint `<p>`s remain (plan-331 item 4 finishes) |
| plan-329 #5 AGG-8 (TriState guard) | TODO | DONE | `images.ts:907-916` `isTriState` early `invalidInput`; 4 malformed test cases |
| plan-329 #6 AGG-16 (touch-target Link/anchor) | TODO | DONE | `touch-target-audit.test.ts` scans root files + `<Link>`/`<a>` patterns + synthetic-fail fixtures; commit c1a1227a |
| plan-330 deferred #2 AGG-13 (Select coercion) | deferred-to-plan-325 | DONE | `settings-client.tsx:622` value-coercion present |
| plan-330 deferred #5 AGG-18 (advisory-lock + upload-paths tests) | deferred | DONE | 5 lock constants pinned + non-mocked upload-paths tmpdir test |

**Acceptance:** the tables reflect HEAD reality; a reader of plan-329/330 will not re-open a closed item. (plan-329 item 1 AGG-9 + item 4 AGG-5 remain owned by the working-tree commit this cycle lands; mark them DONE once committed in plan-331's flow / referenced from there.)

---

## Deferred findings (8 entries — severity preserved, exit criteria concrete)

### 1. AGG-R7-A2 / PERF-03 (= AGG-14 perf-half) — per-size full source re-decode in the encoder (LOW perf)
- **Original severity/confidence:** LOW / High · confirmed (architect, perf-reviewer).
- **Where:** `apps/web/src/lib/process-image.ts:~1019-1097` — fresh `sharp(inputPath,…)` per output SIZE; only same-`resizeWidth` outputs hard-link-dedup → up to 3×8=24 (or default 3×6=18) full decodes per image.
- **Reason for deferral:** LOW severity (background-queue CPU only, default concurrency-1; does NOT affect request latency). The architect explicitly REFUTED the prior "unsafe to optimize" framing — a decode-once-clone-WITHIN-a-format optimization IS safe (WI-14 cross-format isolation applies to PARALLEL formats, not within-format sequential `clone()`; the code already uses `clone()` safely on the 10-bit fallback). Sharp `cache(false)` + mmap means it's CPU/IO, not OOM. It remains deferred purely on SCOPE: it's a non-trivial pipeline refactor touching the rgb16 wide-gamut branch, not a drive-by, and the win is realized only during whole-gallery backfill. Not security/correctness/data-loss.
- **Exit criterion:** the encoder fan-out is next refactored for any reason, OR encode CPU becomes a measured production bottleneck (queue backlog / operator report) → implement decode-once-clone-across-sizes WITHIN each format (preserving per-format isolation), with a test pinning no cross-format contamination.

### 2. AGG-R7-10 / BUG-2 — `load-more.tsx` setState-after-unmount (LOW)
- **Original severity/confidence:** LOW / High · confirmed (debugger).
- **Where:** `apps/web/src/components/load-more.tsx:~47-86` — an in-flight `loadMoreImages()` resolving after unmount still runs the setState block; `queryVersionRef` guards stale-query interleaving but not unmount.
- **Reason for deferral:** LOW. Long-standing (not introduced this cycle), same class as plan-331 item 2 but lower frequency (requires unmounting mid-fetch on the infinite-scroll list). The observable symptom is a dev-only React warning + a discarded state write, no user-visible corruption or crash. Plan-331 item 2 fixes the higher-signal sibling (the backfill timers). Not security/correctness/data-loss.
- **Exit criterion:** `load-more.tsx` is next edited for any reason, OR a memory-leak/warning audit prioritizes client-effect cleanup → add an unmount guard (mountedRef or AbortController) mirroring the settings-client `cancelled` pattern.

### 3. AGG-R7-11 / TEST-3 + TEST-5 — test depth gaps (LOW test)
- **Original severity/confidence:** LOW / Med · likely (test-engineer).
- **Where:** `admin-backfill-runner-fatal-counters.test.ts` (single throwing row only — no MIXED `processed>0 && errors>0` run); `migration-journal-monotonicity.test.ts` (adjacent-pair check only, not the real `MAX(created_at)` cursor — idx 8-17 sit below idx 6's `when` yet pass).
- **Reason for deferral:** LOW / Med. The CORE contracts ARE pinned (fatal-counters asserts `errors>0 / lastError / processed===0`; monotonicity asserts the documented allowlist + a synthetic non-monotonic failure). The gaps are DEPTH: a mixed-run assertion and a cursor-semantics assertion would harden against narrower regressions. The migration post-condition assertion in `migrate.js` (the actual deploy-safety guard) IS tested and fires loud on a missing hash. Not security/correctness/data-loss.
- **Exit criterion:** the backfill counter logic or the migration cursor logic is next touched → add (a) a mixed-run fatal-counters case (`processed>0 && errors>0`) and (b) a monotonicity assertion against the real `MAX(when)` cursor, not just adjacent pairs.

### 4. AGG-R7-12 / COR-1 — `containIntrinsicSize` divide-by-`image.width` (LOW latent)
- **Original severity/confidence:** LOW / High (theoretical) · confirmed (code-reviewer).
- **Where:** `apps/web/src/components/home-client.tsx:~280` — `containIntrinsicSize` aspect math divides by `image.width`; a 0-width row yields `Infinitypx`.
- **Reason for deferral:** LOW, near-impossible to trigger — `images.width`/`height` are populated from Sharp metadata at upload and are NOT NULL in the schema; a 0 would require a corrupt/zero-dimension decode that the pipeline already rejects. No live failure path. Not security/correctness/data-loss (a single malformed `content-visibility` hint would degrade scroll perf for one card, not crash).
- **Exit criterion:** `home-client.tsx` intrinsic-size logic is next edited, OR a zero-dimension image is ever observed in production → guard with `image.width > 0 ? … : <sane default>`.

### 5. AGG-R7-A1 / AGG-R7-A3 / AGG-R7-A4 — single-pool / single-writer architectural tradeoffs (MED arch, record-only)
- **Original severity/confidence:** MED / High–Med · architect (ARCH-02, PERF-04, ARCH-05).
- **Where:** AGG-R7-A1 — the AGG-5 reserve protects exactly ONE concurrent `getImage` fan-out, so 2+ simultaneous visitors during a backfill still queue (`admin-backfill-runner.ts` + `db/index.ts` pool=10). AGG-R7-A3 — `getImage` prev/next range scans run 3 uncached concurrent connections on every photo view because public pages set `revalidate=0`. AGG-R7-A4 — backfill PQueue + live image-queue share libvips capacity with no shared CPU budget.
- **Reason for deferral:** these are INHERENT properties of the documented single-web-instance / single-writer topology (CLAUDE.md "Runtime topology"), not defects. The `revalidate=0` freshness choice is deliberate and documented ("public routes currently set `revalidate = 0` so asynchronous image processing and metadata updates are visible immediately"). Backfill is an operator-initiated maintenance op, expected to contend. Raising the pool, adding a separate backfill pool, or reintroducing ISR are all DESIGN changes with their own tradeoffs and explicit CLAUDE.md guardrails ("Reintroduce ISR only with an explicit invalidation/freshness plan"). Not security/correctness/data-loss. Recorded so a future scaling effort has the analysis.
- **Exit criterion:** the deployment moves off single-instance (horizontal scale), OR live-traffic contention during backfill is measured as a production problem → revisit pool sizing / a dedicated backfill connection budget / selective ISR with an invalidation plan, per the CLAUDE.md ISR guardrail.

### 6. AGG-R7-06 (residual) — cross-origin 403 branch of `withAdminAuth` unpinned (LOW test)
- **Original severity/confidence:** LOW / Med · likely (critic CRT-5, test-engineer TEST-4).
- **Where:** `withAdminAuth` (`apps/web/src/lib/api-auth.ts`) cross-origin / cookie-path-mismatch branch returns 403; only the wrong-SCOPE 401 branch is pinned (`api-auth-response-headers.test.ts:103`).
- **Reason for deferral:** LOW. The auth wrapper's PRESENCE on every admin route is enforced by the `lint:api-auth` blocking gate; the wrong-scope 401 is tested; the un-pinned detail is only the cross-origin 403 status. No security gap (cross-origin IS rejected; 403-vs-401 is a status-code nicety). The Unit-A correction fixes the plan-330 misread that conflated the two. Not security/correctness/data-loss.
- **Exit criterion:** `withAdminAuth` status semantics are next changed, OR a route relies behaviorally on the 403 → add a test asserting the cross-origin branch returns 403, alongside the existing 401 wrong-scope test.

### 7. AGG-R7-13 / TRC-2 — Stripe `async_payment_succeeded` never writes an entitlement (HIGH · already-owned)
- **Original severity/confidence:** HIGH / High · confirmed (security-reviewer, tracer, critic).
- **Where:** `apps/web/src/app/api/stripe/webhook/route.ts:88,105` (only `checkout.session.completed`+`payment_status==='paid'`); `apps/web/src/app/api/download/[imageId]/route.ts:166` (permanent `404 "Token not found"` for ACH/bank-transfer settled payments).
- **Reason for deferral — repo rule quoted:** ALREADY-OWNED by plan-316 CRT-R5C1-04 and explicitly documented in CLAUDE.md verbatim: *"`checkout.session.async_payment_succeeded` is not yet handled — delayed payment methods (bank transfer / ACH) complete checkout but never receive an entitlement row; only card / immediate-payment methods are fully supported until plan-316 CRT-R5C1-04 ships."* Per the deferred-fix rule, security/correctness findings may be deferred when "the repo's own rules explicitly allow it" — CLAUDE.md explicitly scopes payment-method support to card/immediate and assigns the gap to plan-316. No data loss (funds settle in Stripe; the entitlement row is recoverable manually or via the Stripe dashboard once the handler ships). This cycle does NOT re-own it. Interim operator mitigation: disable async payment methods in Stripe Checkout.
- **Exit criterion:** plan-316 CRT-R5C1-04 is picked up (add an idempotent `async_payment_succeeded` handler), OR an operator reports a real settled-but-undownloadable ACH purchase → escalate to an active plan item immediately (HIGH, not deferrable further once a real customer is affected).

### 8. AGG-25 (carried) — 2 moderate transitive `postcss` + 3 high `esbuild` advisories via the Next/drizzle-kit/tsx toolchain (INFO)
- **Original severity/confidence:** INFO / High · security-reviewer.
- **Where:** transitive `postcss` (via Next), `esbuild` (via drizzle-kit/tsx) — ALL dev/build-time, absent from the prod-deps runtime container.
- **Reason for deferral — repo rule quoted:** build-time-only transitive advisories with no runtime request-path exposure. The global CLAUDE.md "Always Use Latest Versions" rule mandates latest STABLE Next; `npm audit fix --force` would downgrade Next (the reviewer measured → next 9.3.3) off its pinned stable major (CLAUDE.md "Next.js 16.2"), contradicting that rule. Not runtime-exploitable in a self-hosted gallery whose build is trusted. Aggregator-classified dependency note, not an open application vulnerability.
- **Exit criterion:** Next.js ships a stable release whose toolchain bumps `postcss`/`esbuild` past the advisories (adopt on the normal latest-version upgrade cadence), OR a runtime exposure is demonstrated. Do NOT `audit fix --force`.

---

## Progress

| Unit / Entry | Commit | Status |
|---|---|---|
| Unit A — CLAUDE.md docs (COLOR_IMPACTING_KEYS=9, Sharp wording, pipeline-version, backfill env vars) + settings-hash docstring | 10d77324 | DONE |
| Unit A — 401/403 deferral-note correction (plan-330 AGG-17) | (this plan-docs commit) | DONE |
| Unit C — plan-329 table + plan-330 AGG-13/AGG-18 corrections | (this plan-docs commit) | DONE |
| Deferred 1-8 | n/a (recorded) | RECORDED |
