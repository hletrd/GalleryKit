# Architect Lane — Run-5 Cycle-3 Deep Review

**Scope:** layering & module boundaries, client/server import edges, coupling & shared-state topology vs the documented single-writer deployment, DB schema/migration risk vs the Migration & Schema-Drift Runbook, advisory-lock namespace coherence, config flow (`gallery-config-shared → gallery-config → consumers`), scaling assumptions, dependency hygiene.
**Diff under extra scrutiny:** `aa5266b5..HEAD` (21 run-5 cycle-2 commits).
**Suppression honored:** plan-315 / 316 / 317 / 322 cross-referenced, not re-reported. Cycle-2 `_aggregate.md` reconciled.

## Summary

The cycle-2 work is architecturally sound. The headline fix — AGG-R5C2-02 (client-reachable `photo-title.ts` no longer hard-imports the server-only `caption-generator.ts`) — is correctly and minimally closed: the new `caption-constants.ts` is a pure-constants module with zero runtime imports, all four `'use client'` consumers (`lightbox`, `home-client`, `info-bottom-sheet`, `photo-viewer`) reach only it, and the sole importer of the `server-only`-guarded `caption-generator.ts` is the server-side `image-queue.ts`. The `server-only` dependency is properly added to `package.json` + `package-lock.json` (the +7-line lock change). The backfill per-image-lock / observability change preserves the single-writer topology and advisory-lock coherence. Config-flow narrowing (`semanticSearchMode` → `'disabled' | 'stub'`) is fully coherent across validator, resolver, route, and queue hook. No new migration landed, so no journal-monotonicity exposure this cycle. Net: zero CRIT/HIGH from the architecture lane; two LOW defense-in-depth gaps.

## Findings

### ARCH-R5C3-01 — LOW · confidence High · status confirmed
**No test-time guard pins the client→server import boundary that AGG-R5C2-02 just closed.**
- **File:** `apps/web/src/__tests__/client-source-contracts.test.ts` (per-component regex assertions only); `apps/web/vitest.config.ts:11` (global `server-only` → empty-stub alias); `apps/web/src/lib/photo-title.ts:2`.
- **Problem:** the AGG-R5C2-02 regression protection rests entirely on `next build` rejecting a re-introduced client→`server-only` edge. The vitest config globally aliases `server-only` to an empty stub for ALL tests (necessary so `image-queue`-chain tests run), which means the unit-test loop can NEVER observe a re-introduced boundary violation. `client-source-contracts.test.ts` pins specific client behaviors but not the import graph. There is no fixture test asserting "`photo-title.ts` (and the four client importers) do not transitively import a `server-only`-guarded module."
- **Failure scenario:** a future refactor adds `import { generateCaption } from '@/lib/caption-generator'` back into `photo-title.ts` (e.g. to surface a live caption in the lightbox), or a new `'use client'` component imports `image-queue`. `npm test` stays green; the break only surfaces when someone runs the full `build` gate. The cycle gate DOES run build so CI catches it, but the fast inner loop silently regresses, and a developer iterating on tests alone gets no signal.
- **Suggested fix:** add a source-scan fixture (sibling to the existing import-side-effect scanners) that walks every `'use client'` file's transitive `@/lib` / `@/db` import closure and asserts none contains `import 'server-only'`. Pin `photo-title.ts → caption-constants.ts` (NOT caption-generator) explicitly, mirroring the existing `process-image-blur-wiring`-style contract tests. Cross-ref: the AGG-R5C2-02 fix itself is verified-correct; this is the missing fast-loop regression net.

### ARCH-R5C3-02 — LOW · confidence Med · status needs-manual-validation
**Admin-backfill per-image claim holds a pool connection for the full CPU-bound encode window; pool-pressure interaction with `ADMIN_BACKFILL_CONCURRENCY` is undocumented.**
- **File:** `apps/web/src/lib/admin-backfill-runner.ts:198-220` (`acquireImageProcessingClaim` borrows from the shared 10-connection pool and holds it across `processImageFormats` + `detectColorSignals` + the UPDATE, released only in the outer `finally` at :391); pool config `apps/web/src/db/index.ts:19` (`connectionLimit: 10`).
- **Problem:** each in-flight `reprocessOne` now pins one pool connection for the entire re-encode (seconds-to-minutes per image), ON TOP of the dedicated backfill-lock connection. At the default `ADMIN_BACKFILL_CONCURRENCY=1` this is 2 of 10 connections — safe. But the value is operator-tunable and `getGalleryConfig()` / `db.execute()` inside the same job also draw from the pool; a raised concurrency (e.g. 6-8) during heavy site traffic could approach the `queueLimit: 20` backpressure and slow foreground requests. The new code is a correctness improvement (it prevents the double-encode race), not a regression — but the pool-pressure tradeoff of holding a connection across the encode window is not documented at the call site or in the operational playbook.
- **Failure scenario:** an operator sets `ADMIN_BACKFILL_CONCURRENCY=8` on the single-web-instance deployment, triggers a re-encode of a large gallery during peak traffic; 8 pool connections sit idle-but-held inside `GET_LOCK`/encode while foreground page renders queue behind `queueLimit`, manifesting as transient slow pages rather than an error.
- **Suggested fix:** add a one-line cap guidance comment at the claim site and in the CLAUDE.md Backfill section: keep `ADMIN_BACKFILL_CONCURRENCY` × (claim conn + work conn) well under `connectionLimit - foreground headroom` on the single-writer topology. No code change required; this is a documentation/scaling-assumption note. Validate with a pool-saturation observation before any code change.

