# Architect Review — GalleryKit

**Cycle 3 / HEAD `b1e9e0da`**
**Scope:** Architectural & design-risk review of `apps/web/src` — coupling, layering, leaky abstractions, separation of concerns, dependency direction, module boundaries, scalability assumptions, single-points-of-failure, configuration sprawl, abstraction-vs-product mismatch.
**Mode:** READ-ONLY. Verified against current HEAD. Closed-cycle items not re-reported.

---

## Summary

The codebase is structurally healthier than its size suggests. The config flow (`gallery-config-shared` → `gallery-config` → `image-queue`) is cleanly stratified with no cycles; the public/admin field separation in `data.ts` is exemplary (three layered compile-time guards over a destructure-derived select shape); the server-action vs API-route boundary is principled (HTTP-capability-driven, not arbitrary); the color/HDR pipeline is cohesive behind a single `detectColorSignals` entry point with a genuinely clean client-safe/server-only split; and `migrate.js` converted a silent-skip production failure into a loud post-condition assertion.

The real architectural risks are concentrated in two places. First, **`@/lib/storage` is 390 lines of fully-built, zero-consumer dead abstraction** whose `switchStorageBackend('local' → 'local')` is a no-op and whose `StorageBackend` interface re-implements path-safety logic that already lives in the live pipeline — it is misleading dead weight that invites a future contributor to "wire it up" against a product that supports one backend. Second, **the single-writer constraint is documented but not architecturally enforced or made safe**: the DB-restore maintenance gate is a `globalThis` boolean (`restore-maintenance.ts`) protected by a MySQL-server-scoped lock, an asymmetry that turns a second web instance from "degraded analytics" into "serves traffic against a database being restored underneath it." The constraint lives entirely in prose; nothing in the runtime resists violating it.

My top recommendation: **delete `@/lib/storage` (HIGH/High)** and, if multi-instance is ever plausible, **add a startup advisory-lock-based single-instance assertion (MEDIUM/Medium)** so the documented constraint becomes a runtime invariant rather than tribal knowledge.

---

## Module Map (apps/web/src)

```
proxy.ts ............ i18n routing + CSP nonce injection + admin-cookie presence gate (middleware)
db/ ................. schema.ts (canonical Drizzle schema) · index.ts (pool) · seed.ts
lib/ (91 files) ..... data access, image pipeline, color/HDR, auth, rate-limit, storage(dead), config
  data.ts (1662) .... DATA-ACCESS LAYER — admin/public/map select-field separation + React cache()
  process-image.ts .. Sharp pipeline (1650) — encode matrix, EXIF, GPS strip, AVIF/WebP probes
  image-queue.ts .... PQueue orchestration (786) — consumes resolved config, claims rows, fans out
  gallery-config*.ts  config: -shared (validators/consts, client-safe) → resolver (server, DB) 
  color-* / icc-* ... color/HDR detection subsystem (8 files, 1474 LOC) behind detectColorSignals
  storage/ .......... DEAD abstraction (390 LOC, 0 importers)
  *-state / rate-* .. in-process singletons (Symbol.for-pinned globalThis Maps/booleans)
  advisory-locks.ts . centralized MySQL advisory-lock name registry
app/
  actions/ (14) ..... server actions — admin mutations (requireSameOriginAdmin+isAdmin) + public.ts
  api/ (11 routes) .. HTTP-semantics endpoints (webhooks, streaming, OG render, health, search)
  [locale]/ ......... public + admin(protected) route groups
components/ (large) . photo-viewer(1117), histogram, lightbox, image-manager, color-details...
scripts/migrate.js .. reconcile + per-entry baseline + loud post-condition (775 LOC)
```

---

## Findings

### A1 — `@/lib/storage` is fully-built dead weight with a no-op backend switch and duplicated safety logic
**Severity: HIGH · Confidence: High**

**Module:** `apps/web/src/lib/storage/index.ts` (146), `local.ts` (139), `types.ts` (105) — 390 LOC total.

