# Plan 356 — Run 6 / Cycle 5 (orchestrator cycle 5/100) — Scheduled Fixes

**Date:** 2026-06-16
**HEAD at planning:** `2f603716` (working tree clean)
**Source:** `.context/reviews/_aggregate.md` (Run 6 / Cycle 5) + 11 per-agent review files.

**Repo policy reminders (apply to every commit here):** GPG-sign (`-S`), NO `Co-Authored-By`, conventional-commit + gitmoji, `git pull --rebase` before push, fine-grained one-commit-per-fix, push after each commit, run `npm run typecheck --workspace=apps/web` before committing test changes, run all GATES (eslint, typecheck, vitest, lint:api-auth, lint:action-origin, lint:public-route-rate-limit) before claiming done, no suppressions unless repo rules authorize (quote the rule in the body).

---

## Context — honest convergence with one residual LOW

Cycle 5's 11-agent fan-out found **0 new Critical/High/Medium** findings. Ten of eleven agents returned zero new actionable findings and re-confirmed the prior-cycle closures + deferrals are factually correct at HEAD `2f603716`. The verifier ran the full suite (2178 pass / 2 skipped / 0 failed), typecheck exit 0, ESLint + all 3 security lint gates green.

The single new finding is **one LOW, High-confidence, one-line-fix** architectural item from the architect agent: the named client→server-only boundary regression test has a coverage hole on the highest-probability leak vector (`'use client'` → `@/lib/data`). This plan schedules that one fix.

No finding is being deferred this cycle — the sole finding is scheduled here. (The deferred registers plan-349/351/353/355 and predecessors remain accurate and unchanged; their items were re-confirmed correct at HEAD, see `_aggregate.md` "Deferred items re-confirmed CORRECT".)

---

## TASK-1 — AGG-C5-01: extend the client→server-only boundary guard to the data/persistence layer (LOW, High)

**Finding:** `.context/reviews/_aggregate.md` AGG-C5-01 / `.context/reviews/architect.md` ARCH-C5-01.

**Root cause:** `apps/web/src/__tests__/client-server-only-boundary.test.ts` (AGG-R5C3-21 / ARCH-R5C3-01) detects a client→server leak by ONE mechanism — scanning a `'use client'` module's transitive `@/lib`/`@/db` import closure for `import 'server-only'`. That sentinel exists on exactly two leaf modules (`apps/web/src/lib/caption-generator.ts:19`, `apps/web/src/lib/clip-model.ts:17`), both reachable only via `image-queue.ts` (never client). The data/persistence layer — `@/db/index.ts`, `@/lib/data`, `@/lib/gallery-config`, `@/lib/process-image`, `@/lib/serve-upload`, `@/lib/color-detection` — carries NO `server-only` marker. So the MOST probable accidental leak (a future `import { getImageCached } from '@/lib/data'` added to a `'use client'` component) would (1) pass the boundary test GREEN and (2) NOT necessarily produce the clean named `next build` failure the test's docstring promises — the only backstop is the bundler choking on `mysql2`/Node built-ins, which is not a guaranteed build-time failure and could degrade to a cryptic runtime error or silently leak server code into the client bundle. The guard was deliberately built to make the boundary "structurally defended" (AGG-C3-18), yet it does not fire for the highest-probability regression vector.

**HEAD verification done at planning time:**
- `apps/web/src/db/index.ts` begins `import { drizzle } from "drizzle-orm/mysql2";` — NO `server-only` import. ✓
- The only two `server-only` markers under `apps/web/src/lib` + `apps/web/src/db` are `caption-generator.ts:19` and `clip-model.ts:17`. ✓
- `server-only` is aliased to a vitest stub at `apps/web/vitest.config.ts:13` → `apps/web/src/__tests__/stubs/server-only.ts`, so marking `@/db` is test-safe for server-module unit tests that transitively import it. ✓

**⚠️ CORRECTION — the architect's proposed fix (`import 'server-only'` in `@/db/index.ts`) is UNSAFE. Rejected.**

