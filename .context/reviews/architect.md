# Architect Review — Run 6 / Cycle 7

**HEAD:** `a7758ef0`
**Date:** 2026-06-17
**Agent:** architect (read-only; persisted by orchestrator after independent HEAD verification)
**Verdict:** ACCEPT — **0 architecture findings** (0 Critical / 0 High / 0 Medium / 0 Low)

## Summary

Zero architectural defects at HEAD. The cycle-6→HEAD delta is 3 commits whose only source changes are (1) the `204e8594` widening of the client→server-only boundary TEST classifier, (2) one NEW source-scan fixture test (`hdr-badge-contrast.test.ts`), and (3) four single-token a11y className edits (`text-white` → `text-amber-950`). None touches a real architectural boundary. Every invariant in the brief was re-verified clean with static analysis plus executed tests (architectural trio: 23/23 GREEN). The HARD GUARDS are respected: `@/db/index.ts` does NOT carry `import 'server-only'`, and the `mysql2`-in-closure detection remains the non-vacuous substitute. An honest 0-architecture-finding result is the correct outcome — the system is architecturally converged.

## Analysis — what was verified, and the evidence

### 1. Client → server-only boundary (the `204e8594` classifier widening) — VERIFIED CLEAN, the boundary ITSELF is clean

- **The boundary itself (production code):** the only production `'use client'` modules that reach `@/lib/data` are `apps/web/src/components/home-client.tsx:13` and `apps/web/src/components/load-more.tsx:6`, and BOTH use `import type { ImageListCursorInput } from '@/lib/data'` — TypeScript-erased forms that never enter any bundle. A full enumeration of all 63 `'use client'` files found ZERO value-imports of `@/db`, `@/lib/data`, `@/lib/image-queue`, `@/lib/process-image`, or the `@/lib/gallery-config` resolution layer (the only non-`import type` hits are the boundary test's own fixture strings). The client→server-only boundary is genuinely clean at HEAD.
- **The widening is sound and correctly scoped (test-only).** `extractAliasedImports` (`client-server-only-boundary.test.ts:138–223`) now, after the top-level `sf.statements` loop, runs a `ts.forEachChild` full-AST descent (lines 196–218) that ALSO captures the two value-import forms the cycle-6 DBG-C6-01 finding identified as missed: dynamic `import('@/…')` (`CallExpression` with `ts.SyntaxKind.ImportKeyword`, lines 198–206) and `import x = require('@/…')` (`ImportEqualsDeclaration` with `ExternalModuleReference`, lines 208–215), de-duped at line 222. This closes the false-negative narrowing without altering production behavior, without touching `@/db`, and without adding `server-only` anywhere. The classifier pins at lines 404–431 prove it non-vacuously.
- **HARD GUARD #2 respected and re-confirmed:** `@/db/index.ts` carries NO `import 'server-only'` (the file docstring at lines 38–47 documents precisely why — the tsx backfill sidecar resolves `server-only`'s throwing `default` condition). The cycle-5 proof that `import 'server-only'` on `@/db` breaks tsx scripts stands; not proposed, and explicitly rejected for any analysis that would.

**Executed result:** architectural trio (boundary + privacy-fields + data-tag-names-sql) → 23 passed / 0 failed at HEAD.

### 2. Config resolution chain — VERIFIED ACYCLIC, correctly layered

```
gallery-config-shared.ts   (validation + constants; imports NOTHING — pure client-safe leaf; the only `gallery-config.ts` token is in a COMMENT at line 145)
        ↑ value+type
gallery-config.ts          (resolution; imports @/db + drizzle + react cache + ./gallery-config-shared)   [server]
        ↑ value (getGalleryConfig)
image-queue.ts             (imports getGalleryConfig VALUE @ :12, JpegChromaSubsampling TYPE @ :10)
```

- **No cycle:** `gallery-config-shared.ts` imports nothing (no `@/db`, no `mysql2`, no `server-only`, no resolution layer). Its sole textual reference to `gallery-config.ts` is a documentation comment.
- **No inversion:** `gallery-config.ts` does NOT import `image-queue` or `process-image` (grep confirmed). Direction is strictly leaf ← resolution ← consumer.

### 3. Privacy field-selection layering (`adminSelectFields → publicSelectFields`) — VERIFIED SOUND

- `publicSelectFields` (`data.ts:325–357`) and `publicMapSelectFields` (`data.ts:366–393`) are each derived from `adminSelectFields` via explicit destructuring-omit, then re-frozen into SEPARATE `as const` objects (`publicSelectFieldCore` / `publicMapSelectFieldCore` rest-spreads). They are NOT shared references — adding a field to `adminSelectFields` does not auto-leak it.
- The compile-time guards close the loop: `_SensitiveKeysInPublic = Extract<keyof typeof publicSelectFields, PrivacySensitiveKeys>` must resolve to `never` (`data.ts:418–419`); the map variant `_MapSensitiveKeysInPublicMap` guards the map select against everything except the explicitly-allowed `latitude`/`longitude` (`data.ts:429–431`); and `_largePayloadGuard` blocks `blur_data_url` from the listing payload (`data.ts:447–450`). The 20-key `PrivacySensitiveKeys` union is exported and reused by sibling mirrors. Layering is correct and self-enforcing.

### 4. Advisory-lock design — VERIFIED, NO deadlock cycle, NO unsafe two-locks-held hazard

Inventoried every `GET_LOCK` site (6 production sites across `image-queue`, `admin-backfill-runner` ×2, `admin-users`, `topics`, `db-actions`, plus the upload-contract helper) and analyzed nesting:

- **Only ONE path holds two locks simultaneously:** the backfill runner holds `LOCK_COLOR_PIPELINE_BACKFILL` (outer, run-scoped, acquired at `admin-backfill-runner.ts:310`) and `getImageProcessingLockName(id)` (inner, per-image, acquired in `reprocessOne` at `:347`, released in `finally` at `:613`). Every other lock site holds exactly ONE lock (verified GET_LOCK count = 1 each).
- **Deadlock is impossible — two independent guarantees:**
  1. **Both backfill acquisitions are non-blocking** (`GET_LOCK(?, 0)` at `:310` and `:347`). A non-blocking inner acquire cannot create the hold-and-wait edge that deadlock requires — on contention it returns `null` and the row is skipped with no version bump (`:491–493`).
  2. **No reverse lock ordering exists.** `image-queue.ts` — the ONLY other holder of the per-image lock — never acquires `LOCK_COLOR_PIPELINE_BACKFILL` (grep: zero references). The per-image→backfill edge needed to close a cycle does not exist anywhere in the codebase.
- The two BLOCKING acquisitions (`admin-users` and `topics`, `GET_LOCK(?, 5)`) each hold only a single lock and nest no second lock, so the 5-second wait cannot deadlock — there is no second resource to wait on while holding the first.

### 5. Storage abstraction — VERIFIED FULLY DEAD, local-only

- Zero production callers: grep for `getStorage|getStorageSync|switchStorageBackend|getStorageBackend|StorageBackend` across `src/` (excluding the module + tests) returns nothing.
- No S3/MinIO/AWS/network backend: the only `Presigned*` hits are the `PresignedUrlOptions` interface name; no S3/minio/aws/HTTP-client code. The directory is just `index.ts` / `local.ts` / `types.ts`. Matches the CLAUDE.md "local filesystem storage only" contract. It is dead code, not a half-wired feature that could leak.

### 6. New-this-cycle coupling check — CLEAN

`hdr-badge-contrast.test.ts` imports only `vitest` + `node:fs` + `node:path` (a pure source-scan fixture, consistent with the repo's established test architecture — no runtime-module backward dependency). The four `.tsx` edits are single-token `text-white`→`text-amber-950` className changes with zero structural or import deltas.

## Recommendations

None architectural. Do not fabricate refactors. Keep the HARD GUARDS in place: leave `@/db/index.ts` free of `import 'server-only'`; keep the `mysql2`-in-closure detection as the non-vacuous half of the boundary guard; leave `@/lib/storage` dead until a real end-to-end wiring plan exists.

## References

- `apps/web/src/__tests__/client-server-only-boundary.test.ts:196–223` — the `204e8594` AST full-descent widening (dynamic `import()` + import-equals); 9 classifier pins; GREEN at HEAD.
- `apps/web/src/components/home-client.tsx:13`, `apps/web/src/components/load-more.tsx:6` — the only production `'use client'`→`@/lib/data` edges, both `import type` (erased; the boundary is clean).
- `apps/web/src/db/index.ts` — `mysql2/promise` chokepoint; correctly NOT marked `server-only` (HARD GUARD #2 respected).
- `apps/web/src/lib/gallery-config-shared.ts` (pure leaf) / `gallery-config.ts:12,24,26` / `image-queue.ts:10,12` — acyclic config chain.
- `apps/web/src/lib/data.ts:325–357, 366–393, 416–432, 447–450` — privacy field-selection derivation + three compile-time guards.
- `apps/web/src/lib/advisory-locks.ts` — centralized lock registry (6 names).
- `apps/web/src/lib/admin-backfill-runner.ts:310, 347, 469–614` — the only two-locks-held path; both non-blocking; no reverse ordering.
- `apps/web/src/lib/image-queue.ts:195–222` — per-image lock holder; never acquires the backfill lock (no deadlock cycle).
- `apps/web/src/lib/storage/{index,local,types}.ts` — dead abstraction; zero production callers; no network backend.
