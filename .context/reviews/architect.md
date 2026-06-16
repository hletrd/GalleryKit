# Architect Review — Cycle 6

**HEAD** `4eb83aab` · **agent** architect · **date** 2026-06-17

## Summary

Zero architectural findings. The codebase is architecturally converged. The cycle-5 fix (AGG-C5-01 / ARCH-C5-01) that landed in HEAD is sound and correctly closes the data-layer coverage hole it targeted, without regressing the tsx-backfill constraint. Every architectural boundary in my brief was verified clean against HEAD with both static analysis and executed tests. An honest 0-architecture-finding result is the correct outcome this cycle.

## Analysis — what I verified, and the evidence

### 1. Client → server-only boundary (the cycle-5 fix) — VERIFIED SOUND, non-vacuous, GREEN

The fix at `apps/web/src/__tests__/client-server-only-boundary.test.ts` is a rigorous, well-reasoned guard:

- **Closure walk uses the TypeScript AST, not regex** (`extractAliasedImports`, lines 138–185). It correctly follows VALUE imports and DROPS type-only imports in both the statement form (`import type {…}`) and the inline form (`import { type X }`) — verified by the executed classifier pins at lines 341–364.
- **`mysql2` / `mysql2/promise` is treated as a server-only-equivalent signal** (`hasServerOnlyDriverImport`, lines 200–202), with a correctly anchored regex (positive/negative cases pinned at lines 321–333). This is the load-bearing widening: it closes the `'use client' → @/lib/data → @/db → mysql2` vector that the bare `import 'server-only'` sentinel missed, because `@/db/index.ts` and the data layer carry no `server-only` marker.
- **Non-vacuity is proven**, not assumed: the test at lines 309–319 asserts `@/db/index.ts` is recognized as server-only-equivalent via its `mysql2/promise` import (`apps/web/src/db/index.ts:2`). I independently confirmed `apps/web/src/lib/data.ts:2` imports `db` from `@/db` as a VALUE — so a future client→data leak has a real chain the walk would traverse and flag RED.
- **The HARD GUARD is respected**: `@/db/index.ts` does NOT carry `import 'server-only'` (verified: only `caption-generator.ts` and `clip-model.ts` carry it). The file docstring documents precisely why — the production backfill sidecar `scripts/backfill-color-pipeline.ts` imports `@/db` under tsx, where `server-only`'s `default` export throws. The cycle-5 approach is the settled correct fix and is not regressed.

**Executed result:** all 5 boundary tests pass. Full architectural trio (boundary + privacy-fields + data-tag-names-sql) → 22 passed. `npm run typecheck` → GREEN.

I checked two potential escape hatches in the walk and found neither is a real gap at HEAD:
- **Relative imports** (`./`, `../`) that the `@/`-only `isAliased` filter would skip: the client-reachable `@/lib` leaf modules use ZERO relative cross-module imports — every dependency is `@/`-aliased, so the walk is complete for these closures.
- **`'use client'` → `@/app/actions` imports**: these are the correct React Server Actions network boundary. `apps/web/src/app/actions.ts` is a pure barrel re-export and each underlying module carries its own `'use server'` directive, so the bundler replaces these with network-reference stubs — NOT bundled server code. The walk's scoping to `@/lib`/`@/db` is intentional and correct.

> CROSS-AGENT NOTE: the debugger agent independently found a **test-only false-negative** in this same classifier (DBG-C6-01): the AST walk iterates `sf.statements` only and handles `ImportDeclaration`/`ExportDeclaration` — it does NOT traverse dynamic `import('@/lib/data')` (`CallExpression`) or `import db = require('@/db')` (`ImportEqualsDeclaration`), two value-import forms the old regex captured. The trigger surface is empty at HEAD (grep confirms no `'use client'` module uses those forms against `@/lib`/`@/db`), so it is correctly LOW. It does not change my "boundary clean at HEAD" verdict, but the guard's *future* coverage should be hardened. This is a guard-strengthening test fix, not an architecture change. See debugger.md / aggregate DBG-C6-01.

### 2. Storage abstraction (`@/lib/storage`) — VERIFIED FULLY DEAD, local-only

