# Plan 357 — Run 6 / Cycle 6 fixes (from reviews)

**Source:** `.context/reviews/_aggregate.md` (cycle-6 deep review, 11/11 agents, 0 failures) + per-agent files.
**HEAD at planning time:** `4eb83aab`
**Author:** review-plan-fix cycle 6
**Date:** 2026-06-17

**Repo policy reminders (apply to every commit here):** GPG-sign (`-S`), NO `Co-Authored-By`, conventional-commit + gitmoji, `git pull --rebase` before push, fine-grained one-commit-per-fix, push after each commit, run `npm run typecheck --workspace=apps/web` before committing test changes, run all GATES (eslint, typecheck, vitest, lint:api-auth, lint:action-origin, lint:public-route-rate-limit) before claiming done, no suppressions unless repo rules authorize (quote the rule in the body).

---

## Scope

Cycle 6's fresh 11-agent fan-out produced **2 actionable findings** (the system remains at the convergence boundary; 9/11 agents at literal zero). Both are scheduled here; **nothing is deferred this cycle** (the INFO items are non-actionable per repo rules — see "Not deferred / non-actionable" below).

| ID | Severity / Conf | Title | Disposition |
|----|------|-------|-------------|
| AGG-C6-01 (DES-C6-M1) | MEDIUM / High | "HDR" badge text fails WCAG 1.4.3 AA contrast on its amber gradient | TASK-1 (this cycle) |
| AGG-C6-02 (DBG-C6-01) | LOW / High | client→server-only boundary classifier misses dynamic-import & import-equals value forms | TASK-2 (this cycle) |

---

## TASK-1 — AGG-C6-01: fix HDR-badge text contrast (MEDIUM)

**Finding:** The visible "HDR" badge renders `text-white` on `bg-gradient-to-r from-amber-300 to-orange-400`. WCAG-luminance contrast is **1.44:1** at the amber-300 stop and **2.26:1** at the orange-400 stop; SC 1.4.3 (Contrast Minimum, AA) requires **4.5:1** for the 10–12 px bold glyph (not "large text"). Out-of-policy: the repo enforces AA elsewhere (destructive-text token, histogram labels). Admin-only surface (badge gated on `isAdmin && isHdr`) so no end-user exposure, but the AA contract is unconditional here.

**Sites (4) — all `text-white` on the amber→orange gradient:**
- `apps/web/src/components/color-details-section.tsx:526` (`.hdr-badge` class present)
- `apps/web/src/components/lightbox-color-pip.tsx:151` (`.hdr-badge` class present)
- `apps/web/src/components/info-bottom-sheet.tsx:278` (no `.hdr-badge` class)
- `apps/web/src/components/image-manager.tsx:526` (no `.hdr-badge` class)

**Orchestrator-verified contrast math (sRGB WCAG luminance, Tailwind v3.4.19 confirmed → sRGB gradient interpolation, worst-stop model is correct):**

| Text color | vs amber-300 | vs orange-400 (worst stop) | Verdict |
|---|---|---|---|
| `text-white` (current) | 1.44:1 | 2.26:1 | FAIL |
| `text-amber-900` | 6.29:1 | **4.01:1** | FAIL (still below 4.5 at worst stop — DO NOT USE) |
| `text-amber-950` | 10.39:1 | **6.62:1** | **PASS** |

**Fix:** replace `text-white` → `text-amber-950` at all 4 sites. **Do NOT use `text-amber-900`** (orange-400 stop is 4.01:1, still failing). One-token change per site.

**Regression pin:** add a worst-stop fixture test (e.g. `apps/web/src/__tests__/hdr-badge-contrast.test.ts`) that reads each of the 4 component sources and asserts the HDR badge span does NOT pair `from-amber-300 to-orange-400` with `text-white` (and positively asserts `text-amber-950`). No existing test pins the current `text-white` value, so the change is test-safe. This closes the 5-cycle blind spot (no prior pass ran the calculator on a *gradient* background).

**Acceptance:** all 4 sites use `text-amber-950`; new fixture green; `npm test --workspace=apps/web` green; typecheck + eslint green. Committed separately.

**Status:** [x] DONE — all 4 sites changed `text-white` → `text-amber-950`; new fixture `apps/web/src/__tests__/hdr-badge-contrast.test.ts` (4 components × 3 assertions: gradient present, no `text-white`, uses `text-amber-950` & not `text-amber-900`) green; full suite 2194 pass / 2 skip / 0 fail; typecheck + eslint + 3 security gates green.

---

## TASK-2 — AGG-C6-02: harden boundary classifier for dynamic-import & import-equals (LOW)

**Finding:** The cycle-5 fix (HEAD `4eb83aab`) replaced the regex import extractor in `apps/web/src/__tests__/client-server-only-boundary.test.ts` (`extractAliasedImports`, ~lines 143–185) with a TypeScript AST walk. The walk iterates `sf.statements` and matches only `ts.isImportDeclaration` / `ts.isExportDeclaration`. It does NOT traverse:
- dynamic `import('@/lib/data')` — a `CallExpression` (the natural code-split for a heavy server/data module);
- `import db = require('@/db')` — an `ImportEqualsDeclaration`.