During implementation I empirically verified the real `server-only@0.0.1` package's export map is INVERTED from the assumption in the architect's note:
- `exports["."].react-server` → `empty.js` (no-op — the condition Next's RSC SERVER graph uses).
- `exports["."].default` → `index.js` which **`throw new Error("This module cannot be imported from a Client Component module…")`** — and the `default` condition is what **plain Node / tsx** resolves.

So `import 'server-only'` THROWS under tsx, NOT in the client bundle as the note assumed. Empirically confirmed at HEAD:
- `npx tsx -e "import('./src/lib/caption-generator.ts')"` → **THREW** (`caption-generator.ts` already carries the marker).
- `npx tsx -e "import('./src/db')"` → **OK today** (no marker yet).

`@/db/index.ts` is imported under tsx by the **documented production color-pipeline backfill sidecar** (`apps/web/scripts/backfill-color-pipeline.ts:276`, `const { db, connection } = await import('../src/db')`) and by `init-db.ts` / `seed-admin.ts` / `migrate`-adjacent scripts. Marking `@/db/index.ts` with `server-only` would make those imports **throw at runtime**, breaking the production backfill and DB init/seed tooling. That is a destructive change to operational tooling — forbidden by the repo's "don't break the documented production backfill path" guidance and by global destructive-action-safety rules. The vitest stub only protects unit tests, NOT the tsx scripts. **Not implemented.**

**Safe fix actually implemented (test-only, zero runtime risk):**
1. Extend `apps/web/src/__tests__/client-server-only-boundary.test.ts` to treat reaching the persistence chokepoint as a server-only-equivalent signal: in the transitive-closure walk, flag a module that statically imports `mysql2` / `mysql2/promise` (the unambiguous server-only Node driver that `@/db/index.ts` imports) IN ADDITION to the existing `import 'server-only'` sentinel. Any `'use client'` → `@/lib/data` (→ `@/db` → `mysql2`) chain now fails the test RED, closing the exact gap ARCH-C5-01 identified — with no source/runtime change and no `next build` dependency.
2. Add a docstring paragraph in the test explaining WHY `@/db` cannot itself carry the `server-only` marker (tsx scripts import it under the throwing `default` condition), so a future maintainer doesn't "simplify" the test back into the unsafe marker approach.

**Why mysql2 (not `@/db` path-name) is the detection key:** `mysql2` is an unambiguous server-only signal (a native Node DB driver that can never run in a browser bundle), it is the concrete dependency that makes `@/db` server-only, and matching the import specifier is far less brittle than enumerating internal `@/db`/`@/lib/data` path names. It also auto-covers any FUTURE data module that imports the driver directly.

**Acceptance:**
- `client-server-only-boundary.test.ts` flags both `import 'server-only'` AND a `mysql2`/`mysql2/promise` import in the transitive closure; existing positive pins still pass.
- A synthetic/inline assertion (or reasoning in the docstring) confirms the new detection would catch a `'use client'` → `@/db` chain (i.e. it is non-vacuous).
- No `'use client'` file reaches `@/db`/`mysql2` at HEAD, so the test stays GREEN — it only WIDENS coverage.
- `npm test --workspace=apps/web` green; `npm run typecheck --workspace=apps/web` exit 0; ESLint + all 3 security lint gates green.
- `apps/web/src/db/index.ts` is UNCHANGED (no `server-only` marker).

**Confidence:** High. Coverage hole confirmed by reading the test's sole detection mechanism vs the data-layer closure; the unsafe-marker rejection confirmed empirically (tsx throw test + production-script import-site read); the safe test-only detection closes the exact vector with zero runtime risk.

---

## INFO items (NOT findings — no action; recorded for provenance)

These came back from the fan-out as INFO / verified-correct and require no code change:
- **DOC-C5-INFO-01** (document-specialist): CLAUDE.md line 182 uses the shorthand `p/[id]/page.tsx` in the illustrative Repository-Structure block while the file lives at `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`. NOT a false claim (the block is illustrative; the path suffix is correct and the file exists). No fix.
- **postcss<8.5.10 advisory** (security-reviewer): transitive dev-only via Next's build-time CSS compiler; NON-EXPLOITABLE (no runtime CSS surface; prod serves pre-built static CSS). `npm audit fix --force` rejected (would downgrade Next 16→9). Tracked in CI, no change.
- **6 tracer INFO flows** + **5-agent corroboration of cycle-4 fix correctness** — all verified correct, no action.

---

## Status

**COMPLETE** — 1/1 task implemented, committed, pushed. Gates green.

- [x] TASK-1 — AGG-C5-01: widen `client-server-only-boundary.test.ts` to cover the data layer (mysql2-in-closure + AST value-import classification). `@/db/index.ts` left UNCHANGED (unsafe marker rejected). Commit SHA recorded on the test-fix commit.

**Implementation notes:**
- The fix is test-only (`apps/web/src/__tests__/client-server-only-boundary.test.ts`); `apps/web/src/db/index.ts` was NOT modified.
- During implementation, extending the closure walk to flag `mysql2` surfaced that the ORIGINAL regex-based `extractAliasedImports` did not distinguish value vs type-only imports — it followed `import type { … } from '@/lib/data'` chains (home-client.tsx, load-more.tsx, analytics-client.tsx) as if they were value imports. With the new `mysql2` flag those chains false-positived. Root-caused and fixed by replacing the regex with a TypeScript-AST value-import classifier (same compiler API the lint-gate scripts use) that follows VALUE imports only and drops both statement-level (`import type`) and inline (`import { type X }`) type-only forms. This is strictly more correct than the prior regex and is the load-bearing half of the widened guard.
- Added non-vacuous pins: (a) `@/db/index.ts` is recognized as server-only-equivalent via its `mysql2/promise` import AND carries no `server-only` marker; (b) `mysql2` detection anchoring (rejects `mysql2-extra`, `@scope/mysql2`, comments, strings); (c) the AST classifier follows value imports and drops the exact erased forms the real client components use today.
- **Gates green:** `npm test --workspace=apps/web` → 233 passed / 1 skipped file, 2181 passed / 2 skipped tests, 0 failed; `npm run typecheck --workspace=apps/web` exit 0; ESLint clean; all 3 security lint gates (api-auth, action-origin, public-route-rate-limit) pass.
