# Cycle 9 Tracer Lane Review

Role: `tracer`
Scope: read-only causal tracing of suspicious end-to-end flows and competing hypotheses.
Allowed write: this report file only.
Application code changes: none.
Commits/pushes: none.
Validation evidence: traced code and docs; ran `npm run lint:api-auth --workspace=apps/web`, `npm run lint:action-origin --workspace=apps/web`, and `npm run lint:public-route-rate-limit --workspace=apps/web` successfully.

## Inventory

- Required docs read first: `AGENTS.md`, `CLAUDE.md`.
- Repo inventory: 3392 tracked files. Review-relevant tree sweep covered `apps/web/src/app`, `apps/web/src/lib`, `apps/web/src/components`, `apps/web/src/__tests__`, `apps/web/e2e`, `apps/web/drizzle`, `apps/web/scripts`, `.context`, and `docs`.
- Upload -> process -> serve: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, upload route handlers, `next.config.ts`, and upload/process/serve tests.
- Auth -> route/action: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/proxy.ts`, admin API routes, mutating server actions, and origin/auth lint source contracts.
- Settings -> cache/bytes: `apps/web/src/app/actions/settings.ts`, `apps/web/src/lib/gallery-config*.ts`, `apps/web/src/lib/settings-hash.ts`, `apps/web/src/lib/settings-backfill-warning.ts`, color/backfill runners, `serve-upload.ts`, `next.config.ts`, and related source/tests.
- Restore -> fences: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance*.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/image-queue.ts`, advisory-lock docs/tests, and migration/restore tests.
- Semantic search -> embeddings: semantic/similar API routes, `apps/web/src/lib/clip-*.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, schema/migrations, CLIP docs, README, and semantic tests.
- Share view -> analytics/counters: public share pages, `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/public.ts`, analytics schema/data, view-retention scheduler, and share/analytics tests.
- Migrations -> runtime schema: `apps/web/scripts/migrate.js`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, schema snapshots, migration tests, and deploy/startup docs.
- Final sweep: searched suspicious patterns including `TODO`, `FIXME`, `HACK`, action exemptions, public route rate-limit exemptions, `dangerouslySetInnerHTML`, spawned shell commands, raw SQL, and embedding/schema references.

## Findings

### TRC9-01: `image_embeddings` is keyed by `image_id` only, but semantic search/backfills assume versioned rows

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Location: `apps/web/src/db/schema.ts:286-300`, `apps/web/drizzle/0012_image_embeddings.sql:5-11`, `apps/web/scripts/migrate.js:684-697`, `apps/web/src/lib/image-queue.ts:512-523`, `apps/web/scripts/backfill-clip-embeddings.ts:161-223`, `apps/web/src/app/actions/embeddings.ts:104-178`, `apps/web/src/app/api/search/semantic/route.ts:263-289`, `apps/web/src/app/api/search/similar/[id]/route.ts:137-190`, `apps/web/README.md:70-82`, `CLAUDE.md:160`

Competing hypotheses:
- Safe: each image can retain separate stub and production embeddings, and the active route/backfill simply reads or upserts the row matching `(image_id, model_version)`.
- Unsafe: the table has only one row per image, so any writer for a different `model_version` overwrites the previous model's embedding and tag.

Evidence:
- Current Drizzle schema makes `image_id` the primary key (`apps/web/src/db/schema.ts:286-287`), and migration 0012 creates `PRIMARY KEY (image_id)` (`apps/web/drizzle/0012_image_embeddings.sql:5-11`). The legacy reconcile path mirrors the same single-column primary key (`apps/web/scripts/migrate.js:684-692`).
- The docs and runbook explicitly claim one row per `(image_id, model_version)` and repeat that retries upsert that pair (`apps/web/README.md:72`, `apps/web/README.md:82`, `CLAUDE.md:160`).
- Runtime writers all use `onDuplicateKeyUpdate` that updates both `embedding` and `modelVersion` on the duplicate key (`apps/web/src/lib/image-queue.ts:512-523`, `apps/web/scripts/backfill-clip-embeddings.ts:212-223`, `apps/web/src/app/actions/embeddings.ts:163-178`). Because the duplicate key is only `image_id`, a stub write replaces a production row, and a production write replaces a stub row.
- Candidate selection looks for absence of the target version (`apps/web/scripts/backfill-clip-embeddings.ts:161-180`, `apps/web/src/app/actions/embeddings.ts:127-145`), which is correct only if multiple versions can coexist. With the current primary key, the selected "missing target version" row will collide on `image_id` and retag the only row.
- Serving paths filter by active/production model version (`apps/web/src/app/api/search/semantic/route.ts:270-289`, `apps/web/src/app/api/search/similar/[id]/route.ts:140-190`). After retagging, they intentionally ignore the overwritten model's row.

Failure scenario:
An operator has production CLIP active with `jina-clip-v2-d512-q8` rows. Later, an admin temporarily switches semantic mode to `stub` for a smoke/demo path or the unwired admin backfill action is surfaced and run in stub mode. Existing production rows do not satisfy "has a stub row", so the bootstrap/backfill path selects them, inserts with `modelVersion = STUB_MODEL_VERSION`, collides on `PRIMARY KEY(image_id)`, and updates the only row to stub. When production mode is restored, `/api/search/semantic` filters for `PRODUCTION_MODEL_VERSION`, finds no rows, and returns `503 semantic_no_embeddings`; `/api/search/similar/[id]` returns `404 No embedding found for this image` for affected photos. The reverse direction also clobbers stub rows when a production backfill runs, so mode changes thrash the table instead of preserving version-isolated embeddings.

Suggested fix:
Migrate `image_embeddings` to a schema that matches the documented contract: either a composite primary/unique key on `(image_id, model_version)` or a surrogate `id` plus `UNIQUE(image_id, model_version)`. Update the Drizzle schema and `reconcileLegacySchema` mirror, add a migration that preserves existing rows under their current `model_version`, and keep the existing upsert target semantics. Add a behavior test that starts with a production row, runs a stub writer for the same image, and asserts both rows remain queryable; repeat in the opposite direction. If the intended product contract is actually one active embedding per image, change the docs/tests and make mode toggles/backfills explicitly destructive or isolated before they can silently de-activate production search.

## Flow Traces Without New Findings

- Upload -> process -> serve: both browser and Lightroom upload paths check maintenance, same-origin/token auth, upload quota, private original storage, metadata/privacy validation, DB insert, queue enqueue, and cleanup on late restore/delete races (`apps/web/src/app/actions/images.ts:129-635`, `apps/web/src/app/api/admin/lr/upload/route.ts:94-609`). Queue processing uses per-image locks, settings snapshots/fallbacks, atomic derivative writes, processed-row verification, and cleanup for deleted-mid-process races (`apps/web/src/lib/image-queue.ts:691-980`, `apps/web/src/lib/process-image.ts:1049-1485`). Serving confines requests to derivative directories, rejects traversal/symlinks, builds ETags from pipeline/mtime/size/settings hash, and streams from an opened fd after re-stat (`apps/web/src/lib/serve-upload.ts:168-369`).
- Auth -> route/action: admin APIs are wrapped by `withAdminAuth`, token scopes are checked before route work, cookie auth requires trusted same-origin, and mutating server actions are same-origin guarded. The three auth/origin/rate-limit guard scripts passed in this review. Prior cycle auth-barrier and CSV-separator issues are fixed in this checkout (`apps/web/src/app/actions/auth.ts:309-312`, `apps/web/src/app/[locale]/admin/db-actions.ts:116`).
- Settings -> cache/bytes: derivative-byte-impacting keys are centralized in `DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS` and re-exported for the settings hash (`apps/web/src/lib/gallery-config-shared.ts:72-85`, `apps/web/src/lib/settings-hash.ts:47-92`). `updateGallerySettings` fences upload-contract keys, warns on byte-impacting setting changes when processed images exist, revalidates app data, and invalidates detached config cache (`apps/web/src/app/actions/settings.ts:88-234`). The static-derivative cache gotcha is documented as requiring re-encode, not treated as a code bug (`CLAUDE.md:317-348`).
- Restore -> fences: restore acquires restore/upload/color-backfill/semantic-backfill locks, writes durable maintenance, flushes shared view counts, quiesces the image queue, drains background DB writes and foreground admin mutations, then runs the import and releases/resumes according to success/failure state (`apps/web/src/app/[locale]/admin/db-actions.ts:405-620`). Startup syncs the durable marker before bootstrapping queue work (`apps/web/src/instrumentation.ts:1-22`).
- Semantic search -> embeddings: request gates and route honesty mostly hold: same-origin, content-type/body limits, abort checks, rate limiting, production env/config gate, model-version filters, corrupt embedding drops, and score stripping are present. The storage-key mismatch above is the causal break in the otherwise model-version-isolated flow.
- Share view -> analytics/counters: shared group page rate-limits key lookup, disables link prefetch budget drain, increments denormalized group count only on initial group view, and writes durable analytics rows through public rate-limited fire-and-forget actions (`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:32-132`, `apps/web/src/lib/data.ts:1322-1411`, `apps/web/src/app/actions/public.ts:333-533`). Approximate buffered `view_count` semantics are documented (`CLAUDE.md:240`).
- Migrations -> runtime schema: migration startup has fresh/legacy reconcile, per-entry baselining, above-cursor and DML guards, and post-condition hash verification. The semantic finding is a schema-contract mismatch, not a migration cursor/hash failure.

## Final Sweep

The final sweep covered commonly missed areas: public route exemptions, server-action origin exemptions, admin API auth wrappers, restore races, fire-and-forget analytics writes, static-vs-route derivative caching, raw SQL/separator patterns, `dangerouslySetInnerHTML` call sites, spawned restore/dump commands, migration reconcile coverage, and source tests around semantic model-version filtering. No additional high-confidence causal failures surfaced. The main residual risk is that several semantic tests assert the presence of a `modelVersion` filter/upsert path but do not exercise the physical primary-key behavior that makes the version isolation contract false.
