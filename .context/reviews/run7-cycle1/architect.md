# Architect Review — Run-7 Cycle-1 (HEAD `17f743f7`)

**Date:** 2026-06-18
**Scope:** system architecture at the documented single-writer scale
**Verdict:** SOUND. Zero new architectural defects. Honest convergence holds.

## Summary

Traced every concern the task listed — single-writer process-local states,
data.ts PII guard, the un-wired storage abstraction, the config resolution
chain, the CLIP offline-load path, the color pipeline precedence, the
migration hash post-conditions, and advisory-lock namespace scoping. Every
invariant holds at the documented scale. `tsc --noEmit -p tsconfig.typecheck.json`
was already exit-0 at cycle-11 (no code changed since), so both compile-time
privacy guards are satisfied. No fail-open where fail-closed is required;
no leaked advisory-lock connection; no PII leak; no contract mismatch
between layers that produces wrong behavior at the documented scale.

The only code change since cycle-11 (commit `2fc9a23f`) is the AGG-C11-01
test-only fix (new `semantic-similarity-selector-contract.test.ts`). Every
other commit in `a7de3ebd..HEAD` is documentation. No architectural change.

## What I verified

### 1. Single-writer process-local states — documentation is ACCURATE

Three coordination states are process-local; each is correctly fenced for
correctness by a MySQL advisory lock (cross-process safe), and only its
STATUS SURFACE is per-process:

- **Backfill runner status** (`admin-backfill-runner.ts:144,220-225,286-300`):
  the `running` / `processed` / `errors` / `skippedLocked` /
  `encodeFailures` / `detectionFailures` / `deletedMidReencode` counters
  live in a `globalThis`-backed symbol (`Symbol.for('gallerykit.adminBackfillState')`).
  The CORRECTNESS fence is the `gallerykit_color_pipeline_backfill` advisory
  lock (`admin-backfill-runner.ts:303-322`), acquired NON-BLOCKING
  (`GET_LOCK(?, 0)`) so a second invocation — whether in-process or
  cross-process — gets `{ status: 'already_running' }` instead of racing.
  The per-image claim (`gallerykit:image-processing:{id}`, :343-368)
  likewise serializes against the live queue worker. Under unsupported
  scale-out (two web instances), the two instances would serialize each
  other's backfills correctly via the shared lock, but the admin status
  UI would show the counter only for whichever instance served the
  request — accurately documented in CLAUDE.md AGG-D5/ARCH-07.

- **Rate-limit buckets** (`rate-limit.ts:115`, `auth-rate-limit.ts:96`):
  in-memory `Map`s as fast-path. Login bucket has a DB backup
  (auth-rate-limit.ts); the OG / checkout / share / search / semantic
  buckets are process-local. Under scale-out an attacker rotating across
  N IPs still gets N× the per-IP budget, but the per-account login bucket
  is DB-backed. Accurately documented.

- **Shared-group view-count buffer** (`data.ts:12-75`): module-level
  `let viewCountBuffer = new Map<number, number>()` with bounded-growth
  guards (`MAX_VIEW_COUNT_BUFFER_SIZE` cap at :47, `viewCountRetryCount`
  cap at :23-26), debounced flush, and explicit SIGTERM-graceful-flush
  / SIGKILL-loss caveat at :16. Best-effort-by-design — accurately
  documented in CLAUDE.md. Under scale-out, each instance buffers its
  own increments and flushes independently; no double-counting (each
  increment is local), but a per-instance crash loses that instance's
  buffer.

**Documentation accuracy:** the CLAUDE.md "Runtime topology" section
correctly enumerates ALL three process-local states and the
advisory-lock-backs-correctness / status-is-per-process split. No drift.

### 2. data.ts PII guard architecture — TRIPLE guard, live

- `publicSelectFields` (`data.ts:355`) and `publicMapSelectFields`
  (`data.ts:391`) are DERIVED from `adminSelectFields` (`:208`) by
  destructuring-OMIT, as separate `as const` objects. Adding a field to
  `adminSelectFields` does NOT auto-leak it.
- `PrivacySensitiveKeys` (`:416`) is the single source-of-truth union
  (20 sensitive keys). Both `_SensitiveKeysInPublic` (`:418-419`) and
  `_MapSensitiveKeysInPublicMap` (`:429-431`) derive from it via
  `Extract`/`Exclude` → a new sensitive key auto-extends both guards.
- A third guard `_LargePayloadKeysInPublic` (`:448-449`) prevents
  expensive fields from leaking into listing queries.
- `tsc --noEmit -p tsconfig.typecheck.json` exit-0 (no code change since
  cycle-11) → no sensitive key is present in either public select shape.
  Guard is live and passing.

### 3. Storage abstraction — HONEST dead code, no misleading surface

