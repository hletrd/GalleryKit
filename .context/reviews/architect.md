# Architecture Review - review-plan-fix cycle 2

Date: 2026-06-29

Role: architect

Scope: repository-wide architecture review at HEAD `3d138704`: boundaries, coupling, layering, process-local coordination state, schema/list drift, scaling assumptions, and design risks. Report-only pass; no application source was edited.

## Inventory Coverage

Built inventory before reviewing:

- Governing docs: `AGENTS.md`, `CLAUDE.md`, root/app READMEs, current `.context/reviews/*`, `.context/plans/README.md`, and recent scheduled/deferred plan docs.
- Current HEAD/package/config: `git log -20`, clean pre-review worktree, root/app `package.json`, `next.config.ts`, Docker/compose/nginx/deploy scripts.
- Source tree: all app routes/actions/API handlers, all components, all library modules, all DB files, all scripts, all e2e specs, all 251 unit-test files, and all 25 Drizzle migrations.
- Architectural focus paths: data-access field sets, topic slug rename, upload quota/queue flow, restore maintenance, advisory locks, storage abstraction, semantic CLIP modules, rate-limit state, backfill runners, migration reconciliation, public route boundaries, and current review artifacts.

## Findings

### ARCH-01 - Restore-maintenance write gate is process-local while the DB restore lock is database-wide

Severity: Medium
Confidence: High
Status: Confirmed scale-out risk

Locations:

- `apps/web/src/lib/restore-maintenance.ts:1-18` stores the active restore flag in `globalThis`.
- `apps/web/src/lib/restore-maintenance.ts:21-56` exposes process-local begin/end/read helpers.
- `apps/web/src/app/[locale]/admin/db-actions.ts:263-350` uses a MySQL advisory lock for restore serialization, but the write-blocking flag remains per process.
- `CLAUDE.md` documents a single web-instance / single-writer topology.

Failure scenario: if the web service is horizontally scaled before this flag moves to shared storage, instance A can hold `LOCK_DB_RESTORE` and set its own maintenance flag while instance B still sees `isRestoreMaintenanceActive() === false` and accepts uploads/settings/actions against a database mid-restore. That is a correctness failure, not just stale status.

Suggested fix: before any multi-instance deployment, move restore maintenance state to DB/shared cache keyed by restore lock ownership, or make all mutating actions check a DB-backed restore marker. Add a topology guard/test or deployment assertion that prevents replicas >1 while this remains process-local.

### ARCH-02 - `clip-embeddings.ts` mixes client-safe pure helpers with server-only environment policy

Severity: Low
Confidence: High
Status: Confirmed boundary smell; latent failure

Locations:

- `apps/web/src/lib/clip-embeddings.ts:18-40` reads `process.env.SEMANTIC_TOP_K_MAX` and `process.env.SEMANTIC_SCAN_LIMIT` at module load.
- `apps/web/src/components/search.tsx:1,19` is a client component importing from the same module.
- Server consumers include `apps/web/src/app/api/search/semantic/route.ts:41-53`, `apps/web/src/app/api/search/similar/[id]/route.ts:37-45`, and `apps/web/src/app/actions/embeddings.ts:18`.

Failure scenario: today the client imports only `SEMANTIC_TOP_K_DEFAULT`, so there is no live bug. The first future client-side control that imports `SEMANTIC_TOP_K_MAX` or `SEMANTIC_SCAN_LIMIT` will get browser-bundle fallback values, while the server enforces operator-configured values. The same symbol then means different things by bundle with no type or test failure.

Suggested fix: split server-only semantic limits into a `server-only`/route-only module, leaving `clip-embeddings.ts` for pure shared vector constants/helpers. Alternatively add an explicit source-contract test that no `'use client'` module imports the env-derived symbols.

### ARCH-03 - Upload quota claim relies on a hand-maintained rollback fan-out across a long async span

Severity: Medium
Confidence: High
Status: Confirmed maintainability risk; currently fenced

Locations:

- `apps/web/src/app/actions/images.ts:224-228` synchronously pre-claims upload quota.
- `apps/web/src/app/actions/images.ts:233-279` manually rolls back on disk/topic early failures.
- `apps/web/src/app/actions/images.ts:520-522` awaits cleanup inside the per-file catch under a non-throwing helper contract.
- `apps/web/src/app/actions/images.ts:541-564` reconciles the claim at the end.

Failure scenario: a future `await` added between the claim and final settle can throw before reaching either manual rollback or final reconciliation, leaving the per-admin/IP window inflated for up to the tracking window. The comments document this invariant, but the shape is still convention-based and easy to regress during upload-path changes.

Suggested fix: next time this span is edited, wrap the post-claim region in a single `try/finally` or small claim object with `settle(successCount, uploadedBytes)` and `rollback()` semantics, so every exit path is structurally settled exactly once.

### ARCH-04 - Topic identity is a mutable natural key with manual fan-out across FK and JSON stores

Severity: Medium
Confidence: High
Status: Confirmed design risk; currently test-fenced

Locations:

- `apps/web/src/db/schema.ts:14-17` `topic_aliases.topic_slug` references `topics.slug`.
- `apps/web/src/db/schema.ts:33` `images.topic` references `topics.slug`.
- `apps/web/src/db/schema.ts:234-243` `topic_views.topic` references `topics.slug`.
- `apps/web/src/db/schema.ts:288-302` smart collections store topic predicates in JSON.
- `apps/web/src/app/actions/topics.ts:320-337` manually remaps smart-collection JSON and deletes/recreates topic rows during slug rename.

Failure scenario: adding a fourth FK child or another non-FK topic-slug store without extending the rename transaction can orphan data or silently change public collection results. Existing registry tests help, but the architecture still depends on every future slug-reference author joining the fan-out list.

Suggested fix: long term, introduce immutable topic IDs and treat slug as an attribute/alias. Short term, keep/extend the existing registry tests and require any new slug reference to register with the rename fan-out before migration lands.

### ARCH-05 - Public image field selection is guarded but still split across mirrored manual allowlists

Severity: Low-Medium
Confidence: High
Status: Confirmed architecture risk; no current leak found

Locations:

- `apps/web/src/lib/data.ts:364-482` defines `publicSelectFields`, `publicMapSelectFields`, and the hand-maintained `PrivacySensitiveKeys` union.
- `apps/web/src/lib/data-timeline.ts:20-73` mirrors a public timeline select set with a type guard.
- `apps/web/src/lib/search-enrichment-fields.ts:29-46` defines a separate search enrichment select with a type-only guard.
- `apps/web/src/__tests__/privacy-fields.test.ts:74-80` checks known sensitive-key drift.

Failure scenario: the current read paths are guarded, but any new public image read path can hand-write a select and forget either the public allowlist or the guard. Privacy invariants then depend on reviewer memory and a manually maintained sensitive-key union rather than on a single exported public column set.

Suggested fix: extract one canonical public image select module, derive map/timeline/search subsets from it, and derive sensitive-key expectations from `adminSelectFields - publicSelectFields` with bidirectional tests that avoid tautologies.

### ARCH-06 - Dormant storage abstraction is present but not wired to the product boundary

Severity: Low
Confidence: High
Status: Confirmed dead abstraction / future coupling risk

Locations:

- `apps/web/src/lib/storage/index.ts:4-12` states the backend is not wired into uploads/processing/serving.
- `apps/web/src/lib/storage/index.ts:52-143` exposes a global singleton and backend switcher that only switches local-to-local.
- `apps/web/src/lib/storage/local.ts:37-139` implements local storage.
- `rg` found zero non-test live importers outside this storage subtree.

Failure scenario: a future caller can import `getStorage()` and believe it is the canonical upload/storage path, creating a half-integrated storage route parallel to the direct filesystem pipeline. That risks divergent path validation, serving rules, cache invalidation, and private-original handling.

