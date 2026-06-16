# Debugger Review — Run 6 / Cycle 6 — 1 LOW (re-confirmed): boundary-guard AST rewrite silently dropped dynamic-import + import-equals coverage the old regex had.

**HEAD:** `4eb83aab` (branch master)
**Agent:** debugger
**Date:** 2026-06-17
**Angle:** latent bug surface, failure modes, regressions. Deepest scrutiny on the only source delta since cycle 5: the boundary-test AST classifier rewrite landed in `4eb83aab` itself.

## Verdict

**1 Low / 0 Med / 0 High / 0 Crit.** The single finding (DBG-C6-01) is a **confirmed false-negative narrowing of a security boundary guard**, introduced by the very commit that set out to *widen* it. I independently re-derived it this cycle (ran both the old regex and the HEAD AST extractor on identical inputs — table below) rather than trusting the prior write-up. It is LOW (not Med/High) because it is **latent**: no `'use client'` module triggers the dropped vector today, and the affected code is a test, not production runtime. But it is a genuine regression in defensive coverage with a precise, test-only, ~10-line-region fix, and the guard's stated purpose (catch a future `'use client'` → `@/lib/data` → `@/db` → `mysql2` leak) is only *partially* served at HEAD. The prompt's mandate that "a real latent bug or regression must still be caught" is exactly this case.

**Delta scope (why the surface is small this cycle):** the entire delta `7e49ef36..4eb83aab` is review/plan `.md` files plus **exactly one source file** — `apps/web/src/__tests__/client-server-only-boundary.test.ts`. `git diff --name-only 7e49ef36..4eb83aab -- apps/web/src | grep -v __tests__` → **NONE**. Zero production/runtime source changed since cycle 5. The full runtime failure surface is byte-identical to the cycle-5 baseline; I re-confirmed it clean below (typecheck green, 105 targeted tests pass).

---

## FINDING — DBG-C6-01 (LOW, High confidence, re-confirmed at HEAD)

**The AST value-import classifier that replaced the regex in `client-server-only-boundary.test.ts` silently stopped following two import forms the old regex DID follow — dynamic `import('@/…')` and `import x = require('@/…')` — narrowing the leak-detection walk in the false-negative direction.**

- **File:** `apps/web/src/__tests__/client-server-only-boundary.test.ts:138-185` (`extractAliasedImports`), consumed by the closure walk at `:233-258` (`findServerOnlyInClosure` → `extractAliasedImportsCached`).
- **The latent bug:** `extractAliasedImports` iterates ONLY `sf.statements` (`:144`) and handles ONLY `ts.isImportDeclaration` (`:146`) and `ts.isExportDeclaration` (`:169`). It never visits:
  1. **Dynamic `import('@/lib/data')`** — a `CallExpression` whose `expression.kind === ts.SyntaxKind.ImportKeyword`, not a statement-level declaration.
  2. **`import db = require('@/db')`** — a `ts.ImportEqualsDeclaration` with an external-module reference, a real value binding that pulls the module.
- **Empirical old-vs-new divergence (reproduced this cycle by running both extractors on identical inputs):**

  | Input | OLD regex | NEW AST (HEAD) |
  |---|---|---|
  | `const x = () => import('@/lib/data')` | `['@/lib/data']` | `[]` |
  | `async f(){ await import('@/db') }` | `['@/db']` | `[]` |
  | `import db = require('@/db')` | `['@/db']` | `[]` |
  | `import { getImageCached } from '@/lib/data'` (value control) | `['@/lib/data']` | `['@/lib/data']` ✓ |
  | `import type { X } from '@/lib/data'` (type-only control) | `['@/lib/data']` | `[]` (correct — the intended fix) |

  So the swap correctly fixed a real *over-fire* (following erased type-only `@/lib/data` chains — the last row) but bundled in an *under-fire* on the two value forms above. Coverage moved in the dangerous direction (fewer modules followed = more leaks missed).
