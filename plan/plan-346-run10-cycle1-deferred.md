# Plan 346 — Run-10 Cycle-1 (orchestrator cycle 8/100) — Deferred Findings

**Created:** 2026-06-14
**HEAD at planning:** `9c40d261`
**Source:** `.context/reviews/_aggregate.md` (cycle-8 fan-out) + per-agent reviews
**Status:** RECORD-ONLY (no implementation scheduled this cycle)

## Purpose

Per the review-plan-fix STRICT deferred-fix rules, EVERY review finding must be either scheduled (plan-345) or explicitly recorded here. This file records all cycle-8 record-only / re-confirmed-deferred findings with: original severity/confidence (NOT downgraded), concrete reason for deferral, and the exit criterion that re-opens it.

**Repo-rule check (done before deferring):** Read CLAUDE.md, AGENTS.md, `.context/**`. None of the deferred items below is a non-deferrable security / correctness / data-loss finding:
- AGG-C8-R2 (DBG8-NC-02) touches the GPS-strip path but is privacy-SAFE — GPS is stripped either way; only output file size on a doubly-rare fallback differs. CLAUDE.md "Privacy" section requires GPS to be scrubbed on the delivered original; this item does NOT violate that (scrubbing still happens).
- AGG-C8-R-FLAKE is test-infrastructure nondeterminism, not a code defect (the scrubber/roundtrip code is proven correct).
- AGG-C8-R3 (CR8-01) is already RESOLVED (file deleted this cycle).
- The rest are doc nuances, supplementary-test structure, or prior-deferred architecture/perf/design/security items unchanged from earlier cycles.

When any of these is eventually picked up, it remains bound by repo policy: GPG-signed commits (`-S`), conventional-commit + gitmoji, no `Co-Authored-By`, `git pull --rebase` before push, no `--no-verify`, required Node 24+/TS 6+ toolchain, all gates green.

---

## DEFERRED — this cycle (cycle 8)

### AGG-C8-R1 — TE8-02: `map-privacy.test.ts` runtime guard tests are a structural mirror

- **File:** `apps/web/src/__tests__/map-privacy.test.ts:90-118`
- **Severity:** LOW | **Confidence:** Medium | **Agent:** test-engineer (TE8-02)
- **Finding:** The runtime GPS-leak-guard tests re-implement the guard predicate inline rather than calling the real `getMapImages` field-selection. A `getMapImages` regression that leaked a GPS column would not be caught by these specific tests (though it WOULD be caught by the compile-time UNION contract at `:58-71` and the runtime `getMapImages` throw).
- **Reason for deferral:** The genuine protection — the compile-time UNION contract + the runtime row assertion in `getMapImages` — is sound, present, and covers the column-leak vector. The mirror tests are belt-and-braces supplementary coverage, not the load-bearing guard. Rewriting them to call the real predicate is a test-quality improvement of marginal value at convergence; it is not closing an actual exposure.
- **Exit criterion:** Re-open if (a) the compile-time UNION contract is ever weakened/removed, OR (b) a future change makes `getMapImages` the sole privacy guard for the map surface (then the runtime test must exercise the real predicate, not a mirror).

### AGG-C8-R2 — DBG8-NC-02: `isLosslessWebpByChunk` does not descend into `ANMF` (animated-lossless WebP)

- **File:** `apps/web/src/lib/process-image.ts:1498-1518` (comment `~:1511`)
- **Severity:** LOW (quality) | **Confidence:** High | **Agent:** debugger (DBG8-NC-02)
- **Finding:** The bounded RIFF walker added in cycle-7 (`85bca582`) does not recurse into `ANMF` container chunks, so an *animated lossless* WebP that reaches the doubly-rare Tier-2 GPS re-encode fallback (i.e. `stripGpsFromWebpBuffer` returned `null`) would be re-encoded as lossy. The inline comment reads mildly aspirational vs. the implementation.
- **Reason for deferral:** **Privacy-SAFE** — GPS is stripped by the re-encode regardless of the lossless/lossy boolean, so there is zero privacy or correctness impact. The only consequence is a possibly-larger output file on a path that requires BOTH (1) a malformed/unhandled WebP that fails the in-place scrubber AND (2) that file being an animated lossless WebP — vanishingly rare. Same disposition the team chose for the prior substring-scan note. Descending into `ANMF` is a quality nicety, not a defect fix.
- **Exit criterion:** Re-open if animated-lossless WebP becomes a common ingest format AND the Tier-2 fallback path is observed firing on them in production (oversized stored originals), OR if the lossless boolean ever gains a privacy/correctness role beyond file-size. Optional: tighten the `:1511` comment to match the implementation when next editing this file.

