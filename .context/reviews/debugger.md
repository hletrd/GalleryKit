# Debugger Review — Run 6 / Cycle 7 — 0 findings (honest convergence; full crafted-input re-audit + cycle-6-fix verification clean)

**HEAD:** `a7758ef0` (branch master)
**Agent:** debugger
**Date:** 2026-06-17
**Angle:** latent-bug hunt with crafted-input / adversarial-input analysis. Deepest scrutiny on the only two source commits since the cycle-6 baseline (`4eb83aab`): the boundary-guard fix `204e8594` (DBG-C6-01) and the HDR-badge contrast fix `5af25dc7` (DES-C6-M1). Plus a full re-derivation of every bounded binary parser, the backfill runner accounting, the Sharp catch/finally, SW LRU, JSON.parse sites, and the parseInt radix audit.

## Verdict

**0 Critical / 0 High / 0 Medium / 0 Low.** This is the expected correct outcome for cycle 7 of a system that closed both cycle-6 findings cleanly. The findings trend across this run is **11 → 45 → 14 → 5 → 1 → 2 → 0**. I did NOT trust the prior write-ups: I re-read every file in the mandated failure-prone inventory in full and hand-evaluated the integer/bounds/NaN arithmetic against crafted-input scenarios, re-derived the cycle-6 fix's correctness from the AST node-kind checks, and ran the relevant test suites to ground every claim. Nothing rose to the bar of "a real latent bug / failure mode / regression a senior engineer would commit a fix for."

**Delta scope.** HEAD `a7758ef0` is itself a docs-only commit (`docs(reviews): run-6 cycle-6 deep review + plan`). The entire SOURCE delta `4eb83aab..a7758ef0` over `apps/web/src` is exactly six files, from two commits:
- `204e8594` — `client-server-only-boundary.test.ts` (the DBG-C6-01 fix). **Test-only.**
- `5af25dc7` — `color-details-section.tsx`, `lightbox-color-pip.tsx`, `info-bottom-sheet.tsx`, `image-manager.tsx` (4× one-token `text-white` → `text-amber-950`) + new `hdr-badge-contrast.test.ts` (the DES-C6-M1 fix).

`git diff --name-only 4eb83aab..a7758ef0 -- apps/web/src apps/web/scripts apps/web/public` → only those six files. Zero runtime/library/parser/queue/security source changed since the cycle-6 baseline beyond the four trivial className edits. The full binary-parser + backfill + Sharp + rate-limit + SW failure surface is byte-identical to the cycle-6 clean baseline; I re-confirmed it clean from first principles below rather than assuming.

---

## Cycle-6 fix verification (prompt mandate)

### `204e8594` (DBG-C6-01) — boundary classifier now catches dynamic import + import-equals: VERIFIED CORRECT + COMPLETE + WIRED

The prompt asked specifically: *does the AST classifier now actually catch CallExpression dynamic imports + ImportEqualsDeclaration?* Verified YES, from the code and from a green test run.