- **Zero production callers**: grep for `getStorage|getStorageSync|switchStorageBackend|getStorageBackend` across `src/` (excluding the module + tests) returns nothing.
- **No S3/MinIO/network backend**: `local.ts`'s `getUrl` returns a local path; the only `Presigned*` hits are the `PresignedUrlOptions` interface name. No `s3`/`minio`/`aws`/HTTP client code.
- **Not exposed via any admin surface**: `switchStorageBackend` has no server action, API route, or admin UI caller.

Matches the CLAUDE.md contract verbatim ("local filesystem storage only … Do not document or expose S3/MinIO switching"). Clean.

### 3. Config coupling chain — VERIFIED ACYCLIC, clean layering

```
gallery-config-shared.ts   (validation + constants; imports NOTHING — pure client-safe leaf)
        ↑ value+type
gallery-config.ts          (resolution; imports @/db + gallery-config-shared)   [server]
        ↑ value (getGalleryConfig)
image-queue.ts             (imports getGalleryConfig as VALUE, JpegChromaSubsampling as TYPE)
```

- **No cycle**: `gallery-config-shared.ts` does NOT import `gallery-config.ts`. It imports no `@/db`, no `mysql2`, no `server-only`, no node builtins.
- **Direction correct**: shared leaf ← resolution ← consumer.
- **Client safety**: 10 `'use client'` components import `gallery-config-shared` and ALL pull only pure VALUE constants/functions; NONE import the resolution layer `@/lib/gallery-config`. Exactly the split the boundary test protects.

### 4. Single-writer / process-local state — VERIFIED, matches documented topology

- **Restore flag** (`restore-maintenance.ts`): `Symbol.for`-keyed `globalThis` boolean + `gallerykit_db_restore` advisory lock for real serialization.
- **Upload quota tracker** (`upload-tracker-state.ts`): `Symbol.for`-keyed `globalThis` Map, hard-bounded (2000 keys, 1-hour window, prune-and-evict).
- **Image queue retry maps** (`image-queue.ts`): per-process Maps; per-image processing claim backed by the `gallerykit:image-processing:{jobId}` advisory lock.

No NEW shared-state assumption silently violates single-writer. The `globalThis`-Symbol pattern is per-process (correct for single-instance Docker) and HMR-reload-safe.

### 5. Layering: actions / data / lib / API routes — VERIFIED, no inversion or god-module

- **No lib → processing inversion**: `data.ts` does not import `image-queue`, `process-image`, or any `@/app/` module.
- **One benign directional quirk (NOT a finding)**: `api-auth.ts:1` imports `isAdmin` from `@/app/actions/auth` — a colocation convention, not a true inversion: server-only-consumed, acyclic, pre-existing. Below the threshold for a code change.
- **No god-module forming**: `data.ts` and `process-image.ts` are large but cohesive and stable across cycles.

## Recommendations

None architectural. Do not fabricate refactors. The HARD GUARDS are respected and should remain in place:
- Keep `@/db/index.ts` free of `import 'server-only'` (tsx-backfill constraint — proven in cycle 5).
- Keep the `mysql2`-in-closure detection in the boundary test; it is the non-vacuous half of the guard.
- Leave `@/lib/storage` dead until a real end-to-end wiring plan exists.
- Hardening the boundary test's dynamic-import / import-equals coverage (DBG-C6-01) is a guard-strengthening test fix, not an architecture change.

## References

- `apps/web/src/__tests__/client-server-only-boundary.test.ts` — the cycle-5 fix; AST value-import walk + `mysql2` server-only-equivalent detection; 5 tests GREEN at HEAD.
- `apps/web/src/db/index.ts:2` — `import mysql from "mysql2/promise"`; the chokepoint; correctly NOT marked `server-only`.
- `apps/web/src/lib/data.ts:2` — `import { db, … } from '@/db'`; the value chain that makes the guard non-vacuous.
- `apps/web/src/lib/gallery-config-shared.ts` / `gallery-config.ts:12,26` / `image-queue.ts:10,12` — acyclic config chain.
- `apps/web/src/lib/storage/index.ts` — dead abstraction; zero production callers.
- `apps/web/src/lib/api-auth.ts:1` — the one benign lib→action directional read; NOT a finding.