## Verified clean (this lane, this cycle)

- **AGG-R5C2-02 boundary closed at source:** `caption-constants.ts` has zero runtime imports; `image-types.ts` (the other `photo-title` dep) is pure types; no `'use client'` file imports `image-queue` / `caption-generator` / `@/db` directly. `import 'server-only'` correctly added to `caption-generator.ts:21`. Single source of truth for `ALT_TEXT_STUB_PREFIX` enforced (both modules import from constants).
- **Dependency hygiene:** `server-only@^0.0.1` added to `package.json:63` AND `package-lock.json` (the +7-line change) — in sync, integrity hash present, no phantom/unused dep, no version drift.
- **Config flow coherence:** `semanticSearchMode` narrowed to `'disabled' | 'stub'` across all four layers — validator (`gallery-config-shared.ts:171` rejects `'production'`), default (`:108` = `'disabled'`, valid), resolver (`gallery-config.ts:134` heals stale `'production'` → default), route (`semantic/route.ts:200`), and queue hook (`image-queue.ts:425`). Every remaining `'production'` occurrence is comment-only. No unreachable runtime branch, no type-union leak.
- **Advisory-lock namespace coherence:** the backfill's new `getImageProcessingLockName(id)` reuses the EXACT same lock name + 0-second non-blocking semantics as `image-queue.ts`'s claim (`advisory-locks.ts:39`), so the runner and the live queue worker mutually exclude on the same `gallerykit:image-processing:{id}` key — correct. Connection-bound `GET_LOCK`/`RELEASE_LOCK` lifecycle is correct (same conn acquires/releases/releases-to-pool). Server-scoped-lock caveat already documented.
- **Shared-state topology vs single-writer:** the new backfill observability counters (`skippedMissingOriginal` / `skippedLocked` / `encodeFailures` / `detectionFailures`) live on the existing process-local `globalThis` `AdminBackfillState` — consistent with the documented single-web-instance topology, reset per-run, defensively back-filled for older state objects (`getState()` `??=` guards). No NEW process-local coordination state that would break under horizontal scaling beyond what is already documented.
- **Schema/migration:** no migration files or `migrate.js` changed this cycle → no journal-monotonicity exposure. `image_embeddings.model_version` column exists (`schema.ts:269`, `varchar(32) notNull`) so the embedding-hook stub-provenance comment is factually accurate (no migration needed for a future encoder to distinguish stub rows).
- **`data.ts` privacy guard hardened:** `_MapSensitiveKeys` now derived as `Exclude<PrivacySensitiveKeys, 'latitude' | 'longitude'>` (was a hand-maintained literal union) — auto-tracks future additions to the canonical union, eliminating the documented drift risk (AGG-R5C2-32). Architectural improvement.

## Cross-referenced (suppressed — not re-reported)

- Sidecar `backfill-color-pipeline.ts` per-image-lock gap (the asymmetry vs the in-app runner) — **deferred in plan-322 §4b** with documented exit criterion and operator guidance in the script header. Structurally blocked by the decoupled `flushBatch()` batching. Confirmed accepted, not re-raised.
- Backfill `(processed, pipeline_version, id)` candidate-scan index — plan-322 §1 (AGG-R5C2-34), deferred pending large-gallery evidence.
- Semantic-search stub honesty cluster — landed this cycle (commit 5700f184); docstring/union/disclaimer all reconciled and verified above.

## Layers / boundaries covered

1. Client/server import edges (every `'use client'` file's transitive `@/lib`/`@/db` closure, `server-only` sentinel placement).
2. Module boundaries (caption-constants vs caption-generator vs photo-title single-source-of-truth).
3. Config flow (`gallery-config-shared` validator → `gallery-config` resolver → semantic-route + image-queue consumers).
4. Advisory-lock namespace coherence (backfill claim ↔ queue claim ↔ centralized registry).
5. Shared-state / coupling topology vs the documented single-writer deployment (backfill `globalThis` state, pool-connection lifecycle).
6. DB schema & migration-runbook compliance (journal monotonicity, no new migration, embedding-column existence).
7. Dependency hygiene (`server-only` package.json/lock sync, the +7-line lock change).
8. Scaling assumptions (pool-connection pressure under `ADMIN_BACKFILL_CONCURRENCY`).