- **File:** `apps/web/src/__tests__/client-server-only-boundary.test.ts:185-223` (the new `visit` walk appended to `extractAliasedImports`).
- **Dynamic `import('…')` capture (`:198-206`):** matches `ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0]) && isAliased(...)`. This is the correct node shape for a dynamic import call in the TS AST (the callee is the `import` keyword, not an `Identifier`), so it fires for `await import('@/lib/data')`, `import('@/db').then(...)`, and `const {db} = await import('@/db')` alike. Confirmed.
- **`import x = require('…')` capture (`:208-214`):** matches `ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression) && isAliased(...)`. Correct — `ImportEqualsDeclaration` with an `ExternalModuleReference` whose `.expression` is the require'd string literal. Confirmed.
- **Full-subtree descent (`:216-218`):** `ts.forEachChild(node, visit)` then `ts.forEachChild(sf, visit)` — so forms nested inside a function body (not top-level statements) are reached. The new test pins exactly this: `extractAliasedImports("function load() { return import('@/lib/data'); }")` returns `['@/lib/data']` (`:411`).
- **De-dup (`:222`):** `return [...new Set(specs)]` — a module reached by both a static and a dynamic edge appears once. Pinned at `:427-430`.
- **No double-count / no false positive:** the recursive `visit` also re-traverses top-level `ImportDeclaration`/`ExportDeclaration` nodes (already handled by the statement loop), but those are not `CallExpression`/`ImportEqualsDeclaration`, so the `visit` predicates don't fire on them, and `forEachChild` descending into a static `import {a} from '@/x'` cannot reach a nested dynamic import (there is none). The Set makes any overlap idempotent. The broad scan stays at 0 violations (no new false positives) and the type-only over-fire fix from cycle 5 is preserved untouched.
- **WIRED into the live scan, not just the unit test:** the broad-scan closure walk `findServerOnlyInClosure` calls `extractAliasedImportsCached(file, source)` at `:288`, which wraps the fixed `extractAliasedImports`. So a future `'use client'` → `await import('@/lib/data')` → `@/db` → `mysql2/promise` leak would now fail the broad scan RED, not just the targeted unit test. The fix is integrated, not vestigial.
- **HARD GUARD #1 respected:** `@/db/index.ts` is NOT given a `server-only` marker (commit message and code both confirm); the `mysql2`-in-closure heuristic (`hasServerOnlyDriverImport`, `:238-240`) remains the safe substitute. The non-vacuous pin at `:347` proves `@/db/index.ts` is still recognized as server-only-equivalent via its `mysql2/promise` value import.
- **Test result:** all 9 new cases + the rest of the file pass (`27 passed` across the 4 cycle-6-touched test files in one run). Green at HEAD.

DBG-C6-01 is correctly and completely closed. It does NOT re-open and there is no residual gap.

### `5af25dc7` (DES-C6-M1) — HDR badge contrast fix: VERIFIED CORRECT (no latent regression)

Not a debugger-domain finding, but checked for any latent fallout since it touched four shipping components:
- All four edits are a single className token swap `text-white` → `text-amber-950` on the `from-amber-300 to-orange-400` gradient badge (`color-details-section.tsx:526`, `image-manager.tsx:526`, `info-bottom-sheet.tsx:278`, `lightbox-color-pip.tsx:151`). No logic, no conditional, no data flow touched — purely the rendered glyph color. No latent behavioral risk.
- The new `hdr-badge-contrast.test.ts` (15 of the 27 in the combined run) pins gradient-present + no-`text-white` + uses-`text-amber-950` across all four sites, so the gradient-background blind spot cannot silently regress. Green at HEAD.

---

## Failure-prone inventory — re-audited from first principles at HEAD (all CLEAN)

I re-read each file in full this cycle and hand-traced the arithmetic against crafted/hostile inputs. None changed since the cycle-6 baseline; these are independent re-confirmations, not assumptions.

### Binary parsers — every byte read bounds-checked, all arithmetic fail-safe-to-null

- **`gps-exif-strip.ts`** (the JPEG/TIFF/ISOBMFF/WebP GPS scrubber):
  - `stripGpsFromTiffRegion` (`:103-199`): `tiffEnd > buf.length || tiffEnd-tiffStart < 8` gate; `inBounds(abs,size)` checks `abs >= tiffStart && abs+size <= tiffEnd` before every read/fill; `count > MAX_IFD_ENTRIES`(1024) reject; `count*12+4` max 12292 (no overflow); offset-referenced `valueAbs = tiffStart + u32` with `valueSize = typeSize(≤8) * valueCount(u32)` up to 3.4e10 stays a JS number and is rejected by `inBounds`; unknown TIFF type id → `null`; IFD cycle guard via `visited` Set; `ifdAbs <= tiffStart+7` (zero/header-pointing IFD0) → `null` (fail-safe, d17e5cc2 doctrine).
  - JPEG walker (`:222-360`): ExtendedXMP chunk header read `data.readUInt32BE(sig.length+36)` guarded by `data.length > headerEnd`(75); post-EOI trailer → `null` so the re-encode drops it (SEC-R4C10-01); fill-byte / RSTn marker handling correct; segment length `< 2 || markerPos+2+segLength > buf.length` reject.
  - ISOBMFF walker (`:379-556`): `walkChildren` 64-bit box size guarded `big > MAX_SAFE_INTEGER → return`; `size < headerSize || pos+size > end → return`; iloc offset/length/baseOffset sizes restricted to {0,4,8} with 8-byte values `> MAX_SAFE_INTEGER → null`; `itemCount > 4096` and `extentCount > 64` caps; `constructionMethod !== 0 → null`; Exif region end `start + 4 + (length-4) === start+length` exact, `headerOffset > length-8 → null`; final extent bound `start+length > buf.length → null`. `baseOffset+extentOffset` precision loss only at astronomically-large crafted offsets, which the final bound rejects.
  - WebP RIFF (`:564-605`): tag-before-size order correct (b6c4f915); `dataEnd > buf.length → null`; `paddedSize = chunkSize + chunkSize%2`; `next <= offset → null` guards the odd-final-chunk advance against OOB / non-advance.
  - Tests: `strip-gps-from-original.test.ts` green at HEAD.

