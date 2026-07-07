# architect review — cycle 6

## Summary (2-4 lines)
The structural core is exceptionally hardened: config resolution, the client→server-only boundary,
advisory-lock naming, the single-writer guard, the migration drift machinery, and the smart-collection
compiler are all backed by explicit guards + tests. The genuinely NEW architecture risks are all
DUPLICATED-SOURCE-OF-TRUTH / INDEPENDENT-BUDGET seams: a second hand-maintained copy of the
byte-impacting settings list in the ETag hash path (no guard), and two background pool-budget
resolvers that each reserve the SAME connections without accounting for the other. Two lower-severity
structural observations round it out (migration boot has no cross-process lock; process-local-state
pattern is inconsistent).

## Findings

### F1 — `buildHashFromConfig` is a second, unguarded copy of the byte-impacting settings list  [SEV: MED | CONF: High | src/lib/settings-hash.ts:82-95]

**Problem.** The serve-upload ETag depends on `getColorSettingsHash(config)`, whose config-arg path
(`buildHashFromConfig`, lines 82-95) hand-maintains an object literal of exactly 9 key→value
mappings. That literal is decoupled from the authoritative `COLOR_IMPACTING_KEYS`
(= `DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS`, aliased at line 47). The no-arg DB path
(`fetchHashFromDb` → `buildHash`, lines 97-116, 72-75) instead *iterates* `COLOR_IMPACTING_KEYS`, so
it auto-covers any new key. The two are only kept equal by hand.

The existing guards do NOT close this: the compile-time `_ColorKeysAreSettingKeys` guard (line 56)
only checks each key is a valid setting key, not that `buildHashFromConfig` maps it; the
exhaustiveness test (`settings-hash.test.ts:19-38`) pins `COLOR_IMPACTING_KEYS` membership (forces
you to *notice* a new key) but the equality test `R8-H1` (`settings-hash.test.ts:130-160`) passes the
hypothetical new key EMPTY on both the raw side and the config side, so it stays green even when
`buildHashFromConfig` forgets the key.

**Failure scenario.** A future cycle adds a 10th byte-impacting setting (the codebase adds
color/quality settings almost every cycle — `sdr_jpeg_chroma`, `avif_effort`, `image_quality_*`,
`wide_gamut_max_source_pixels` are all recent). The author wires it through
`GALLERY_SETTING_KEYS`/`DEFAULTS`/`GalleryConfig`/`buildGalleryConfig`/
`DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS` (the exhaustiveness test forces the last one). The no-arg DB
hash now includes it; `buildHashFromConfig` does not. Because serve-upload's hot path uses the
config-arg form (`getServingColorSettingsHash` → `getColorSettingsHash(config)`,
`serve-upload.ts:73-106,265`), the serve-upload ETag becomes INVARIANT to the new setting: flipping it
no longer forces the `must-revalidate` 304→200 cycle — the exact silent-stale-derivative failure the
whole settings-hash mechanism exists to prevent, silently reintroduced for the new key. As a
secondary symptom, whenever the new key holds a non-default value the two paths now DISAGREE, so any
brief serve-upload fallback to the no-arg form flips the ETag spuriously (304→200 churn).

**Fix.** Make one authoritative mapping. Replace the object literal with a
`Record<GallerySettingKey-subset, (c: GalleryConfig) => string>` keyed exhaustively over
`COLOR_IMPACTING_KEYS` so `tsc` requires a mapper for every key; OR add a test that, for each
`COLOR_IMPACTING_KEYS` entry, asserts flipping the corresponding `GalleryConfig` field changes
`getColorSettingsHash(config)`. Also add `buildHashFromConfig` to the CLAUDE.md "Adding a new
color-impacting setting" checklist (it currently names only `COLOR_IMPACTING_KEYS`).

### F2 — Image-queue and backfill pool-budget resolvers each reserve the SAME connections, ignoring the other  [SEV: MED | CONF: High | src/lib/admin-backfill-runner.ts:105-142 + src/lib/image-queue.ts:120-133 (HEAD) + src/db/index.ts:31]

**Problem.** Two independent background workloads size themselves against the shared 10-connection
pool with identical-but-uncoordinated arithmetic:

- `IMAGE_QUEUE_RESERVED_LIVE_CONNECTIONS(pool) = max(3, ceil(pool/2))` → 5 at pool 10;
  `resolveImageQueueConcurrency` cap = `floor((10−5)/2) = 2` (verified against committed HEAD).
- `BACKFILL_RESERVED_LIVE_CONNECTIONS(pool) = max(3, ceil(pool/2))` → 5 at pool 10;
  `resolveBackfillConcurrency` cap = `floor((10−5−1)/2) = 2`.

Each formula reserves 5 connections "for live traffic" and each caps at 2 workers — but neither
subtracts the OTHER background consumer. They run under DIFFERENT locks (per-image processing claim
`gallerykit:image-processing:{jobId}` vs the global `gallerykit_color_pipeline_backfill`), so an
admin-triggered re-encode and active upload-queue processing can run SIMULTANEOUSLY.

