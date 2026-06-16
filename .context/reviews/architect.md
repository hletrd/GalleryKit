# Architect Review — GalleryKit

**Run 6 / Cycle 5 · HEAD `2f603716` · branch master · working tree CLEAN · Date 2026-06-16**
**Scope:** Architectural/design-risk review of `apps/web/src` — App Router client/server boundary, data-access layering, the `@/lib/storage` dead abstraction, the `gallery-config-shared → gallery-config → image-queue` coupling chain, single-writer topology assumptions, migration runbook. READ-ONLY; every claim verified from imports/code at HEAD, not docs.

> Note: the architect agent is READ-ONLY (Write/Edit blocked). This file was persisted by the orchestrator on the agent's behalf; the finding below was independently HEAD-verified by the orchestrator before persisting.

## Summary

One real, low-severity finding: the client→server-only regression test does NOT cover the data/persistence layer it implicitly claims to protect — the most probable accidental leak (`'use client'` → `@/lib/data`) would pass it green and might not cleanly fail `next build`. Everything else is sound: the boundary is clean at HEAD across all 48 `'use client'` files, the storage abstraction stays fully dead, the config coupling chain is correctly layered with no cycle, single-writer process-local state is unchanged, and the four deferred structural items remain correctly bound by documented topology.

## Analysis — verified CLEAN (no findings)