`apps/web/src/lib/storage/` (index.ts 4.7k + local.ts 5.2k + types.ts 3.2k)
is NOT wired. Verified:
- The ONLY importer of `@/lib/storage` outside the module itself is its
  own unit test `__tests__/storage-local.test.ts`.
- ZERO production callers of `getStorage`, `getStorageSync`,
  `switchStorageBackend`, `getStorageBackendStatus`,
  `getStorageBackendType`.
- ZERO test coverage of `switchStorageBackend` / `getStorageBackendStatus`.

The module is HONEST about this — the header comment in `index.ts:1-18`
states four times that the production paths use direct fs code and do not
read from this module. CLAUDE.md "Storage Backend" row mirrors this.
No misleading surface; no abstraction leak into live code.

**Architectural observation (NON-FINDING, defers to a future wiring task):**
`switchStorageBackend` (`index.ts:85-128`) carries a global-state-swap
hazard by design (it mutates the `Symbol.for('gallerykit.storageBackend')`
global). This is acceptable BECAUSE the module is unwired — there is no
caller to race the swap. If/when the abstraction is wired end-to-end,
that swap function would need re-evaluation against concurrent request
traffic. Not a current defect; noted for the future wiring task only.

### 4. Config resolution chain — single chokepoint, fail-closed

`gallery-config-shared.ts` (validation, `:173` accepts `disabled|stub|production`)
→ `gallery-config.ts` (resolution, `:129-148` HEALS `production`→`disabled`
without `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`) → `image-queue.ts:434-478`
(consumption, mode-gated, default `disabled`).

- The DB-read failure path (`gallery-config.ts:189-219`) returns an
  all-defaults object → `semanticSearchMode: 'disabled'`. Fail-closed.
- Every consumer (semantic route, similar route, embeddings action,
  image queue) re-reads the resolved value via `getGalleryConfig()`
  and defaults to `disabled` on its own try/catch. No consumer reads
  the raw DB string directly.
- The double-gate (env + DB row) is enforced at the SINGLE resolution
  chokepoint. No divergence between layers.

### 5. CLIP offline-load path — seed/runtime round-trip UNIFIED

`clip-paths.ts` is the SINGLE source of truth for the cache-root
resolution. Both the downloader (`scripts/download-clip-models.ts`) and
the runtime loader (`lib/clip-model.ts:62,86`) call `resolveClipModelsRoot()`,
which honors an ABSOLUTE `CLIP_MODELS_ROOT` verbatim and resolves a
relative one against cwd (`:60-66`). This closes the historical doubled-
`/app/apps/web/app/...` path bug. The revision-subdir layout
(`clipModelArtifactDir`, `:77-98`) is guarded against a future model
upgrade that would silently mis-path the cache (2-segment-id and
40-hex-SHA assertions). The seed→offline-load contract round-trips
natively with no manual symlinks.

### 6. Color pipeline precedence — sound, matches CLAUDE.md matrix

`detectColorSignals` (`color-detection.ts:293`) resolves in priority
order: NCLX `colr` box (`:372-388`, highest precedence) → ICC
chromaticity (`detectGamutFromIccChromaticity`) → ICC name allowlist.
The encoder decision matrix in `process-image.ts` (the
`resolveColorPipelineDecision` table at `:649-656`) and the DB columns
(`color_primaries`, `transfer_function`, `matrix_coefficients`,
`color_pipeline_decision`) all flow from this single detection pass.
No divergence between detection, decision, and persistence.

### 7. Migration hash post-conditions — SOUND

`migrate.js:702-723` (`runMigrations`) post-conditions: after drizzle's
`migrate()` runs, it re-reads `__drizzle_migrations` hashes and asserts
every journal entry's hash is present. Missing → `throw new Error(...)`
with the specific tags → deploy fails loud. This catches the documented
non-monotonic-journal silent-skip failure mode.

`prepareLegacyDatabaseIfNeeded` (`:663-700`) handles both the fresh-DB
case (bootstrap via `reconcileLegacySchema` + `baselineAllJournalMigrations`,
`:681-682`) and the legacy-poisoned-cursor case (`:698-699`). The
baseline strategy (`:646-661`) inserts one row per journal entry keyed
by the entry's `folderMillis` (not a synthetic max), so drizzle's
`MAX(created_at)` cursor lands correctly and future strictly-greater
`when` values apply normally. Sound.

### 8. Advisory-lock namespace — server-level, MULTI-TENANT RISK DOCUMENTED

All 6 advisory locks use bare `gallerykit_*` names scoped to the MySQL
SERVER (not the database), confirmed at:
- `advisory-locks.ts:19,22,25,34,44` (5 named constants)
- `image-queue.ts:199,218` (`gallerykit:image-processing:{jobId}`)
- `admin-backfill-runner.ts:310,327,347,364` (backfill + per-image claim)