**Risk.** The entire module has **zero importers** — `grep` for `@/lib/storage` across the repo returns one hit, inside its own docstring (`index.ts:15`). The live upload/process/serve paths (`process-image.ts`, `serve-upload.ts`, `actions/images.ts`) all use direct `fs`. The module is not a stub: `LocalStorageBackend` is a complete implementation with path-traversal guards (`local.ts:40-48`), symlink rejection (`local.ts:94-97`), hardlink-with-copy-fallback (`local.ts:118-128`), and a `getUrl` that refuses `original/` (`local.ts:130-138`). `index.ts` adds a singleton with init-promise dedup, plus `switchStorageBackend` (lines 85-128) with rollback-on-failure logic.

Two things make this actively harmful rather than merely unused:
1. **`switchStorageBackend` is a no-op by type.** `StorageBackendType = 'local'` (`index.ts:25`) is a single-member union. The function's entire purpose — switching backends — can only ever switch `'local'` → `'local'`, short-circuiting at line 88. ~45 lines of rollback/dispose machinery defend a transition that cannot occur.
2. **It re-implements path-safety that already exists.** `normalizeStorageKey` + `resolve` (`local.ts:22-48`) duplicate the `SAFE_SEGMENT` / `ALLOWED_UPLOAD_DIRS` / `startsWith` containment logic that the live pipeline implements in `upload-paths.ts` / `serve-upload.ts`. Two independent copies of the security-critical containment check is the classic divergence trap: a fix to one is silently absent from the other.

CLAUDE.md already concedes the mismatch ("still exists as an internal abstraction, but the product currently supports local filesystem storage only… Do not document or expose S3/MinIO switching"). The honesty note is good; the 390 lines it describes are the problem.

**Consequence.** (a) A future contributor reads the `StorageBackend` interface, sees `writeStream`/`writeBuffer`/`getUrl`/`createReadStream` matching exactly what the pipeline does, and "completes the integration" — re-routing the live pipeline through an abstraction layer that was never load-tested and whose path-safety has drifted from the real one. (b) The dead `switchStorageBackend` reads as a feature ("we support pluggable backends") that does not exist, misleading anyone scoping S3 support into thinking the seam is already there. (c) Maintenance tax: every security sweep of "path traversal in file handling" must now audit two implementations.

**Refactor direction.** Delete `lib/storage/` entirely. The live pipeline does not import it; removal is mechanically safe (verify with `grep -rn "lib/storage" src/`). If a backend seam is genuinely wanted later, introduce it *at the point of integration* (when S3 is actually being added) so the interface is shaped by two real implementations, not one speculative one. Keeping a speculative abstraction "for later" is precisely the YAGNI failure that produces leaky, untested seams. If the team prefers to keep it as a documented spike, move it out of `src/` into a `docs/` or `experiments/` location so it cannot be imported and is not type-checked as production code.

**Trade-off.** Deleting loses a head-start on S3 support. But the head-start is illusory — an unused, untested, single-backend abstraction is closer to a liability than an asset, and git history preserves it for resurrection.

---

### A2 — Single-writer constraint is prose-only; the restore-maintenance gate is process-local behind a server-scoped lock
**Severity: HIGH · Confidence: Medium**

**Modules:** `apps/web/src/lib/restore-maintenance.ts` (56) · `app/[locale]/admin/db-actions.ts:264-349` · `advisory-locks.ts:20` · `upload-tracker-state.ts` · `data.ts:17-160` (view-count buffer) · `rate-limit.ts` / `auth-rate-limit.ts`.

**Risk.** The deployment is documented as single-web-instance, and every coordination state is a `globalThis`-pinned in-process singleton (`Symbol.for('gallerykit.*')`): `restore-maintenance` (boolean), `upload-tracker` (quota Map), `view-count` buffer (Map in `data.ts`), rate-limit Maps. This is the correct pattern *for a single instance* — `Symbol.for` survives HMR/module reload. The problem is the **asymmetry between the lock scope and the state scope** in the restore path, and the total absence of a runtime guard.

`db-actions.ts` acquires `LOCK_DB_RESTORE` (`SELECT GET_LOCK`, line 290) — a MySQL-**server**-scoped lock (per `advisory-locks.ts:5-16`), so it correctly serializes restores *across* instances. But immediately after, it calls `beginRestoreMaintenance()` (line 310), which flips the **process-local** boolean in `restore-maintenance.ts`. Sixteen call sites consult `isRestoreMaintenanceActive()` to reject uploads / gate writes / fail health checks (`grep` confirms: `image-queue`, `actions/images`, `actions/public`, `api/admin/lr/upload`, `api/health`, etc.).

