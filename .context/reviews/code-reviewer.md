# Code Review — Cycle 8/100 (code-quality angle)

**Reviewer:** code-reviewer agent (ran in read-only context — `Write` blocked; report persisted by orchestrator per the documented write-recovery pattern)
**HEAD:** `9c40d261` (working tree clean at sweep end; one untracked stray file existed at sweep start — see CR8-01, now removed)
**Date:** 2026-06-14

**Files Reviewed:** ~40 high-value surfaces across actions / lib / api routes / db / components / proxy / scripts.
**Total Issues:** 1 (LOW, self-resolved mid-review).

## By Severity
- CRITICAL: 0
- HIGH: 0
- MEDIUM: 0
- LOW: 1

## Findings

| ID | file:line | Severity | Confidence | One-line |
|----|-----------|----------|------------|----------|
| CR8-01 | `apps/web/tmp-probe-webp.test.ts` (untracked, now deleted) | LOW | High | Throwaway WebP test-probe with a deliberate `FORCE_FAIL_TO_PRINT` assertion left in repo root after the cycle-7 AGG-C7-02 investigation; transiently flaked the typecheck gate. Removed during this review. |

### [LOW] CR8-01 — stray throwaway test probe (RESOLVED at HEAD)

`apps/web/tmp-probe-webp.test.ts` (untracked; deleted during this review — confirmed gone from disk + `git status`). A ~40-line throwaway vitest probe (created `2026-06-14 00:02`, after the cycle-7 fixes were committed) whose sole assertion is `expect(out).toBe('FORCE_FAIL_TO_PRINT')` to dump WebP chunk-layout diagnostics.

Two verified impacts:
1. **Transient typecheck flake** — `tsconfig.typecheck.json` `include` is a bare `**/*.ts` with `exclude` only `node_modules/scripts/.next/dev`, so a first `npm run typecheck` could hit `TS6053 File ... not found ... Matched by include pattern '**/*.ts'`; clean re-runs passed (the file is type-valid), so transient not durable.
2. **Latent test-gate landmine** — it is a `*.test.ts` that fails by design, currently inert only because the vitest `include` is narrowly `['src/__tests__/**/*.test.ts']` and this file is at the repo root (`vitest run` → "No test files found").

**No code change required at HEAD** (file is gone; both durable gates pass). Optional forward hardening: add `tmp-*.ts` to `.gitignore` and/or tighten `tsconfig.typecheck.json include` from `**/*.ts` to `src/**`. Status: RESOLVED at HEAD.

## Positive Observations (verified clean, stress-tested at HEAD)

- **All five cycle-7 fixes (AGG-C7-01..05) landed, correct, and non-vacuously tested.** `isLosslessWebpByChunk` (`process-image.ts:1498-1518`) walks RIFF chunks, even-pads, overflow-guards, fails-closed to lossy; its test proves the planted-`VP8L`-in-XMP regression (asserts the naive scan WOULD match, then the chunk-aware check returns false). The WebP XMP JUNK-retag test asserts VP8-pixel byte-identity (catches a wrong JUNK offset). `admin-header.tsx:16` has `min-h-11`.
- **Privacy boundary airtight** — `publicSelectFields`/`publicMapSelectFields` derived by destructuring-omission, two compile-time `Extract` guards, `getMapImages` uses the map field set + `map_visible` inner JOIN + runtime row assertion.
- **Payment/download flow** — open-before-claim, file-handle closed on every post-open path, idempotency with mysql2-FOUND_ROWS dup-key disambiguation, constant-time token verify, charged-404s.
- **Queue/backfill** — exhaustive result partitions, locks released in `finally`, detection-failure no-version-bump resume contract, deleted-mid-reencode cleanup, bounded retry maps.
- **NCLX `colr` walker, smart-collections compiler, admin-token scope allowlist, session HMAC-before-shape, proxy guard, OG route SSRF/enumeration defenses** — all confirmed correct at HEAD.
- **Gates green:** `npm run typecheck` (app+scripts) exit 0 on clean re-runs; vitest scope excludes the CR8-01 probe.

## Recommendation

**COMMENT** — No CRITICAL/HIGH/MEDIUM issues. The single LOW finding (CR8-01) is build/test hygiene that self-resolved during the review; no scheduled work required at HEAD `9c40d261` unless the team wants the cheap `.gitignore`/`tsconfig` forward-hardening. The cycle-7 fix batch is correct, complete, and well-tested; no prior-closed finding has regressed and no new logic/correctness/SOLID/maintainability defect was found. **Convergence holds.**