- **Client/server boundary at HEAD — clean.** Zero `'use client'` files value-import any server-only module. `@/lib/gallery-config` (DB resolver): 0 client importers. `@/lib/data`: 0 client value-importers (`home-client.tsx:13`, `load-more.tsx:6` are `import type` only; erased at compile). `@/db`: 0 client importers. Every value-importer of the server-only data/image/serve modules is a Server Component, server action, API route, or test. (The prior cycle's "62" was a closure count; the direct `'use client'`-directive count at HEAD is 48.)
- **Config coupling chain — correctly layered, no cycle.** `gallery-config-shared.ts` is a zero-import client-safe leaf; `gallery-config.ts:1-23` is SERVER-ONLY, imports `@/db`, and re-exports shared symbols one-directionally; `image-queue.ts` consumes the resolver at runtime (`:12,:320,:437`) and the shared *type* via `import type` (`:10`). `shared → resolver → consumer`, no back-edge.
- **`@/lib/storage` — fully dead, not half-wired.** Zero production importers; only a doc-comment example (`storage/index.ts:15`) and one test reference it. `serve-upload.ts` reads the filesystem via `@/lib/upload-paths`, never `getStorage()`.
- **Single-writer / process-local state — no new shared assumption.** `restore-maintenance.ts` has zero static imports and only module-level state; no recently-touched module promoted process-local state to implied-shared.
- **Migration runbook — unchanged, robust** (reconcile + per-entry baseline + loud post-condition intact).
- **Cycle-4 fixes** (`6ab40644`, `9a262e3f`, `1fd350be`) are test-only / counter-accounting; zero new coupling, mutable state, or boundary crossings.
- **HARD GUARD honored:** no CLIP-activation proposal.

## Root Cause (of the one finding)

The boundary regression test detects leaks by a single mechanism — scanning a client module's transitive `@/lib`/`@/db` closure for `import 'server-only'`. That sentinel exists on only two leaf modules (`caption-generator.ts:19`, `clip-model.ts:17`), reachable solely via `image-queue.ts` (never client). The data/persistence layer (`@/db`, `@/lib/data`, `@/lib/gallery-config`, `@/lib/process-image`, `@/lib/serve-upload`, `@/lib/color-detection`) carries no marker and is not transitively reachable to one — so the guard's coverage silently excludes the layer a careless refactor is most likely to leak.

## Findings

### ARCH-C5-01 — Client→server-only regression test misses the data/persistence layer (LOW, High)

A future edit adds `import { getImageCached } from '@/lib/data'` to a `'use client'` component (the most likely accidental server leak — `data.ts` is the primary data module). Outcome: (1) `client-server-only-boundary.test.ts` stays GREEN (`data.ts`'s closure — `@/db`, `base56`, `gallery-config-shared`, `restore-maintenance`, `validation`, `utils`, `site-config` — contains no `server-only` sentinel; `@/db/index.ts` itself is unmarked); (2) the clean `next build` failure the test's docstring promises does not fire from `server-only` — the only backstop is the bundler choking on `mysql2`/Node built-ins via `@/db`, which is not a guaranteed build failure and may degrade to a cryptic runtime error or leak server code into the client bundle. The project deliberately built this guard to make the boundary "structurally defended" (AGG-C3-18), yet it does not fire for the highest-probability regression vector.

**Fix (1 line, zero behavioral risk):** add `import 'server-only';` at the top of `apps/web/src/db/index.ts`. Every data/persistence module funnels through `@/db`, so this single marker (a) yields a clean named `next build` failure for any client→data import and (b) brings the entire data layer into the existing test's coverage with no test edit. The `server-only` package is already aliased to a vitest stub (`vitest.config.ts:13`), so server-module unit tests that transitively import `@/db` remain unaffected. Optionally also mark `serve-upload.ts` (it does not reach `@/db`).

**Files:** `apps/web/src/__tests__/client-server-only-boundary.test.ts:2-14,93-95,122-146`; `apps/web/src/lib/data.ts:1-10`; `apps/web/src/db/index.ts:1`; markers at `apps/web/src/lib/caption-generator.ts:19`, `apps/web/src/lib/clip-model.ts:17`.

## Trade-offs

| Option | Pros | Cons |
|---|---|---|
| A — mark `@/db/index.ts` `server-only` (recommended) | 1 line, one chokepoint; covers whole data layer; clean named build failure; no test edit; vitest stub already present | Relies on `@/db` staying the universal data chokepoint (it is; new data modules already import it) |
| B — mark each data module individually | Explicit per-module intent | N edits; forgetting one on the next module re-creates the gap |
| C — make the test flag `@/db`/`fs`/`mysql2`/`sharp` by name | No lib edits | Brittle name-matching; duplicates what `server-only` does natively; loses build-time guarantee |
| D — do nothing | Zero churn | Leaves a known false-confidence hole in the loop's named boundary pin |

## References

- `apps/web/src/__tests__/client-server-only-boundary.test.ts:2-14` — docstring claims to guard the client→server-only boundary broadly
- `apps/web/src/__tests__/client-server-only-boundary.test.ts:93-95` — `hasServerOnlyImport()`: sole detection is the `import 'server-only'` sentinel
- `apps/web/src/__tests__/client-server-only-boundary.test.ts:122-146` — transitive closure walk (well-built; memoized `:39-60`; 60s timeout `:177`)
- `apps/web/src/lib/data.ts:1-10` — primary data module; no marker; marker-free closure
- `apps/web/src/db/index.ts:1` — persistence chokepoint; no marker (recommended single edit site) — VERIFIED at HEAD: file begins `import { drizzle } from "drizzle-orm/mysql2";`, no `server-only`
- `apps/web/src/lib/caption-generator.ts:19`, `apps/web/src/lib/clip-model.ts:17` — only two `server-only` markers; reachable only via `image-queue.ts` (VERIFIED: grep over `apps/web/src/lib` + `apps/web/src/db` finds exactly these two)
- `apps/web/vitest.config.ts:13` → `apps/web/src/__tests__/stubs/server-only.ts:1-11` — `server-only` stub makes marking `@/db` test-safe
- `apps/web/src/lib/gallery-config.ts:1-23` — SERVER-ONLY header + one-directional re-export (no cycle)
- `apps/web/src/lib/gallery-config-shared.ts:5` — documented client-safe zero-DB leaf
- `apps/web/src/lib/image-queue.ts:10,12,320,437` — consumes resolver (runtime) + shared type (`import type`)
- `apps/web/src/lib/storage/index.ts:15` — only non-test storage reference is a doc-comment; `serve-upload.ts` never calls `getStorage()` (dead abstraction confirmed)
- `apps/web/src/lib/serve-upload.ts:1-12` — filesystem serving via `@/lib/upload-paths`; version constant from client-safe `gallery-config-shared`
- `apps/web/src/lib/restore-maintenance.ts` — zero static imports; process-local state (single-writer, AGG-C3-15 unchanged)
- `apps/web/src/components/home-client.tsx:13`, `apps/web/src/components/load-more.tsx:4-6` — `@/lib/data` / `@/app/actions/public` referenced as `import type` only

## Severity count

- **LOW:** 1 (ARCH-C5-01)
- **MEDIUM:** 0
- **HIGH:** 0
- **CRITICAL:** 0

One worth-a-code-change finding (LOW, 1-line fix). The architecture is otherwise at honest convergence — no new layering violation, client→server leak, abstraction misuse, or scaling-assumption break. The four deferred structural items (AGG-C3-14/15/16/17) remain correctly deferred under their existing exit criteria.