In a two-instance deployment:
- Instance A runs the restore: holds the cross-instance lock, enters maintenance, rejects its own uploads. Correct.
- Instance B: the lock blocks B from *starting a competing restore* (good), but B's `isRestoreMaintenanceActive()` is `false` because the boolean is A's process memory. B keeps accepting uploads and serving writes **against a database being torn down and reloaded underneath it.**

So the lock upgrades the failure mode from "two concurrent restores corrupt each other" to "one restore proceeds while the other instance writes into the restore window" — a *different* correctness failure, not a fix. The view-count undercount and rate-limit-budget-per-instance issues are the documented "best-effort/approximate" degradations; the restore-maintenance gap is a **silent data-integrity** gap that the docs frame identically to the benign ones.

There is **no runtime single-instance assertion anywhere** (`grep` for `INSTANCE_ID` / leader-election / startup advisory lock returns nothing). The constraint is enforced only by an operator reading CLAUDE.md.

**Consequence.** The day someone puts two replicas behind the load balancer "because traffic grew" — a routine, reasonable ops decision — restores silently race live writes, rate limits give each IP N×budget, and upload quotas under-count by a factor of N. Nothing crashes; nothing logs an error. The architecture's safety depends entirely on a fact (instance count = 1) that the code never checks.

**Refactor direction.** Two complementary moves, in priority order:
1. **(MEDIUM, cheap) Make the constraint a runtime invariant.** At startup, attempt a non-blocking `GET_LOCK('gallerykit_single_instance', 0)` on a long-lived connection and hold it for process lifetime. If acquisition fails, the instance is the second writer — log a loud warning (or refuse to boot, configurable). This converts "documented assumption" into "self-evident at deploy time" for near-zero cost and reuses the existing advisory-lock infrastructure.
2. **(larger, only-if-scaling) Promote the restore-maintenance gate to shared state.** A restore-in-progress flag belongs in the DB (a row in `admin_settings` or a dedicated `maintenance` table), polled by all instances, not in one process's heap. This is the one in-process state whose process-locality is a correctness bug rather than an analytics approximation, so it is the first to move if multi-instance is ever real.

**Trade-off.** The startup lock adds one persistent DB connection and a boot-time check; trivial. Moving restore-maintenance to shared state adds a read on hot paths — but only this one flag needs it, and it can be cached with a short TTL. Neither is needed *today* at one instance; (1) is worth doing now purely as a guardrail.