**Failure scenario.** Admin clicks "Re-encode existing photos" while uploads are still processing.
Backfill pins 1 (lock) + 2 workers × 2 conns = 5; the image queue pins up to 2 workers × 2 conns = 4.
Total 9 of 10. The "5 reserved for live traffic" that BOTH formulas believe they preserved is in
reality 1 free connection. Concurrent live `getImage()` fan-outs (~3-4 connections each, the exact
workload the reserve was sized for per `admin-backfill-runner.ts:98-104`) queue behind
encode-duration holds against `queueLimit=20`, adding latency/near-timeout to public photo/gallery
renders for the whole maintenance window. The design gives false confidence because each formula
independently "proves" a 5-connection live reserve that simultaneous operation erases.

**Relation to prior work.** Extends the known TRC-07 budget note (CLAUDE.md "Connection pool"), but
with NEW specific evidence: TRC-07 enumerates only the topic-route mutation (+1) and in-flight restore
(+2) as extra pinners and states each formula "models only their own claim connections vs live
requests" — it does NOT surface the queue↔backfill mutual over-subscription, which is the LARGEST
overlap (each pins ~4-5, not 1-2).

**Fix.** Give both workloads a single shared background-connection budget (a semaphore both draw from),
or make full-concurrency backfill and full-concurrency upload-processing mutually exclusive, or have
each resolver subtract the peer's max consumption from `limit` before computing its cap. At minimum,
extend the TRC-07 note to enumerate the simultaneous case.

### F3 — Schema migration runs at container boot with no cross-process advisory lock  [SEV: LOW | CONF: Med | scripts/migrate.js:999-1030; Dockerfile CMD (HEAD) line 197; scripts/init-db.ts:26]

**Problem.** `main()` acquires NO advisory lock (grep: 0 `GET_LOCK` occurrences in migrate.js).
`reconcileLegacySchema` issues a long sequence of non-transactional, check-then-DDL statements
(`ensureColumn`/`ensureIndex`/`ensureForeignKey` each do `INFORMATION_SCHEMA` probe → DDL), then
`drizzle.migrate()` applies the pending tail. The runtime single-writer guard cannot help here — it
arms only after `server.js` starts, AFTER migrate.js has already run (Dockerfile CMD:
`node migrate.js && exec node server.js`). `npm run init` (`init-db.ts:26`) shells the SAME
`node scripts/migrate.js`.

**Failure scenario.** Two migrate processes interleave — an operator runs `npm run init` while the
container is booting, a deploy is (mis)configured to overlap old+new containers, or CI/e2e runs
migrate in parallel against a shared DB. Both pass a given `foreignKeyExists`/`indexExists` check as
false, both attempt the `ADD CONSTRAINT`/`CREATE INDEX`, the loser throws `ER_DUP_KEYNAME` /
`ER_FK_DUP_NAME` and fails that deploy; or a half-applied reconcile is observed by the other run
mid-sequence.

**Scope / why LOW.** The shipped single-web-instance topology plus compose's default
stop-old-then-start-new recreate makes overlap unlikely, so this is theoretical today. But the
single-writer guard's own rationale ("detect a second instance sharing this DB") applies verbatim to
the migration path, which has no equivalent protection.

**Fix.** Wrap the migration work in a dedicated advisory lock (e.g. `gallerykit_schema_migration`) on
the migrate connection; a second concurrent migrate then serializes, and on acquiring the lock finds
`journalCovered === true` and no-ops. Add the name to `advisory-locks.ts` for auditability.

### F4 — Two divergent patterns for process-local singleton state, no stated rule  [SEV: LOW | CONF: High (existence) / Low (prod impact) | multiple files]

**Problem.** Process-lifetime coordination state is held two ways with no documented rule for which to
use:
- `globalThis[Symbol.for('gallerykit.*')]` registries (survive module re-evaluation): `restore-maintenance.ts:1`,
  `image-queue.ts:99`, `upload-tracker-state.ts:7`, `storage/index.ts:23`, `admin-backfill-runner.ts:144`,
  `admin-mutation-barrier.ts:41`, `db/index.ts:66`.
- Plain module-scoped `let cache` (do NOT survive module re-evaluation): `gallery-config.ts:216-217`
  (detached config micro-cache), `settings-hash.ts:69-70`, `serve-upload.ts:70-71`.

If any of the plain-module-cache modules is evaluated twice (dev HMR; or the same module landing in two
Next chunk graphs), the cache silently duplicates into two independent 5 s TTL instances with two
invalidation targets — and `invalidateDetachedGalleryConfigCache()` (gallery-config.ts:247) resets only
one instance's `let`-scoped vars. In production standalone each module instantiates once, so this is
primarily a maintainability/consistency risk plus a latent dev-HMR staleness where a settings flip
fails to invalidate a duplicated cache.