### AGG-C8-R3 — CR8-01: stray throwaway probe `tmp-probe-webp.test.ts` (ALREADY RESOLVED)

- **File:** `apps/web/tmp-probe-webp.test.ts` (untracked)
- **Severity:** LOW (build hygiene) | **Confidence:** High | **Agent:** code-reviewer (CR8-01)
- **Finding:** A ~40-line throwaway vitest probe with a deliberate `FORCE_FAIL_TO_PRINT` assertion, left in the repo root after the cycle-7 AGG-C7-02 investigation. Transiently flaked `npm run typecheck` (bare `**/*.ts` include + `TS6053`); inert under vitest (root-level file outside the narrow `src/__tests__/**` include).
- **Reason for deferral:** **Already RESOLVED** — the file was deleted during this cycle's fan-out (confirmed gone from disk; `git status` clean). No code change required at HEAD; both durable gates pass.
- **Exit criterion:** N/A (resolved). Optional cheap forward-hardening if a similar stray recurs: add `tmp-*.ts` to `.gitignore` and/or tighten `tsconfig.typecheck.json` `include` from `**/*.ts` to `src/**`.

### AGG-C8-R4 — DOC8-01: AGENTS.md `.context/plans/` "gitignored" nuance

- **File:** `AGENTS.md:40`
- **Severity:** LOW (doc nuance) | **Confidence:** High | **Agent:** document-specialist (DOC8-01)
- **Finding:** AGENTS.md:40 states `.context/plans/` "is gitignored — local plan-management artifacts only", but `git ls-files` shows tracked artifacts and no `.gitignore` rule matches `.context/plans/`; the live, tracked plans live in repo-root `/plan/`. Same as prior DOC-C7-01.
- **Reason for deferral:** Does not mislead any security or correctness decision. The sentence is about a local-artifacts directory convention; the actual tracked plan directory (`/plan/`) is unaffected and the loop has operated correctly against it for 8+ cycles. Cosmetic doc-accuracy item.
- **Exit criterion:** Re-open if `.context/plans/` is ever actually used for tracked artifacts (then either add the `.gitignore` rule the doc claims, or correct the sentence), OR fold into the next docs-cleanup pass.

### AGG-C8-R-FLAKE — real-encode AVIF/WebP test-isolation flake (= AGG-C7-R7 / AGG-C4-T2)