- **`color-detection.ts` `parseCicpFromHeif`** (`:219-285`): box loop `while (pos+8 <= limit)`; 64-bit `size===1` path `pos+16 > buffer.length → break`, huge `Number(bigint)` caught by `pos+size > buffer.length → break`; `size===0 → size = buffer.length-pos` (≥8); `size < headerSize → break`; nclx read needs `dataSize >= 11` and `dataStart+dataSize = pos+size ≤ buffer.length`, so `readUInt8(dataStart+10)` in bounds; `pos = boxEnd` advances ≥8 (no infinite loop); depth/scan caps (5 / 1 MB). NCLX code-2 ("Unspecified") per-field guard (`:383-388`) keeps lower-precedence ICC values rather than clobbering with `unknown` — verified correct. `detectColorSignals` fd handling (`:328-339`): `open` → inner `try` → `finally { close }`, all inside an outer `try/catch` → no fd leak on any throw. `bitDepth` mapping handles string/number/undefined safely. Test: `color-detection.test.ts` green.

- **`icc-extractor.ts`** (`:45-127`): `icc.length <= 132 → null`; `tagCount = min(u32, 100)`; `tagOffset+12 > iccLen → break`; `dataOffset+12 > iccLen || dataSize < 12 || dataOffset+dataSize > iccLen → break`; `desc` strLen `min(declaredLength, dataSize-12, 1024)`, `strEnd > iccLen || strStart >= strEnd → break`; `mluc` records `recOffset+12 > iccLen → break`, `strStart = dataOffset + recTextOffset`, `strEnd > iccLen || strEnd > dataOffset+dataSize || strStart >= strEnd → continue`. Whole body in `try/catch → null`. No OOB, no NaN propagation (offsets pre-guarded).

- **`icc-chromaticity.ts`** (`:220-322`): `icc.length < 144 → null`; `tagCount` clamped to 100; `tagTableEnd = min(132+tagCount*12, 132+4096, icc.length)`; per-tag `offset+size > icc.length || size > 4096 → continue`; `readS15Fixed16`/`readXyzTag`/`readChadMatrix` each guard `offset+N > buf.length`; `invert3x3` rejects `|det| < 1e-12` / non-finite; `xyzToXy` rejects `|sum| < 1e-9`; chad-matrix path checks `Number.isFinite` on all 9 entries. No NaN/Infinity escapes to the matcher. Test: `icc-chromaticity.test.ts` 15/15 green.

- **`gain-map-detection.ts`** (`:57-291`): `readBoxHeader` 64-bit `size===1` path `pos+16 > buffer.length → null`, huge `Number(bigint)` caught by `size < headerSize || pos+size > buffer.length → null` (fail-safe even without an explicit MAX_SAFE guard — the bound rejects it); `walk`/`parseIinf`/`parseIref` all advance `pos` by `header.size ≥ 8` and cap iterations (`parsed < 1024`, `refCount < 1024`); `parseIref` inner-read `inner+idSize+2 > innerEnd` guard before reading `from_item_id`/`ref_count`; `parseInfe` bounds every field read against `dataEnd`; `readNullTerminatedAscii` clamps to `min(end, buffer.length)`. Whole `walk` in `try/catch → false`. No infinite loop, no OOB, no throw to caller. Test: `gain-map-detection.test.ts` green.