| Option | Pros | Cons |
|--------|------|------|
| Do nothing (status quo) | Zero work; correct at 1 instance | Constraint invisible at runtime; silent corruption if scaled |
| Startup single-instance lock (rec #1) | Cheap; loud failure; reuses lock infra | Doesn't *enable* scaling, just prevents silent misuse |
| Shared-state restore flag (rec #2) | Actually safe under multi-instance | Hot-path read; only worth it if scaling is real |

---

### A3 — `reconcileLegacySchema` is a hand-maintained full-schema mirror that must be manually kept in lockstep with every migration
**Severity: MEDIUM · Confidence: High**

**Module:** `apps/web/scripts/migrate.js:247-613` (the `reconcileLegacySchema` function — ~366 lines of `CREATE TABLE IF NOT EXISTS` + `ensureColumn`/`ensureIndex`/`ensureForeignKey` calls).

**Risk.** The migration system is *robust* where it counts: `runMigrations` (lines 698-719) adds a post-condition that throws if any journal hash is missing from `__drizzle_migrations`, converting the documented silent-skip failure into a loud deploy failure; and fresh databases now bootstrap through the same deterministic reconcile + per-entry baseline path (`prepareLegacyDatabaseIfNeeded:662-680`) rather than the broken drizzle-cursor path. That design is sound and should not change.

The liability is `reconcileLegacySchema` itself. It is a **second, parallel encoding of the entire schema** — every table and column the app knows about, re-expressed as idempotent raw DDL — that exists alongside the canonical `db/schema.ts` and the `drizzle/NNNN_*.sql` files. CLAUDE.md's "Adding a new migration" step 3 makes the coupling explicit and manual: *"Update `reconcileLegacySchema` in `migrate.js` to mirror the new schema state."* So every schema change must be written **three times** — schema.ts, the migration SQL, and the reconcile mirror — kept consistent by human discipline.

The drift risk is real and asymmetric: the post-condition assertion (A's strength) only checks that journal *hashes* are recorded; it does **not** verify that `reconcileLegacySchema` actually produced the columns those migrations describe. So a contributor who adds a migration + journal entry but forgets the reconcile mirror gets a green deploy on a fresh DB *only if* drizzle's own `migrate()` applies the SQL — which it does — meaning the reconcile mirror is load-bearing **only on the legacy-reconcile path** (existing DBs with incomplete migration logs). That path is exactly the one that is hardest to test and only exercised in production-shaped databases.

**Consequence.** (a) Triple-entry maintenance on every schema change, enforced by a CLAUDE.md sentence rather than by code or test. (b) A forgotten reconcile-mirror update is invisible on fresh installs and CI (drizzle applies the real SQL there) but bites on a legacy production DB during reconcile — the worst place to discover it. (c) The 366-line function is itself hard to review; the `images` table alone has ~40 `ensureColumn` calls that must each match a column in schema.ts by eye.

**Refactor direction.** The honest long-term fix is to derive the reconcile DDL from a single source rather than hand-maintaining it. Options, roughly in order of effort: (1) Add a test that boots a database through `reconcileLegacySchema` *only* (no drizzle migrate) and asserts the resulting `INFORMATION_SCHEMA` matches what `db/schema.ts` declares — this makes a forgotten mirror update a CI failure instead of a latent prod bug, and is the highest-leverage cheap step. (2) Longer term, generate the reconcile baseline from the journal SQL files programmatically (replay all `NNNN_*.sql` against a scratch schema) so the mirror is computed, not transcribed. Do not remove the post-condition or the reconcile path — they are the parts that work.

**Trade-off.** A schema-parity test adds a DB-backed test fixture and some CI time. Generating the mirror is a meaningful refactor with its own risk. The status quo is *functional* — it has survived many migrations — so this is a maintainability/latent-risk finding, not a correctness emergency. The cheap test (option 1) is the right next step.

---

### A4 — `actions/images.ts` is a 1157-line god-action mixing upload, delete, metadata, bulk-edit, and retry concerns
**Severity: MEDIUM · Confidence: Medium**

**Module:** `apps/web/src/app/actions/images.ts` (1157 LOC) — exports `uploadImages` (108-542, ~435 lines), `deleteImage` (543), `deleteImages` (639), `updateImageMetadata` (797), `bulkUpdateImages` (875), `retryFailedImage` (1082).

**Risk.** This single file is the largest server action by a wide margin (next is `topics.ts` at 550) and is the convergence point of the most complex flows in the app: multipart parsing, per-file validation, GPS-strip decisioning, upload-contract advisory lock, tracker claim/settle, queue enqueue, restore-maintenance gating, and revalidation. `uploadImages` alone is ~435 lines. Five other unrelated mutations (delete/bulk/retry/metadata) share the file purely because they operate on the `images` table. There is no cohesion principle beyond the entity name — delete-orphan-cleanup logic, bulk-edit transaction logic, and the upload pipeline have almost no shared code, yet all live together.

This is the standard "actions file grows with the entity" pattern. It is not broken, but it concentrates the highest-churn, highest-risk surface (uploads — where the GPS-strip, path-safety, and contract-lock concerns all meet) into one file that every metadata/delete change also touches, maximizing merge-conflict surface and review burden.

**Consequence.** (a) Reviewers auditing an upload-pipeline change must scroll past delete/bulk/retry code; the blast radius of "edit images.ts" is large. (b) The upload flow's many cross-cutting concerns (lock, tracker, maintenance, queue, revalidation) are interleaved in one 435-line function, making it hard to reason about the ordering invariants (e.g. claim-before-enqueue, settle-on-failure) in isolation. (c) Growth pressure: the next image feature lands here too.

**Refactor direction.** Split by *flow*, not by entity: `actions/image-upload.ts` (uploadImages + its helpers), `actions/image-mutations.ts` (delete/deleteMany/updateMetadata/bulkUpdate/retry). The action-origin lint scanner already discovers any file in `actions/`, so splitting requires no wiring change. Separately, extract the upload *orchestration* (lock→tracker→validate→enqueue→settle) out of the action body into a `lib/upload-orchestration.ts` so the action becomes a thin auth+parse shell over a testable orchestration unit — the same shape the API route `api/admin/lr/upload` already needs (it "mirrors uploadImages exactly," per the route map, which is itself a sign the orchestration wants to be shared rather than duplicated).

**Trade-off.** Splitting touches import sites and risks churn against in-flight work. The file is *navigable* today (clear export boundaries). This is a "pay down before it gets worse" finding, not urgent; the highest-value piece is extracting the shared upload orchestration that `lr/upload` currently duplicates.

---

### A5 — Server-action upload pipeline is duplicated by the Lightroom API route instead of sharing an orchestration core
**Severity: MEDIUM · Confidence: Medium**

**Modules:** `app/actions/images.ts` `uploadImages` (108-542) and `app/api/admin/lr/upload/route.ts` (the route map notes it "mirrors uploadImages action exactly… identical processing to browser path").

**Risk.** There are two entry points into image ingestion — the browser server action and the Lightroom-PAT HTTP route — and the route is documented as *mirroring* the action's behavior (upload-contract lock, restore-maintenance guard, tracker claim/settle, identical processing). "Mirrors exactly" across two files with no shared core is a duplication that will drift. The upload pipeline is the single most security-sensitive flow in the app (path safety, GPS strip, quota, contract lock); two copies of its orchestration means a fix or hardening applied to one can silently miss the other.

**Consequence.** A future change to upload invariants — e.g. tightening the GPS-strip decision, adjusting the claim/settle ordering, or adding a new validation — must be made in both places and *kept* consistent by reviewer vigilance. The boundary (action vs route) is itself principled (the route exists for PAT/header auth + multipart, which server actions can't do — see boundary analysis below), so the routes *should* both exist; what's wrong is that they re-implement the same body rather than both calling a shared orchestration function.

**Refactor direction.** Extract the post-auth, post-parse ingestion sequence into `lib/upload-orchestration.ts` exposing something like `ingestUploadedFiles(files, { uploadedBy, … })` that owns lock → maintenance check → tracker claim → per-file validate/save/enqueue → settle. Both the server action and the LR route then reduce to their distinct auth/parse shells over one shared, unit-testable core. This directly serves A4 as well.

**Trade-off.** Requires careful extraction of a flow with several failure/rollback branches; the extraction itself must preserve ordering invariants. But the alternative — two hand-synchronized copies of the most dangerous flow — is the higher long-term risk.

---

### A6 — `actions/images.ts:29` imports `isWideGamutPrimary` from the server-only `color-detection`, dragging `fs`/Sharp into the import graph
**Severity: LOW · Confidence: High**

**Module:** `app/actions/images.ts:29` imports `isWideGamutPrimary` from `@/lib/color-detection`, which re-exports it (`color-detection.ts:48`) from the genuinely client-safe `color-primaries.ts`. `color-detection.ts` itself imports `fs/promises` and Sharp (`lines 13-14`).

**Risk.** The pure predicate `isWideGamutPrimary` has a clean, dependency-free home (`color-primaries.ts`, zero imports). Importing it via the `color-detection` re-export pulls the server-only detection module (with `fs`, Sharp, and the icc-*/gain-map sub-imports) into the import graph at that site. In a server action this does not leak to the client bundle (it's server code already), so the *consequence* is contained — but the **re-export at `color-detection.ts:48` is a latent layering trap**: it makes a server-only module a plausible-looking source for a client-safe symbol, and the test `wide-gamut-primaries.test.ts:13` already imports it from `color-detection` too. The day a *client component* copies that import path, a server-only module (with `fs`) gets pulled toward the client bundle.

**Consequence.** Low today (server-only consumer). The risk is propagation: the re-export normalizes a wrong import source, and the next consumer may be client-side, at which point it becomes a real server-code-in-client-bundle violation (or a build error, depending on bundler strictness).

**Refactor direction.** Change `actions/images.ts:29` (and the test) to import `isWideGamutPrimary` from `@/lib/color-primaries`. Remove the convenience re-export at `color-detection.ts:48` so the client-safe layer is the *only* source for the client-safe symbols — the boundary becomes enforced by import resolution rather than by convention.

**Trade-off.** Trivial mechanical change; the only cost is touching a couple of import lines. No downside.

---

### A7 — `hdr-filenames.ts` is reserved dead code shipped in `src/`
**Severity: LOW · Confidence: High**

**Module:** `apps/web/src/lib/hdr-filenames.ts` (15 LOC) — `deriveHdrAvifFilename`, consumed only by its own test; not referenced by any active code (reserved for WI-09).

**Risk.** A small, clearly-documented reserved helper. Unlike A1 it is honest (CLAUDE.md flags it "RESERVED — NOT WIRED until WI-09"), tiny, and test-locked. The only architectural note is that it sits in `src/` and is type-checked/shipped as production code despite having no production consumer — a minor instance of the same "speculative code in the production tree" pattern as A1.

**Consequence.** Negligible functional impact. Minor: contributes to the "is this used?" ambiguity when navigating `lib/`.

**Refactor direction.** Acceptable to leave given the explicit honesty invariant around it. If WI-09 is not on the near-term roadmap, consider parking it with the feature plan rather than in `lib/`. No action required this cycle.

---

## Positives (verified sound — explicitly NOT findings)

- **`data.ts` field separation (lines 204-450).** `adminSelectFields` is the canonical select shape; `publicSelectFields`, `publicMapSelectFields`, and the list shape are *derived by destructure-omit* from it (separate object references, so adding a field to admin does not auto-leak). Three layered compile-time guards: `_privacyGuard` (PII absent from public), `_mapPrivacyGuard` (map shape = public ∪ {lat,lng} only), `_largePayloadGuard` (`blur_data_url` kept out of list payloads). This is a genuinely well-engineered, defense-in-depth boundary — the derivation forces a conscious decision and the guards fail the *build*, not a runtime check. Best structural pattern in the repo.

- **Config flow stratification.** `gallery-config-shared.ts` (validators + constants, zero imports, client-safe) → `gallery-config.ts` (server-only DB resolver, React `cache()`, falls back to DEFAULTS on DB error, heals `'production'`→`'disabled'`) → `image-queue.ts` (consumes resolved typed `GalleryConfig`). No cycles. `JpegChromaSubsampling` flows as a type end-to-end, eliminating runtime casts. `COLOR_IMPACTING_KEYS` (settings-hash) and `GALLERY_SETTING_KEYS` each have a single source of truth. Sound.

- **Server-action vs API-route boundary is principled.** Routes exist exclusively for HTTP capabilities server actions lack: webhook signature verification (`stripe/webhook`), binary streaming with atomic single-use token claim (`download/[imageId]`, `admin/db/download`), header/PAT auth + multipart (`admin/lr/upload`), in-process embedding compute (`search/*`), and ops probes (`health`, `live`). Admin mutations correctly stay as server actions behind `requireSameOriginAdmin` + `isAdmin`. No route is gratuitous.

- **Color/HDR subsystem cohesion.** Single server entry point `detectColorSignals` (`color-detection.ts:291`) orchestrates ICC-name / NCLX-CICP / chromaticity / gain-map detection. Client-safe layer (`color-primaries.ts`, `color-pipeline-decisions.ts`) is provably import-free; all 8+ consuming components import only from that layer. The 1474 LOC across 8 files map to distinct concerns (ICC name parse, chromaticity math, gain-map container walk) — justified separation, not fragmentation. (One leak: A6.)

- **`proxy.ts` dual responsibility is appropriate, not overloaded.** It does i18n routing (next-intl), CSP nonce injection, and an admin-cookie *presence/format* gate. The auth concern is deliberately shallow — presence + 3-segment/length format only (lines 90-115), with the explicit comment that cryptographic validation lives in server actions (defense in depth). Edge middleware *is* the correct layer for routing + a cheap pre-filter; it does not duplicate real auth. The `x-gk-admin-render` header (lines 128-130) is a clean solution to the SW-can't-read-Cookie constraint. Cohesive.

- **`migrate.js` post-condition + fresh-DB-through-reconcile design.** The loud assertion (lines 710-718) and unified bootstrap path (662-680) are the right architecture for the documented non-monotonic-journal hazard. (The `reconcileLegacySchema` maintenance burden is A3, but the surrounding machinery is sound.)

- **`advisory-locks.ts` registry.** Centralized lock-name constants with explicit server-scope documentation (lines 5-16). Eliminates the inline-string-collision risk it was created to fix.

---

## Recommendations (prioritized)

1. **A1 — Delete `lib/storage/` (390 LOC dead abstraction).** HIGH · low effort · removes a misleading seam + duplicated path-safety. Verify zero importers (`grep -rn "lib/storage" src/`) then remove.
2. **A2 #1 — Add a startup single-instance advisory lock.** MEDIUM · low effort · converts the prose-only single-writer constraint into a loud runtime guardrail using existing lock infra.
3. **A3 — Add a schema-parity test for `reconcileLegacySchema`.** MEDIUM · medium effort · makes a forgotten reconcile-mirror update a CI failure instead of a latent legacy-DB prod bug.
4. **A4 + A5 — Extract `lib/upload-orchestration.ts`; split `actions/images.ts` by flow.** MEDIUM · medium effort · de-duplicates the LR-route mirror and shrinks the god-action; highest-value sub-step is the shared orchestration core.
5. **A6 — Repoint `isWideGamutPrimary` import to `color-primaries`; drop the `color-detection` re-export.** LOW · trivial · closes a latent layering trap.
6. **A2 #2 — (only if multi-instance becomes real) Move the restore-maintenance flag to shared DB state.** MEDIUM · larger effort.

---

## References

- `apps/web/src/lib/storage/index.ts:25` — `StorageBackendType = 'local'` (single-member union; switch is a no-op)
- `apps/web/src/lib/storage/index.ts:85-128` — `switchStorageBackend` rollback machinery for an impossible transition
- `apps/web/src/lib/storage/local.ts:22-48` — `normalizeStorageKey`/`resolve` duplicate live-pipeline path containment
- `apps/web/src/lib/storage/index.ts:15` — the only `@/lib/storage` reference in the repo is this docstring
- `apps/web/src/lib/restore-maintenance.ts:1-56` — process-local `globalThis` boolean maintenance gate
- `apps/web/src/app/[locale]/admin/db-actions.ts:290,310` — `LOCK_DB_RESTORE` (server-scoped) then `beginRestoreMaintenance()` (process-local) — the scope asymmetry
- `apps/web/src/lib/advisory-locks.ts:5-16` — explicit "scoped to the MySQL SERVER, not the database" note
- `apps/web/src/lib/upload-tracker-state.ts:7` / `restore-maintenance.ts:1` — `Symbol.for('gallerykit.*')` globalThis-pinned singletons (no runtime instance guard exists; grep for INSTANCE_ID/leader-election returns nothing)
- `apps/web/scripts/migrate.js:247-613` — `reconcileLegacySchema` hand-maintained full-schema mirror (~366 LOC)
- `apps/web/scripts/migrate.js:710-718` — loud post-condition assertion (the robust part)
- `apps/web/scripts/migrate.js:662-680` — fresh-DB-through-reconcile bootstrap (sound)
- `apps/web/src/app/actions/images.ts:108-542` — `uploadImages` (~435 LOC) inside a 1157-LOC god-action
- `apps/web/src/app/api/admin/lr/upload/route.ts` — "mirrors uploadImages exactly" (duplication, A5)
- `apps/web/src/app/actions/images.ts:29` + `lib/color-detection.ts:48` — client-safe symbol imported via server-only re-export (A6)
- `apps/web/src/lib/data.ts:208-450` — `adminSelectFields` + destructure-derived public/map/list shapes + three compile-time guards (POSITIVE)
- `apps/web/src/lib/gallery-config-shared.ts` → `gallery-config.ts:222` → `image-queue.ts:320,437` — clean config stratification (POSITIVE)
- `apps/web/src/lib/color-detection.ts:291` — `detectColorSignals` single entry point (POSITIVE)
- `apps/web/src/proxy.ts:81-130` — i18n + CSP + shallow cookie pre-filter; real auth in actions (POSITIVE)
- `apps/web/src/lib/hdr-filenames.ts:1-15` — reserved dead code in `src/` (A7)