- **Files:** `apps/web/src/__tests__/process-image-color-roundtrip.test.ts:31-44`, `backfill-color-pipeline.test.ts`, `strip-gps-from-original.test.ts:282` (the WebP-XMP gate's cold-first-run null path)
- **Severity:** LOW (test infra; run-to-run nondeterministic) | **Confidence:** High | **Agents:** critic (CRIT8-R1), tracer (TRC8-01), verifier (OBS-1, typecheck variant)
- **Finding:** Under concurrent multi-agent load this cycle, the real-encode tests intermittently failed cold (critic: 4 failed/2093 on a cold parallel run; tracer: WebP-XMP gate failed once cold via a `dataEnd > buf.length` cold-encoder-anomaly null-path) then passed on every isolated / `--no-file-parallelism` / combined re-run. Verifier saw a one-off cold `typecheck` blip (a `next typegen` race under concurrent vitest) that cleared on isolated re-runs. The orchestrator's own baseline `vitest run` was GREEN (2093/2093) and `typecheck` exit 0.
- **Reason for deferral:** This is a flaky GATE (cold-encoder + shared `public/uploads` output dir + file-parallelism sensitivity), **NOT a source defect** — the GPS scrubber and roundtrip code are proven correct by independent reproduction. Product code needs no change. The fix is test-infrastructure hardening (scoped `mkdtemp` per-test output isolation + a `beforeAll` encoder warm-up), which has been the documented DEFERRED fix across prior cycles.
- **Exit criterion:** Re-open when a green-cold guarantee is required for a non-parallel CI lane, OR if the flake escapes onto CI and blocks a deploy. Then implement per-test `mkdtemp` output isolation + encoder warm-up.

---

## RE-CONFIRMED DEFERRED — from prior cycles (UNCHANGED at HEAD `9c40d261`; do NOT re-escalate)

### AGG-C8-R5 — ARC8-01: `search.tsx` runtime-imports from `@/lib/clip-embeddings` (NON-DEFECT)

- **File:** `apps/web/src/components/search.tsx:1` → `@/lib/clip-embeddings`
- **Severity:** LOW (non-defect, already guarded) | **Confidence:** High | **Agent:** architect
- **Finding/Disposition:** `'use client'` `search.tsx` imports only the numeric `SEMANTIC_TOP_K_DEFAULT` + the pure `topK` from a module that also exports `Buffer`-using functions. NOT a leak: tree-shaking drops the Buffer fns, the module has no `server-only` directive / no DB-Node top-level import, and `client-server-only-boundary.test.ts:153` already guards the only forward risk. **Fix: none.** Recorded so it is not re-flagged as novel next cycle.
- **Exit criterion:** Re-open only if `@/lib/clip-embeddings` gains a `server-only` directive or a top-level Node/DB import when the CLIP stub is productionized — at which point split a `clip-embeddings-shared.ts` for the client-safe constants. (The boundary test will fail loudly and force this.)

### AGG-C8-R6 — architecture deferrals (AGG-C7-R1..R4), re-confirmed UNCHANGED by live source re-count

- **AGG-C7-R1** — WI-09 color-pipeline writer consolidation. 5 color-column write touchpoints / 4 modules (`actions/images.ts:352`, `api/admin/lr/upload/route.ts:376`, two `admin-backfill-runner.ts` branches, two `scripts/backfill-color-pipeline.ts` branches). **Severity: MED (maintainability).** Reason: the two backfill writers are byte-equivalent and contract-locked by tests; the LR-PAT INSERT is a deliberately-mirrored parallel writer from US-P53; no drift observed. Consolidation is a refactor, not a defect fix. **Exit criterion:** re-open when WI-09 (HDR AVIF encoder) ships and the writer set must change anyway, OR if the paired writers are observed to drift (the contract tests would fail).
- **AGG-C7-R2** — `lib/api-auth.ts:1` imports `isAdmin` from `@/app/actions/auth` — the SOLE lib→app layering inversion, no cycle. **Severity: LOW (arch).** Reason: harmless, no circular dep; relocating `isAdmin` is churn at convergence. **Exit criterion:** re-open if a second lib→app inversion appears (signals a pattern) or a cycle forms.
- **AGG-C7-R3** — `COLOR_IMPACTING_KEYS` (9 keys, `settings-hash.ts:37-49`) hand-maintained not derived. **Severity: LOW (arch hardening).** Reason: a forgotten key would weaken cache-invalidation, but the list is small, documented, and stable. **Exit criterion:** re-open if a color-impacting setting is added without updating the list (cache-staleness bug), or build a compile-time derivation.
- **AGG-C7-R4** — `@/lib/storage` (~390 LOC) dead seam, only importer is its own barrel. **Severity: LOW.** Reason: honestly self-documented as unwired per CLAUDE.md; removing it discards a planned S3/MinIO seam. **Exit criterion:** re-open when the storage backend is wired end-to-end (then it's live, not dead) OR a decision is made to drop S3/MinIO support entirely (then delete it).

### AGG-C8-R7 — perf record-only (RC-1..RC-8 + PERF-C7-OBS-1), re-confirmed UNCHANGED

All bounded / documented-intentional, no live defect: RC-1 SW metadata lost-update (best-effort by design), RC-2 bootstrap `inArray` ≤1000 IDs, RC-3 decode-per-format WI-14 (~18/image, intentional anti-contamination), RC-4 Atom filesort bounded, RC-5 timeline non-sargable bounded, RC-6 single-pool/10 single-writer topology, RC-7 `getMapImages` unbounded (PERF-R4C15-B), RC-8 analytics 'all'-window temp-table (PERF-R5C2-01), PERF-C7-OBS-1 semantic-search ≤5000 512-dim vectors on event loop (bounded+capped+rate-limited+default-disabled stub). **Severity: LOW.** **Exit criterion (each):** re-open if the bound is exceeded in production (e.g. RC-7 `getMapImages` returns 10k+ rows and the map page janks; RC-2 bootstrap exceeds 1000 unprocessed; PERF-C7-OBS-1 semantic search is productionized beyond the stub cap) — then add pagination / move work off the event loop / shard the pool as appropriate.

### AGG-C8-R8 — designer prior-deferred trio (DES-C5-2/3/4), re-confirmed OPEN, none a WCAG A/AA failure

- **DES-C5-2** — nav theme/locale/expand `<button>`s + brand/topic `<Link>`s lack `focus-visible:ring` (`nav-client.tsx:85,93,122,155,166`). UA-default outline still applies → NOT a hard WCAG 2.4.7 failure. **Severity: LOW.**
- **DES-C5-3** — color-pip `text-white/50` gamut suffix = 5.15:1 (passes AA 4.5:1, thinnest margin; `lightbox-color-pip.tsx:237`) + faint histogram dotted-underline (`histogram.tsx:691`, decorative). **Severity: LOW.**
- **DES-C5-4** — `photo-viewer.tsx:816` topic `<Badge>` renders raw slug `{image.topic}` (sibling Back button + search both humanize). **Severity: LOW.**
- **Reason for deferral:** all three pass WCAG A/AA; they are polish (explicit focus-ring consistency, thin-margin contrast bump, slug humanization). **Exit criterion:** fix together in a dedicated UI-polish pass, OR re-open any one if it regresses below AA (e.g. the 5.15:1 suffix drops under 4.5:1) or if keyboard-only users report lost focus on the nav controls.

### AGG-C8-R9 — SEC8-01: dependency CVEs (A06), re-confirmed UNCHANGED

- **Finding:** 2 moderate prod (`postcss` XSS-in-stringify via `next`, build-time over first-party CSS — not runtime-exploitable) + 3 high dev-only (`esbuild` via `tsx`/`drizzle-kit`). **Severity: LOW** (dev-only / build-time, not runtime-exploitable). **Agent:** security-reviewer.
- **Reason for deferral:** not actionable — the available fixes are downgrade-only (would downgrade Next.js below the required-latest policy in CLAUDE.md); the production runtime dependency tree is clean. Per CLAUDE.md "Always Use Latest Versions", downgrading Next is disallowed.
- **Exit criterion:** re-open when an upstream non-downgrade fix is published (Next.js bumps its bundled `postcss`; `tsx`/`drizzle-kit` bump `esbuild`) — then `npm update` and re-audit.

### AGG-C8-R10 — DBG8-NC-01: harmless unreachable guard in `gain-map-detection.ts`

- **File:** `apps/web/src/lib/gain-map-detection.ts:87` (`if (p > limit) return ''` after a `while (p < limit)` loop that guarantees `p <= limit` on exit)
- **Severity:** LOW (harmless dead code) | **Confidence:** High | **Agent:** debugger (= DBG-C6-NC-01)
- **Reason for deferral:** unreachable defensive guard, zero functional impact; removing it is cosmetic churn at convergence.
- **Exit criterion:** remove opportunistically when next editing `gain-map-detection.ts`; no standalone work warranted.

---

## Summary

- **NEW deferred this cycle:** AGG-C8-R1, R2, R3 (resolved), R4, R-FLAKE.
- **Re-confirmed deferred (unchanged):** AGG-C8-R5..R10 (architecture, perf, designer, security, debugger).
- **None** is a non-deferrable security / correctness / data-loss finding. The two non-deferred NEW findings (AGG-C8-01 test gap, AGG-C8-02 doc line) are scheduled in plan-345.
- **No finding was silently dropped.** Every cycle-8 review finding is either in plan-345 (scheduled) or recorded above (deferred with severity + exit criterion).
