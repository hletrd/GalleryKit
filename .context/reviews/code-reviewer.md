# Code Reviewer — Deep Review (Run-6 Cycle-7)

- **HEAD:** `a7758ef0`
- **Agent:** code-reviewer (oh-my-claudecode:code-reviewer)
- **Date:** 2026-06-17
- **Angle:** logic bugs, SOLID, maintainability, error-handling, data-flow / state-consistency, edge cases, cross-file interactions.

## Verdict

**APPROVE — 0 actionable findings.** (CRITICAL 0 / HIGH 0 / MEDIUM 0 / LOW 0.)

The two cycle-6 findings (AGG-C6-01 HDR-badge contrast; AGG-C6-02 boundary-classifier coverage) are both **closed at HEAD** with fixes I independently verified as correct, complete, and non-vacuously tested. The cycle-5→HEAD production delta is exactly four one-token color-class edits. Every codebase-wide sweep is clean and all gates are green. An honest 0/0 — consistent with the documented convergence (11 → 45 → 14 → 5 → 1 → 2 → **0**).

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 0 |

## What HEAD actually is

`a7758ef0` is the **cycle-6 review+plan doc commit** — it touches only `.context/reviews/*.md` and `plan/*.md`. **No source changed in this commit.**

The full **production-source** delta since the cycle-5 clean baseline (`2f603716..a7758ef0`, verified via `git diff --name-only`) is four files, each a single `text-white` → `text-amber-950` className change in commit `5af25dc7`:

- `apps/web/src/components/color-details-section.tsx:526`
- `apps/web/src/components/image-manager.tsx:526`
- `apps/web/src/components/info-bottom-sheet.tsx:278`
- `apps/web/src/components/lightbox-color-pip.tsx:151`

Plus one **test-only** change (`204e8594`, `client-server-only-boundary.test.ts`) and a new test fixture (`hdr-badge-contrast.test.ts`). Everything else in the diff is docs/plans.

## Cycle-6 finding closures — independently verified at HEAD

### AGG-C6-01 (HDR badge contrast) — CLOSED, fix correct + complete
- All four badges now use `text-amber-950` on the `from-amber-300 to-orange-400` gradient. Grep sweep for `from-amber-300` across `components/` + `admin/` returns **exactly these four sites, all with `text-amber-950`** — zero residual `text-white`+amber-gradient pairs anywhere in the tree.
- **Contrast math independently recomputed** (WCAG 2.x sRGB relative luminance, Tailwind v3.4 palette): white/amber-300 = **1.44:1** (the old FAIL), `text-amber-950`/orange-400 = **6.62:1** (worst gradient stop, PASS ≥ 4.5:1), `text-amber-950`/amber-300 = 10.39:1. The forbidden alternative `text-amber-900`/orange-400 = **4.01:1** (correctly rejected). My numbers match the fix commit and the fixture comment to the second decimal.
- The regression pin `hdr-badge-contrast.test.ts` is **non-vacuous**: per component it asserts (a) the gradient is present, (b) the badge className does NOT contain `text-white`, (c) it DOES contain `text-amber-950` and NOT `text-amber-900`. A refactor that drops the gradient trips the non-vacuity guard; a regression to white/amber-900 fails (b)/(c). Ran it: **PASS**.

### AGG-C6-02 (boundary classifier dynamic-import/import-equals gap) — CLOSED, fix sound
- `extractAliasedImports` now descends the full AST via `ts.forEachChild`, capturing dynamic `import('…')` (CallExpression + `ImportKeyword` + string-literal arg) and `import x = require('…')` (`ImportEqualsDeclaration` + external-module-reference), de-duped via `Set`. The reasoning ("both forms ALWAYS pull a value, so any aliased specifier is a value edge") is correct — there is no type-only dynamic import or type-only import-equals-require in TS.
- The new test case carries **9 assertions** including nested-in-function-body dynamic import, non-aliased ignore (`react`, `node:path`), and static+dynamic de-dupe. Non-vacuous. Ran it: **PASS** (combined 18/18 with the contrast fixture).
- **Trigger surface re-confirmed empty at HEAD:** the only dynamic `import('@/lib…')` sites are in `src/instrumentation.ts` (server `register()` — not a `'use client'` module, unreachable from any client closure); zero `import = require('@/lib|@/db')` sites. Today's boundary is genuinely clean; this was correctly latent future-coverage hardening.
- **HARD GUARD #1 respected:** `@/db` carries NO `server-only` marker; the test uses `mysql2`-in-closure as the server-only-equivalent signal. This is the correct alternative and is exactly why `server-only` would break the tsx-run backfill sidecar.

## Files examined in full (not sampled)