Both forms were captured by the old regex (orchestrator reproduced: old regex → `['@/lib/data']`, new AST → `[]`). This narrows a security-boundary guard in the **false-negative** direction: a future `'use client'` module doing `await import('@/lib/data')` would pass the test GREEN despite leaking the `@/lib/data → @/db → mysql2` chain into the client bundle.

**Why LOW:** trigger surface is empty at HEAD — the only dynamic `import('@/lib|@/db')` site is `src/instrumentation.ts` (server `register()`, not `'use client'`, unreachable from any client closure; note the production backfill sidecar `scripts/backfill-color-pipeline.ts:276` also uses `await import('../src/db')` but is a script, not a `'use client'` file, and uses a relative path the scanner does not target). Zero `import = require('@/lib|@/db')` sites. Today's boundary is genuinely clean (architect verdict unchanged); this is latent future-coverage hardening.

**Fix (test-only, ~10 lines, no production behavior, no HARD-GUARD interaction — does NOT add `server-only` to `@/db`):** in `extractAliasedImports`, after the statement loop, add a `ts.forEachChild` subtree descent that also captures:
1. `ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword` with a string-literal first argument that `isAliased(...)` (dynamic import);
2. `ts.isImportEqualsDeclaration(node)` whose `moduleReference` is an `ExternalModuleReference` with an aliased string-literal argument.

Add non-vacuous pins: a fixture source string using `await import('@/db')` and one using `import db = require('@/db')` that the extractor MUST return `['@/db']` for.

**Acceptance:** the two new value-import forms are followed; new non-vacuous pins green; the existing 5 boundary tests still pass; full suite green; typecheck + eslint green; `@/db/index.ts` still carries NO `server-only` marker (HARD GUARD #1 preserved). Committed separately.

**Status:** [x] DONE — `extractAliasedImports` now descends the full AST via `ts.forEachChild`, capturing dynamic `import('@/…')` (`CallExpression` + `ImportKeyword`) and `import x = require('@/…')` (`ImportEqualsDeclaration` + `ExternalModuleReference`), de-duped via `Set`. New `it(...)` pin (AGG-C6-02) covers 9 cases incl. nested-in-function dynamic import, non-aliased ignore, and static+dynamic de-dupe. Boundary suite 6 pass (was 5). `@/db/index.ts` unchanged — NO `server-only` marker. Test-only change; typecheck green.

---

## Not deferred / non-actionable (INFO — no plan entry, recorded for provenance)

Per the deferred-fix rules, every finding must be scheduled or explicitly recorded. The cycle-6 INFO items are **not findings** (no code change warranted), recorded here so none is silently dropped:

- **DOC-C6-INFO-01 (line-ref drift):** CLAUDE.md line 264 cites `settings-hash.ts:37-49` for the `COLOR_IMPACTING_KEYS` array, actually at `41-53`. The repo's own docs explicitly disclaim line references as "informational only" (e.g. the migration-runbook `dialect.cjs:62` note: *"file/line drifts across … versions; informational only"*). The symbol name is unambiguous and the count (9) + breakdown are correct, so it cannot mislead. **Not actionable** by repo policy; optional cosmetic only if a maintainer is already editing that paragraph. The tracer's secondary claim that the `settings-hash.ts` inline comment "says 5" is itself mistaken — the on-disk comment (`settings-hash.ts:4`) says "the **9** settings"; code, comment, and CLAUDE.md all agree on 9.
- **tracer 6 verified-CLEAN flows:** backfill walk-back, Stripe async-payment (closed operationally), ETag invalidation (both paths), upload→process→delete race, session+token single-use, view-count buffering — all confirmed correct, not findings.
- **critic stale-vitest-cache smell:** a warm cache transiently made `privacy-fields.test.ts` appear to leak `latitude`; disqualified as a tooling artifact (runtime probe + clean typecheck + `--no-cache` 13/13 PASS both orderings). Not a code defect; recorded for awareness.
- **perf-reviewer `getImagesForFeed` filesort:** intentional, bounded, cacheable Atom feed; adding an index would be a speculative micro-opt with write cost. Not a finding.
- **security-reviewer `postcss<8.5.10`:** NON-EXPLOITABLE transitive build-time advisory; `--force` rejected (would downgrade Next 16→9). Tracked, no change (already in prior deferred/INFO registers).

**No security, correctness, or data-loss finding is being deferred this cycle.** The deferred registers plan-349/351/353/355 (and predecessors) remain accurate and unchanged.

---

## Status

**COMPLETE** — 2/2 tasks implemented, committed, pushed. All gates green (eslint, typecheck, vitest 2194 pass / 2 skip / 0 fail, lint:api-auth, lint:action-origin, lint:public-route-rate-limit). No findings deferred this cycle.