- **Trigger condition:** a future `'use client'` component (or any module in a client's static closure) does `const { getImageCached } = await import('@/lib/data')` — a natural code-splitting pattern for a heavy server/data module — instead of a static `import`. Dynamic `import()` IS bundled into the client as a separate chunk, so it is a genuine leak vector, not hypothetical.
- **Concrete failure:** the broad-scan test (`:265-291`) passes **GREEN** for that dynamic-import leak, because the walk never enqueues `@/lib/data`, never reaches `@/db` → its `mysql2/promise` value import at `db/index.ts:2` (the signal AGG-C5-01 added at `:309-319`). The leak then falls back to the unguaranteed `next build` failure that AGG-C5-01's own docstring says "may not even fail cleanly." This is the EXACT leak class AGG-C5-01 was created to close — closed for *static* value imports, silently re-opened for *dynamic* ones.
- **Why LOW, not Med/High — latency re-verified at HEAD:**
  - `import = require('@/lib|@/db')` anywhere in `src` (excl. tests): **none**.
  - Dynamic `import('@/lib|@/db')`: **4 occurrences, all in `src/instrumentation.ts:3,5,17,18`** (the Next.js server-instrumentation `register()` entry — confirmed line 1 is `export async function register()`, NOT `'use client'`). `instrumentation.ts` is imported by no other module and is unreachable from any client closure. The broad scan is therefore correct and clean *today*; the defect is in the guard's future-proofing, which is the guard's entire reason to exist.
- **Fix (test-only, zero runtime/production risk, ~10-line region):** in `extractAliasedImports`, additionally walk each statement's subtree (`ts.forEachChild`) to capture (a) `ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword` with a string-literal `@/lib`/`@/db` first argument, and (b) `ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)` with a string-literal `@/lib`/`@/db` expression. De-dupe (`[...new Set(specs)]`). The additions only ADD the two dropped forms and do not touch the type-only drop, so the broad scan stays at 0 violations (no new false positives) and the type-only control still drops to `[]`. Add a non-vacuous pin asserting `extractAliasedImports("const f = async () => { await import('@/lib/data'); }")` contains `@/lib/data`, so the restored coverage cannot silently regress again.
- **Confidence:** High. Old-vs-new behavioral divergence reproduced this cycle on identical inputs; latency confirmed by exhaustive `src` grep (only `instrumentation.ts`, non-client, unreachable); the type-only over-fire fix is genuine and should be preserved — only the dynamic/import-equals coverage needs restoring.

### Secondary observation on the same commit (NOT a separate finding — defensible by design)

`hasServerOnlyDriverImport` (`:200-202`) flags **type-only** mysql2 imports (`import type { Pool } from 'mysql2'`) as server-only-equivalent — the test at `:325` asserts `true`. In isolation that looks like a false-positive risk (a type-only mysql2 import is erased and bundles nothing). But it is only ever evaluated on a module ALREADY reached via a VALUE import in the closure walk, so that module is genuinely in the client bundle regardless of how it references mysql2 — the type-only import is an incidental-but-strong "this is server code" signal. The only misfire path is a contrived module that is value-imported by a client, carries a type-only mysql2 import, AND is genuinely isomorphic — itself a smell. No client-reachable module has a mysql2 import of any kind today. Defensible; noted for provenance so a future reviewer doesn't re-flag it.

---

## Re-verified failure surface (unchanged runtime code — re-confirmed clean at HEAD)

Zero runtime source changed since cycle 5, so these are confirmations. I re-read each in full this cycle and hand-evaluated the integer/bounds arithmetic against crafted-input scenarios; all are sound:

- **Backfill `detectionFailures` accounting** (`lib/admin-backfill-runner.ts`): the "walk-back / slice" shape the brief described does NOT exist at HEAD — the runner uses a discriminated `ReprocessResult`; each outcome maps 1:1 to exactly one counter and the handled-count partition (`:751-752`) sums all seven exhaustively. Detection-failure resume contract (`:580-609`, no version bump) verified by `admin-backfill-runner-detection-failure.test.ts`. `resolveBackfillConcurrency` (`:129-142`) executed across `requested` ∈ {0, −5, 0.5, NaN} and pool ∈ {10, 4, 2, NaN}: every path clamps to ≥1, never NaN (which would freeze PQueue). Non-snapshot keyset walk terminates (cursor monotonic; detection-failed rows have `id <= cursor`).
- **GPS/ICC/ISOBMFF bounded walkers** (`gps-exif-strip.ts`, `color-detection.ts`, `icc-extractor.ts`, `icc-chromaticity.ts`, `gain-map-detection.ts`): every byte read/fill bounds-checked before access; `MAX_IFD_ENTRIES`(1024)/`MAX_IFD_CHAIN`(8)/depth-5/1 MB-scan caps; `visited` set guards IFD cycles; 64-bit box sizes guarded against `MAX_SAFE_INTEGER`; two-u32 offset+size maxes at 8.59e9 (no integer overflow); unknown TIFF types and structural anomalies → `null` → metadata-free re-encode fallback. WebP RIFF tag/size order correct (b6c4f915); odd-final-chunk `paddedSize` advance cannot OOB (traced); zero-IFD0-offset → anomaly (d17e5cc2). The ISOBMFF Exif region end `start + 4 + (length-4) === start + length` is exact, `headerOffset > length-8` rejected. The caller `stripGpsFromOriginal` (`process-image.ts:1573-1650`) is fail-safe: `null`→re-encode, `{stripped:false}`→byte-identical, `{stripped:true}`→atomic rename; unique per-call tmp path; catch unlinks tmp; HEIC-no-encoder path surfaces loudly.
- **Sharp catch/finally** (`process-image.ts:1263-1320`): `try/catch/finally` unlinks every partial sized variant written this invocation (`writtenSizedPaths`); `finally` always unlinks the WI-15 downscaled intermediate; AVIF 10→8-bit fallback passes explicit `bitdepth:8` on `clone()` (COR-R4C8-06); atomic-rename fallback chain with `finally` tmp unlink; `_verifyWebpIccChunk` closes its fd in `finally`. No leak/orphan.
- **SW LRU** (`lib/sw-cache.ts`): re-touch recency via delete-then-set → head-walk evicts true-oldest (executed and verified); browser-quota `cache.delete`→false path self-heals metadata (documented `:134-143`), benign — not a crash/leak.
- **Bounded rate-limit maps** (`auth-rate-limit.ts`, `rate-limit.ts`, `bounded-map.ts`): `prune` precedes `get` in the login flow; DB bucket is source of truth; cap-eviction of an active bucket backstopped by the DB counter; rollback uses decrement-not-delete (C1-07); `GREATEST(count-1,0)`+zero-row-cleanup in a transaction. TOCTOU closed by pre-increment-before-Argon2.
- **`parseInt` radix audit**: grep for `parseInt(` without a radix across `lib/`, `actions/`, `scripts/` → **zero hits**. That bug class does not exist here.

---

## Gates run this review
- `npm run typecheck --workspace=apps/web` → **exit 0** (typecheck:app + typecheck:scripts both green). No type regression.
- `npx vitest run` (from apps/web) on gps-exif-strip, color-detection, icc-chromaticity, gain-map-detection, sw-cache, bounded-map, admin-backfill-runner-detection-failure → **105/105 PASS**.
- Old-regex vs new-AST behavioral diff on `import =` / dynamic `import()` / `await import()` / static value / static type-only → reproduced the DBG-C6-01 narrowing (table above).
- `grep` of `src` (excl. tests) for dynamic `import('@/lib|@/db')` and `import = require('@/lib|@/db')` → confirms latency (only non-client `instrumentation.ts`).

## Hard guards respected
- Did NOT propose `import 'server-only'` on `@/db` (cycle-5 proved it breaks tsx backfill — and DBG-C6-01's whole point is that the `mysql2`-driver heuristic is the correct substitute, which is why the dropped coverage matters).
- Did NOT touch CLIP/semantic-search.
- Did NOT re-report any cycle 1-5 production item; the one finding is a cycle-6 regression in the cycle-6 commit, independently re-verified against HEAD `4eb83aab`.

## References (verified this cycle)
- `apps/web/src/__tests__/client-server-only-boundary.test.ts:138-185` — `extractAliasedImports`: handles only `ImportDeclaration`/`ExportDeclaration`; misses dynamic `import()` (CallExpression) + `ImportEqualsDeclaration` (DBG-C6-01)
- `apps/web/src/__tests__/client-server-only-boundary.test.ts:233-258` — closure walk consumes the classifier; missed forms are never enqueued
- `apps/web/src/__tests__/client-server-only-boundary.test.ts:200-202,325` — `hasServerOnlyDriverImport` flags type-only mysql2 (defensible-by-design secondary observation)
- `apps/web/src/db/index.ts:2` — `import mysql from "mysql2/promise"` (the VALUE-import signal AGG-C5-01 relies on; only reached via the static path the new classifier still covers)
- `apps/web/src/instrumentation.ts:3,5,17,18` — the only dynamic `import('@/lib/...')` sites; `register()` server entry, NOT `'use client'`, unreachable from any client closure (why DBG-C6-01 is latent)

## Summary count by severity
- **Critical: 0**
- **High: 0**
- **Medium: 0**
- **Low: 1** (DBG-C6-01 — boundary-guard AST classifier dropped dynamic-import + import-equals coverage the old regex had; latent false-negative in a security-boundary test, test-only ~10-line fix)