Inventory: 234 non-test source files under `apps/web/src`. Prioritized the cycle-5→HEAD delta, then re-read the highest-risk correctness/security surfaces and ran codebase-wide pattern sweeps for the long tail.

- All four changed components (the `text-amber-950` edits, in full context around the badge).
- `lib/photo-title.ts` (full) — display-title / alt-text derivation (see INFO below).
- `lib/smart-collections.ts` (parse/validate L300-364) — JSON.parse guard + depth limit + scalar-type enforcement + column/operator allowlists. Well-hardened.
- `__tests__/client-server-only-boundary.test.ts` (the AST classifier + new cases).
- `__tests__/hdr-badge-contrast.test.ts` (the new fixture, full).
- Plus the carry-forward read set from prior cycles confirmed unchanged byte-for-byte vs the clean baseline: backfill runner + sidecar, image-queue, serve-upload, semantic route, checkout, Stripe webhook, download, LR-upload, data.ts privacy guards + view-count buffering, process-image color resolvers, all JSON.parse sites, validation.ts.

## Codebase-wide sweeps (clean)

- **`parseInt`/`parseFloat` missing radix** — none. All radix-10 (regex-filtered sweep returns empty).
- **Empty catch blocks** — none real. Every `catch {}` / `.catch(() => {})` hit is legitimate best-effort cleanup (fs.unlink of temp/orphan derivatives, advisory-lock `RELEASE_LOCK`, `document.exitFullscreen`, rate-limit rollback, session-delete) or a comment in image-queue.ts. None swallow a load-bearing error.
- **`JSON.parse` without try/catch + shape validation** — none. The 2 lib sites (`admin-tokens.ts:120`, `smart-collections.ts:310`) both wrap parse in try/catch and structurally validate the result; the route/component sites (semantic route, wide-gamut-hint) likewise guard.
- **Sequential `await db.*` in `for…of` (N+1)** — none in `lib/` or `app/actions/`.
- **action-origin coverage** — intact (only `auth.ts`/`public.ts` excluded; lint gate enforces).

## Gates (re-run at HEAD)

- **`typecheck:app`** — exit **0**. `✓ Types generated successfully`, `tsc -p tsconfig.typecheck.json --noEmit` clean, zero `error TS`.
  - *Transient flake disclosed:* the first combined-gate invocation surfaced `npm error code 2` from the typecheck step. It **did not reproduce** on an isolated re-run (`next typegen` alone exit 0; full `typecheck:app` exit 0). Root cause: a `.next/dev` artifact modified at 16:18 today (a dev server had been touching the build dir), racing `next typegen`. This is an environmental tooling artifact, NOT a code regression at HEAD — recorded for transparency, not a finding. The cycle-6 verifier's "typecheck exit 0" holds.
- **ESLint (`npm run lint`)** — exit **0**, no warnings/errors.
- **Cycle-6 fix tests** — `hdr-badge-contrast.test.ts` + `client-server-only-boundary.test.ts` → **18/18 PASS** (569 ms).

## INFO / VERIFIED-CORRECT (not findings)

1. **`getConcisePhotoAltText` mangles a literal internal `#` in a real title** (`photo-title.ts:119-121`). When a meaningful `title` exists, `getPhotoDisplayTitleFromTagNames` returns it verbatim, then `.replace(/\s+#/g, ', ')` turns a title like `"Race #3"` into alt text `"Race, 3"`. **Confirmed real but correctly below the anti-noise threshold** (same disposition as the cycle-6 code-reviewer): alt-text-only (never visible title / `<title>` / OG meta — those take the un-stripped `getPhotoDisplayTitle` path), cosmetic, the alt text remains present and distinguishable (no a11y-AA failure — it's a Level-A name-quality nit, not a contrast/missing-name defect), and an admin-authored title with an internal `#` is vanishingly rare. No correctness/security/data-loss/AA impact → not commit-worthy under the strict rule. Flagged only for completeness.

2. **HARD GUARDs both respected.** No proposal to activate CLIP/semantic_search (the route remains `model_version`-isolated and disabled-by-default by design); no proposal to add `server-only` to `@/db` (the boundary test's `mysql2`-in-closure signal is the correct substitute).

## Conclusion

The entire production change since the last clean baseline is four correct one-token a11y color fixes whose contrast math I recomputed from scratch, plus a sound, non-vacuously-tested test-only hardening whose trigger surface I re-confirmed empty. Every hot-path and security/correctness-critical surface carries explicit, layered invariants with locking tests. No real regression, latent bug, SOLID violation, data-flow defect, or AA failure survives verification at HEAD `a7758ef0`. **0/0 — APPROVE — is the correct, honest result.**