### Backfill runner + accounting — `admin-backfill-runner.ts`

- **`resolveBackfillConcurrency` (`:129-142`):** executed across `requested ∈ {NaN, 0, −5, 0.5, 7}` × `poolLimit ∈ {10, 4, 2, NaN}`. Every path clamps to `≥ 1`, never NaN, never 0. Critical cases: `requested=NaN → floor(NaN)=NaN, NaN||1=1`; `requested=−5 → floor=−5, −5||1=−5, max(1,−5)=1`; `poolLimit=NaN → Number.isFinite false → fallback 10`; `poolLimit=2 → reserved=max(3,1)=3, cap=max(1,floor((2−3−1)/2))=max(1,−1)=1`. A NaN concurrency (which would freeze PQueue at zero tasks) is impossible.
- **Accounting (`:692-799`):** seven outcomes (`processed` + 5 skip/failure reasons + `errors`) each map 1:1 to exactly one counter; the `handled` partition (`:751-752`) sums all seven exhaustively. JS single-threaded execution means the closure-local `x++` increments across concurrent PQueue tasks cannot lose updates (no `await` between read and write). The `queue.add(async …)` task body wraps everything in `try/catch` (catch → `errors++`), so the returned promise never rejects → no PQueue unhandled rejection; the post-try state-mirror block is pure property assignment + arithmetic and cannot throw.
- **Non-snapshot keyset walk (`:684-773`):** `cursor = batch[last].id`; processed rows bump to CURRENT (excluded from next batch), and skipped/failed rows have `id ≤ cursor` (also excluded from THIS run's next batch, retried NEXT run) — the walk visits each stale row at most once per run and terminates. The advisory-lock serialization + fresh-uploads-at-CURRENT invariants (documented `:387-399`) hold.
- **Detection-failure resume (`:580-609`):** no `pipeline_version` bump on detection failure (so a later run retries); `affectedRows===0` (deleted-mid-reencode) → `cleanupDeletedMidReencodeVariants` + own counter, in BOTH the success-signals and detection-failed branches. `deletedMidReencode` correctly excluded from `hadFailures` (`:791`). Locked-on-pool-exhaustion treated as a `locked` skip (`:487-490`), never a tight error spin. Lock release in `finally` (`:610-614`). Tests: `admin-backfill-runner-detection-failure.test.ts` + `admin-backfill-concurrency-cap.test.ts` green at HEAD.

### Sharp catch/finally — `process-image.ts:1263-1320`

`try` runs the parallel fan-out + empty-file verification + audit verification; `catch` unlinks every partial sized variant written THIS invocation (`writtenSizedPaths.{webp,avif,jpeg}`, each `.catch(()=>{})`) then re-throws; `finally` always unlinks the WI-15 downscaled intermediate when one was created. Atomic-rename fallback chain (`:1240-1257`) unlinks its tmp in `finally`. No orphaned variant, no leaked fd, no leaked tmp on any throw path.

### SW LRU — `sw-cache.ts:95-149`

Delete-then-set recency (Map insertion order = recency); head-walk eviction breaks at `total <= maxBytes`; `cache.delete()===false` (browser-quota-evicted) path decrements `total`/`evicted` only when truly deleted but still removes the metadata entry — at worst this clears the whole metadata map when the browser already cleared the cache (benign self-heal, re-syncs to empty cache). Loop bounded by `entries.values()`. No crash, no leak, no data loss. Test: `sw-cache.test.ts` green.

### Cross-cutting sweeps

- **`parseInt` radix audit:** `grep "parseInt("` across `src/lib`, `src/app`, `scripts` filtered for missing/non-standard radix → **zero hits**; `Number.parseInt` likewise zero. That bug class does not exist here. Re-confirmed at HEAD.
- **`JSON.parse` sites (6 total, non-test):** all guarded — `admin-tokens.ts:120` (`catch → []`), `smart-collections.ts:310` (`catch → SmartCollectionQueryError`, then structural validation incl. `isScalarValue` finite-number guard), `semantic/route.ts:167` (`catch → 400`, with body-size + shape validation). The two script-level parses (`migrate.js:146`, `ensure-site-config.mjs:11`) read trusted committed files at build/deploy time — a malformed file is a desired deploy-fail. No unguarded `JSON.parse` reachable from untrusted input.
- **Rate-limit maps** (`auth-rate-limit.ts`, `rate-limit.ts`, `bounded-map.ts`): byte-identical to the cycle-5/6 baseline; bounded Maps with oldest-entry eviction, DB bucket as source of truth, pre-increment-before-Argon2 closes the login TOCTOU. No source change to re-derive.

---

## Gates run this review

- `npx vitest run` (apps/web) on `client-server-only-boundary` + `hdr-badge-contrast` + `admin-backfill-runner-detection-failure` + `admin-backfill-concurrency-cap` → **27/27 PASS**.
- `npx vitest run` on `color-detection` + `gain-map-detection` + `icc-chromaticity` + `sw-cache` + `strip-gps-from-original` → **92/92 + 15/15 PASS** (icc-chromaticity run separately; `gps-exif-strip.test.ts` is not the filename — GPS strip is covered by `strip-gps-from-original.test.ts`, which is green).
- Manual AST node-kind re-derivation of `204e8594` against `ts.SyntaxKind.ImportKeyword` (dynamic import callee) + `ts.isExternalModuleReference` (import-equals) → both predicates fire on the intended forms; confirmed wired into the live broad-scan via `extractAliasedImportsCached` at `:288`.
- `grep` of `src/lib`/`src/app`/`scripts` for `parseInt(`/`Number.parseInt(` missing radix → zero hits.

## Hard guards respected

- Did NOT propose `import 'server-only'` on `@/db` — confirmed `204e8594` correctly leaves it unmarked and relies on the `mysql2`-driver heuristic (the safe substitute, proven not to break the tsx backfill).
- Did NOT touch / propose activating CLIP / semantic_search.
- Did NOT re-report any prior-cycle item; verified the two cycle-6 fixes at HEAD and re-derived the full inventory independently.

## References (verified this cycle)

- `apps/web/src/__tests__/client-server-only-boundary.test.ts:185-223` — fixed `extractAliasedImports`: recursive `visit` captures dynamic `import()` (`CallExpression` + `ImportKeyword`) and `import = require()` (`ImportEqualsDeclaration` + `ExternalModuleReference`), Set-deduped. Cycle-6 fix verified correct + complete.
- `apps/web/src/__tests__/client-server-only-boundary.test.ts:288` — `extractAliasedImportsCached` consumed by the live broad-scan closure walk; the fix is integrated, not vestigial.
- `apps/web/src/__tests__/client-server-only-boundary.test.ts:347` — non-vacuous pin: `@/db/index.ts` recognized server-only-equivalent via `mysql2/promise` (HARD GUARD #1 substitute intact).
- `apps/web/src/components/{color-details-section,lightbox-color-pip,info-bottom-sheet,image-manager}.tsx` — DES-C6-M1 one-token contrast fix; no logic touched.
- `apps/web/src/lib/gps-exif-strip.ts`, `color-detection.ts`, `icc-extractor.ts`, `icc-chromaticity.ts`, `gain-map-detection.ts` — all bounded walkers re-derived clean (bounds + cycle guards + 64-bit overflow handling + fail-safe-to-null).
- `apps/web/src/lib/admin-backfill-runner.ts:129-142,684-799` — `resolveBackfillConcurrency` (no NaN/0/underflow) + exhaustive 7-way counter partition + terminating non-snapshot keyset walk.
- `apps/web/src/lib/process-image.ts:1263-1320` — Sharp catch/finally: no orphan variant / fd / tmp leak.
- `apps/web/src/lib/sw-cache.ts:95-149` — bounded, self-healing LRU.

## Summary count by severity
- **Critical: 0**
- **High: 0**
- **Medium: 0**
- **Low: 0**

Honest convergence. The cycle-6 fixes are correct, complete, integrated, and green; the entire failure-prone inventory re-derives clean from first principles at HEAD `a7758ef0`. No real latent bug exists to fix this cycle.