Two GalleryKit instances on the same MySQL server would serialize each
other's restores, upload-contract changes, topic renames, admin deletes,
backfills, and image-processing claims across tenants. CLAUDE.md
"Advisory-lock scope note" (C8R-RPL-06 / AGG8R-05) documents this
verbatim and prescribes "one GalleryKit per MySQL server." Accurately
documented; no silent cross-tenant collision possible if the documented
deployment constraint is honored.

## Module dependency direction — clean, no circular deps

- `process-image.ts` imports only from leaf/shared modules
  (`upload-paths`, `gallery-config-shared`, `exif-datetime`,
  `upload-limits`, `blur-data-url`, `color-detection`, `icc-extractor`,
  `validation`, `color-pipeline-decisions`). It does NOT import from
  `data.ts` or `db/` — correct layering (encoder is below the data
  access layer).
- `color-detection.ts` imports only `sharp` (type), `fs/promises`, and
  sibling leaf modules (`icc-extractor`, `gain-map-detection`,
  `icc-chromaticity`). No upward dependency.
- `image-queue.ts` (the orchestrator) imports from `gallery-config`,
  `process-image`, `clip-*`, `advisory-locks`, etc. — correct downward
  direction.
- `gallery-config.ts` → `gallery-config-shared.ts` (validation below
  resolution). `settings-hash.ts` → `gallery-config` (consumer below
  resolver). No cycles.

## settings-hash cache — process-local, multi-process caveat documented

`settings-hash.ts:56` (`CACHE_TTL_MS = 5_000`) module-scoped cache with
inflight de-dup (`:135-146`). The no-arg form is process-local; the
config-arg form (`:127-129`) bypasses the cache entirely for
request-flood paths. Lines `:114-117` explicitly document the
multi-process skew window ("acceptable because every browser will
revalidate within the next 5 s window"). Honest for single-writer; the
caveat is recorded for any future scale-out.

## Carried-forward prose-only note (NON-FINDING, cycle-11 A1, unchanged)

`image-queue.ts:431-433` comment: "The `model_version` column on
image_embeddings already distinguishes stub rows, so no schema migration
is needed for that future encoder to tell stub vectors apart from
production ones." The table is `PRIMARY KEY (image_id)` (one row per
image); the upsert (`:462-473`) OVERWRITES `(embedding, modelVersion)`.
The comment reads as if stub + production rows coexist per image; they
do not. Behavior is CORRECT (overwrite-then-filter, locked by
`backfill-clip-embeddings-reembed` test). Optional prose reword only;
no code change. Unchanged from cycle-11; not re-raised as a finding.

## Known-deferred items (NOT re-opened)

- DEF-C11-01 (designer, LOW): search `<Input>` `h-8` (32 px). Carried
  forward. Not an architectural concern.
- AGG-C11-01 (test-engineer, LOW): semantic-route similarity-selector
  source-contract pin. **CLOSED at `2fc9a23f`** — the new
  `semantic-similarity-selector-contract.test.ts` exists and pins the
  `isProd ? dotProduct : cosineSimilarity` ternary. Verified in the
  `a7de3ebd..HEAD` diff.
- DEF-C8-1/2/3 (CLIP main-thread inference, load-time integrity
  verification, reload-storm hardening): remain correctly deferred within
  documented bounded mitigations.

## References

- `apps/web/src/lib/admin-backfill-runner.ts:144,220-225,286-300,303-322,343-368` — process-local status + cross-process correctness fence
- `apps/web/src/lib/rate-limit.ts:115` / `auth-rate-limit.ts:96` — process-local rate-limit buckets
- `apps/web/src/lib/data.ts:12-75,208,355,391,416,418-419,429-431,448-449` — view buffer + PII triple guard
- `apps/web/src/lib/storage/index.ts:1-18,85-128` — honest unwired abstraction
- `apps/web/src/lib/gallery-config.ts:129-148,189-219` — single-chokepoint heal + fail-closed
- `apps/web/src/lib/image-queue.ts:431-433,434-478` — consumption mode-gate + carried prose note
- `apps/web/src/lib/clip-paths.ts:60-66,77-98` — unified seed/runtime path resolution
- `apps/web/src/lib/color-detection.ts:293,372-388` — NCLX → ICC chromaticity → ICC name precedence
- `apps/web/scripts/migrate.js:646-661,663-700,702-723` — baseline + reconcile + hash post-condition
- `apps/web/src/lib/advisory-locks.ts:19,22,25,34,44` — server-scoped lock names
- `apps/web/src/lib/settings-hash.ts:56,114-117,124-147` — process-local cache + documented skew