**Fix.** Adopt and document one rule: process-lifetime coordination state uses the
`globalThis[Symbol.for]` registry (re-eval-durable); either migrate the config/settings-hash/serve-upload
caches to it, or annotate at each site why plain module scope is acceptable (request-path-only,
TTL-bounded, invalidation-tolerant).

### F5 — `process-image.ts` is a 1829-line hub mixing decode/encode, metadata, and filesystem ops  [SEV: INFO/LOW | CONF: High | src/lib/process-image.ts]

**Problem.** One module exports EXIF extraction (`extractExifForDb`, `saveOriginalAndGetMetadata`),
GPS stripping (`stripGpsFromOriginal`), color-pipeline decisions (`resolveColorPipelineDecision`,
`resolveAvifIccProfile`), AVIF NCLX + WebP ICC byte verification, variant deletion
(`deleteImageVariants*`), and the encode pipeline (`processImageFormats`). It is the shared hub for
`image-queue`, `admin-backfill-runner`, and `process-topic-image`. Any consumer that needs even one
helper drags in the sharp/libvips + color-detection import graph — the cost is real enough that
`serve-upload.ts:6-11` deliberately imports `IMAGE_PIPELINE_VERSION` from `gallery-config-shared`
specifically to avoid importing this module.

**Fix (assess-only this cycle, per briefing — known god-object class).** Peel cohesive sub-modules
(exif-extraction, avif/webp verification, variant fs-ops) behind narrow re-exports; keep the encode
pipeline in `process-image`. No edit proposed this cycle.

## Files examined (inventory)

- Config resolution: `src/lib/gallery-config.ts`, `src/lib/gallery-config-shared.ts`,
  `src/lib/settings-hash.ts` (+ `__tests__/settings-hash.test.ts`).
- Migration machinery: `scripts/migrate.js`, `scripts/init-db.ts`, `Dockerfile` (HEAD), schema FK
  cross-check `src/db/schema.ts` (peer-dirty — verified at HEAD), `src/app/actions/admin-users.ts`
  (audit_log detach path).
- Process-local / scale-out coordination: `src/lib/advisory-locks.ts`,
  `src/lib/admin-mutation-barrier.ts`, `src/lib/single-writer-guard.ts`,
  `src/lib/admin-backfill-runner.ts` (budget arithmetic), `src/lib/image-queue.ts` (HEAD, budget
  arithmetic), `src/db/index.ts`, plus a sweep of the 8 `globalThis Symbol.for` registries.
- Serving / abstraction leaks: `src/lib/serve-upload.ts`, `src/lib/storage/{index,local,types}.ts`
  (quarantine + test), `src/__tests__/storage-quarantine.test.ts`.
- Module boundary: `src/__tests__/client-server-only-boundary.test.ts`, grep of `'use client'` →
  server-only imports, `server-only` package usage.
- Query-layer design: `src/lib/smart-collections.ts` (predicate→SQL compiler).
- Lifecycle ownership: `src/instrumentation.ts` (HEAD), `src/lib/maintenance-scheduler.ts` (HEAD),
  `src/lib/process-image.ts` public surface.
- Prior context: `.context/plans/deferred-carry-forward.md`, `.context/reviews/_aggregate.md`.

## Final sweep (commonly-missed) notes

- **Client/server boundary:** clean. The only client-side imports of server modules
  (`home-client.tsx`, `load-more.tsx` → `@/lib/data`) are `import type` (erased); the AST-based
  boundary test enforces this and is non-vacuous (mysql2/sharp/argon2/next-server driver detection).
- **audit_log FK:** the reconcile creates `audit_log_user_id_admin_users_id_fk` with no `ON DELETE`
  clause (RESTRICT), but `admin-users.ts:277` NULLs `audit_log.user_id` before deleting the admin, so
  the delete does not block. Not a finding.
- **smart-collections:** compiler is allowlisted-column + fully parameterized + depth-limited + pure;
  `query_json` is admin-INSERT-only. No injection/coupling issue. Exemplary.
- **Known/deferred, not re-reported as new:** AGG-C10-06 (embedding text-vs-blob, schema.ts
  peer-dirty), AGG-C10-07 (reconcile is a 2nd schema authority — F3 is a DISTINCT concern:
  concurrency, not parity), AGG-C10-12 (maintenance scheduler has no shutdown stop — confirmed still
  true at HEAD: instrumentation shutdown drains queue/view-counts/bg-writes/single-writer but not the
  scheduler; peer-dirty), AGG-C10-13 (view-count buffer in data.ts, peer-dirty), AGG-C10-14 (nginx
  drift), C2-27/C2-50 (storage quarantine), C80-06/C2-24b (site-config build-time inlining). C4-17
  (extract `startMaintenanceScheduler` to instrumentation) is DONE at HEAD.