Suggested fix: either delete the abstraction until multi-backend storage is scheduled, or add an explicit quarantine/source-contract test that prevents non-test imports and marks the subtree as `@orphaned` until integration work has a real design.

### ARCH-07 - `lib/api-auth.ts` depends upward on `app/actions/auth`

Severity: Low-Medium
Confidence: Medium
Status: Confirmed layering smell

Locations:

- `apps/web/src/lib/api-auth.ts:1` imports `isAdmin` from `@/app/actions/auth`.
- `apps/web/src/app/actions/auth.ts:23-56` owns session/current-user/admin checks.
- Admin API routes depend on `withAdminAuth(...)` from `lib/api-auth.ts`.

Failure scenario: `lib` should be the lower-level reusable layer, but admin API auth now depends on the server-actions module. Future auth refactors can create circular import pressure or make route-level auth inherit action-specific concerns. It works today because both are server-only, but the boundary is inverted.

Suggested fix: move `getSession`, `getCurrentUser`, and `isAdmin` into a server-only `lib/auth.ts`/`lib/current-user.ts`, then re-export from `app/actions/auth` for compatibility. Keep action-only login/logout mutations in the action file.

### ARCH-08 - Production semantic search assumes brute-force DB blob scans instead of an indexed/vector-search boundary

Severity: Medium
Confidence: Medium
Status: Design scaling risk

Locations:

- `apps/web/src/app/api/search/semantic/route.ts:240-281` fetches BLOB embeddings and scores them in process.
- `apps/web/src/app/api/search/similar/[id]/route.ts:141-170` repeats the scan for image-to-image search.
- `apps/web/src/db/schema.ts:271-286` indexes only `(model_version, updated_at)`, which supports limiting recent rows but not nearest-neighbor search.

Failure scenario: this is acceptable for the documented current production size, but relevance and latency are coupled to `SEMANTIC_SCAN_LIMIT` and recency ordering. A larger archive either misses older relevant images or raises the scan limit, shifting DB payload and CPU work onto the web process. This boundary will not scale cleanly beyond personal-gallery size.

Suggested fix: define a semantic-search subsystem boundary before raising limits: precomputed vector index/ANN store, MySQL-side vector support if available, or a background-built nearest-neighbor index loaded by a worker. Keep the current brute-force path as a bounded fallback.

## Healthy Boundaries Reconfirmed

- MySQL advisory lock names are centralized in `apps/web/src/lib/advisory-locks.ts:19-44`; consumers use the registry rather than retyping literals.
- Image derivative processing is isolated behind `image-queue.ts` and `process-image.ts`; the Sharp pipeline has explicit concurrency, cleanup, and color-pipeline contracts.
- Public semantic/similar routes now keep model versions partitioned and return 503 for production-without-rows; the cycle-1 limiter refund and empty-200 issues are fixed in current HEAD.
- Stripe/paid downloads and reactions remain absent from live source; surviving references are migrations/history/tests.
- The single-instance topology is documented and currently consistent with process-local queues/rate limits/status buffers. The architecture risk is future scale-out, not current single-process deployment.

## Missed-Issues Sweep

Checked and did not file new findings for:

- Schema/reconcile drift: schema, migration journal, and reconcile tests exist; no new migration drift was evident in this pass.
- Derived setting lists: color-impacting keys, CLIP model versions, and semantic limits have source tests or comments. Some remain manual but did not show current drift.
- Privacy leakage: public data, timeline, map, and search enrichment field sets carry compile/type/test guards; no live public PII leak found.
- Queue/backfill delete races: processing locks and affected-row cleanup paths are present in queue and backfill runners.
- Rate-limit maps: process-local maps are bounded; login has DB backing. Distributed defense weakens under scale-out, which is already covered by the topology risk.
- Client/server boundary: native CLIP model imports are lazy/server-side; the remaining boundary issue is the shared `clip-embeddings.ts` env constants.

Validation evidence: static, line-numbered source and current review/plan inspection only. I did not run lint/typecheck/tests because this was a review artifact task and no application code changed.
