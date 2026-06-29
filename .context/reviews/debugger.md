# Cycle 18 Debugger Review

Review lane: `debugger`
Date: 2026-06-30 KST
Mode: read-only debugger review. No product code was changed. No commit or push was made.

## Inventory

Read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Repository inventory performed before findings:

- Tracked/source inventory with `rg --files`: app source, migrations, tests, scripts, config, docs, and plans.
- 499 TypeScript/TSX files under `apps/web/src` inventoried.
- Relevant app routes/actions reviewed: public pages, admin pages, server actions, admin API routes, public API routes, upload serving, feed/sitemap/robots, OG routes, semantic/similar search.
- Relevant core libraries reviewed: data access, schema, auth/session/origin, rate limits, upload tracking, restore maintenance, image queue, image processing, CLIP embeddings/model, smart collections, file serving, validation/sanitization, revalidation, storage paths.
- Relevant operational code reviewed: `apps/web/scripts/*`, Drizzle SQL/journal/reconcile path, Docker/nginx/deploy config, service worker template/output, focused tests around the reviewed invariants.
- Existing modified review artifacts in `.context/reviews/` were observed and left untouched except this requested file.

## Findings

### DBG18-01 - CLIP inference has an unbounded pending queue and ignores request aborts while waiting

Severity: High
Confidence: High

Code regions:

- `apps/web/src/lib/clip-model.ts:53-70` bounds active inference with `CLIP_INFERENCE_CONCURRENCY`, but stores all pending waiters in an unbounded `inferenceWaiters` array.
- `apps/web/src/lib/clip-model.ts:138-146` routes production text search through that slot.
- `apps/web/src/lib/clip-model.ts:171-222` routes image embedding and Sharp preprocessing through that same slot.
- `apps/web/src/app/api/search/semantic/route.ts:248-255` checks abort only before calling `embedTextReal()`, not while queued inside it.
- `apps/web/src/lib/image-queue.ts:327-332` and `apps/web/src/lib/image-queue.ts:720-746` track background embedding side effects in an uncapped process-local `Set`.

Root-cause hypothesis:

The code protects CPU concurrency but not admission. A manual semaphore limits active work, yet every caller beyond the limit gets retained in memory until a slot opens; there is no max pending count, timeout, priority separation, or `AbortSignal` removal.

Concrete failure scenario:

Production semantic search is enabled with default `CLIP_INFERENCE_CONCURRENCY=1`. A burst of public searches arrives while uploads are also scheduling image embeddings. Browser requests time out or disconnect, but their waiters remain in `inferenceWaiters`; when they eventually run, they still consume ONNX CPU. Background embedding promises also accumulate in `state.sideEffects`, increasing memory pressure and shutdown drain time.

Suggested fix:

Replace the waiter array with a bounded queue/semaphore that supports max pending depth, max wait time, and abort-driven removal. Return 429 or 503 when saturated. Split public search and background image-embedding queues or reserve separate quotas/priorities so uploads cannot starve interactive search and vice versa.

### DBG18-02 - Disabled/non-production semantic requests can consume DB config reads without retaining rate-limit budget

Severity: Medium
Confidence: High

Code regions:

- `apps/web/src/app/api/search/semantic/route.ts:168-185` calls `getGalleryConfig()` before any semantic rate-limit charge.
- `apps/web/src/app/api/search/semantic/route.ts:194-205` charges only after the config-mode gate passes.
- `apps/web/src/app/api/search/similar/[id]/route.ts:85-113` pre-increments, performs `getGalleryConfig()`, then rolls back the token for non-production modes.
- `apps/web/src/lib/gallery-config.ts` is the backing config accessor referenced by both routes; `CLAUDE.md` documents `semantic_search_mode='disabled'` as the default fresh-install state.

Root-cause hypothesis:

The rate-limit contract optimizes around body parsing and CLIP work, but treats DB-backed config lookup as free. Public disabled/stub-mode probes therefore still hit MySQL while either never charging or refunding the limiter.

Concrete failure scenario:

A scripted client sends many small same-origin-looking `POST /api/search/semantic` requests while semantic search is disabled. Each request returns 503 before reading the body and before `preIncrementSemanticAttempt()`, but still runs the `admin_settings` config lookup. `/api/search/similar/1` in disabled/stub mode also performs the config lookup and then `rollbackSemanticAttempt(ip)`. On the documented single-instance, 10-connection deployment, this can create DB pressure without visible semantic rate-limit pressure.

Suggested fix:

Once cheap syntactic gates pass, retain a rate-limit charge before any DB-backed mode lookup, or make the mode check a short-TTL in-process cached value that does not issue a DB read per disabled request. Add tests that disabled/stub-mode probes either consume the semantic bucket after config work or hit a cache path that avoids per-request DB access.

### DBG18-03 - Mixed bulk tag edits can change public tags without touching `images.updated_at`

Severity: Medium
Confidence: Medium

Code regions:

- `apps/web/src/app/actions/images.ts:1057-1068` builds and applies scalar image updates when any tri-state scalar field is not `leave`.
- `apps/web/src/app/actions/images.ts:1123-1150` adds/removes image-tag rows.
- `apps/web/src/app/actions/images.ts:1152-1155` explicitly touches `images.updated_at` only when tag mutations happen and the scalar `setClause` is empty.
- `apps/web/src/db/schema.ts:97-100` relies on `updated_at` `onUpdateNow()` for ordinary image-row updates.
- `apps/web/src/lib/data.ts:828-852` orders feeds by `images.updated_at`; sitemap freshness also derives from image update timestamps.

Root-cause hypothesis:

The code assumes a non-empty scalar update will always advance the image row timestamp, so it skips the explicit tag freshness touch in mixed scalar-plus-tag operations. MySQL `ON UPDATE CURRENT_TIMESTAMP` does not reliably advance when the scalar assignment is a no-op.

Concrete failure scenario:

An admin selects images, sets `topic` to the same topic they already have, and adds a new tag. `setClause` is non-empty, so the tag freshness branch is skipped. If the topic update is a no-op for those rows, the only real mutation is `image_tags` insertion. Public tag labels change, but `images.updated_at` can remain unchanged, so Atom feed ordering/`updated` and sitemap `lastmod` can miss or de-prioritize the changed content.

Suggested fix:

Whenever `tagMutationRows > 0`, explicitly update `images.updated_at = CURRENT_TIMESTAMP` for affected image IDs regardless of `setClause` size. Add a regression for a scalar no-op plus tag mutation that asserts the timestamp-touch update occurs.

### DBG18-04 - Public route rate-limit scanner misses transitive local mutators

Severity: Medium
Confidence: High

Code regions:

- `apps/web/scripts/check-public-route-rate-limit.ts:124-127` recognizes only direct property mutation calls such as `db.insert`.
- `apps/web/scripts/check-public-route-rate-limit.ts:256-286` marks local mutating functions only when their own body directly calls a known mutator.
- `apps/web/scripts/check-public-route-rate-limit.ts:129-150` and `apps/web/scripts/check-public-route-rate-limit.ts:212-241` then trust that non-transitive `localMutatingFunctions` set.
- `apps/web/scripts/check-public-route-rate-limit.ts:355-360` passes the route when every handler appears to call a limiter before the detected mutation.
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:364-381` covers only a one-hop helper that directly mutates before the limiter.

Root-cause hypothesis:

The scanner builds `localMutatingFunctions` in a single pass and never computes the local call graph to a fixed point. A helper that calls another helper that mutates is not classified as mutating.

Concrete failure scenario:

A future public `POST` route uses `handler() -> writeFirst() -> actuallyWrite() -> db.insert(...)`, then calls `preIncrementShareAttempt()` after `writeFirst()`. The scanner sees `writeFirst()` as a non-mutating local call because only `actuallyWrite()` directly calls `db.insert`; the file can pass `lint:public-route-rate-limit` while mutating before retaining a public rate-limit token.

Suggested fix:

Compute local mutating functions to a fixed point: a function is mutating if it directly calls a known mutation method or calls another local function already classified as mutating. Use that transitive set for exported handlers and add a two-hop negative fixture.

### DBG18-05 - `image_embeddings` stores one row per image, making model cutovers destructive

Severity: Medium
Confidence: High

Code regions:

- `apps/web/src/db/schema.ts:280-294` makes `image_embeddings.image_id` the primary key and keeps `model_version` as a secondary indexed attribute.
- `apps/web/scripts/backfill-clip-embeddings.ts:123-147` selects rows missing the target `model_version`.
- `apps/web/scripts/backfill-clip-embeddings.ts:172-183` writes with `onDuplicateKeyUpdate`, replacing any existing embedding for the image.
- `apps/web/src/lib/image-queue.ts:356-367` uses the same one-row upsert for post-upload embeddings.
- `apps/web/src/app/api/search/semantic/route.ts:261-284` and `apps/web/src/app/api/search/similar/[id]/route.ts:115-156` read only rows matching the active model version.

Root-cause hypothesis:

The schema models embeddings as mutable image state rather than versioned model artifacts. That works for the initial stub-to-production overwrite, but it makes future model upgrades, partial backfills, and rollbacks state-destructive.

Concrete failure scenario:

An operator backfills a new production model version. Each processed image overwrites its prior production embedding in place. During the cutover, searches filtered to the new model see only the already-upgraded subset; rolling back to the old model cannot simply flip a setting because old vectors were overwritten. A failed backfill can leave a mixed DB where no single mode has complete coverage without another full re-embed.

Suggested fix:

Use a composite key such as `(image_id, model_version)` and keep old model rows until the new model is fully backfilled and verified. Add an activation pointer for the serving model version and an operator cleanup path for retired versions. If storage size is a concern, keep at least one previous production version for rollback.

### DBG18-06 - Backup/download and upload-serving TOCTOU comments overstate path-race protection

Severity: Low
Confidence: Medium

Code regions:

- `apps/web/src/app/api/admin/db/download/route.ts:43-75` validates `lstat()`/`realpath()` and then opens `createReadStream(resolvedFilePath)`.
- `apps/web/src/app/api/admin/db/download/route.ts:78-84` sends `Content-Length` from the pre-open `stats`.
- `apps/web/src/lib/serve-upload.ts:175-217` computes metadata/ETag from a pre-open `lstat()`.
- `apps/web/src/lib/serve-upload.ts:263-267` then opens a new path with `createReadStream(resolvedPath)` while the comment says this closes the TOCTOU gap.

Root-cause hypothesis:

The implementation validates one path object, then later opens by pathname. Realpath helps avoid opening the user-derived string and rejects symlinks at validation time, but it does not bind the streamed object to the object that was statted.

Concrete failure scenario:

A same-host process with write access to `data/backups` or `public/uploads` replaces a validated regular file between `realpath()`/`lstat()` and `createReadStream()`. The response can emit headers based on the old object while streaming the replacement. This is not a confirmed remote exploit under the current threat model, but the source comments can mislead future hardening work into thinking descriptor-backed validation already exists.

Suggested fix:

If the threat model requires closure, open the file descriptor first, reject symlinks where supported, `fstat()` the opened descriptor, verify the opened object, and stream from `FileHandle.createReadStream()`. If local write access remains outside scope, weaken the comments/tests to say the current code reduces path risk but does not fully close the open-after-check race.

## Final Missed-Issues Sweep

Final sweep covered:

- Server action origin/auth ordering and rollback paths.
- Public API validation, rate-limit ordering, same-origin boundaries, and disabled-mode branches.
- Admin API auth wrapper behavior, PAT upload path, and backup download path.
- Upload quota claims, restore-maintenance checks, original cleanup, GPS/HDR gates, and queue enqueue semantics.
- Image queue processing claims, delete-during-processing cleanup, bootstrap retries, shutdown drain, caption/embedding side effects.
- Data projections, privacy-sensitive field omissions, map-specific GPS exposure, feed/sitemap freshness, tag aggregation, pagination cursors.
- Drizzle schema, migration journal monotonicity, reconcileLegacySchema, removed feature schema drops, analytics retention indexes.
- CLIP model loading, embedding serialization, semantic/similar search scans, production/stub version gates.
- Smart collection parser/compiler, topic slug remap, public collection route behavior.
- File serving path validation, upload directories, legacy original handling, service worker cache path contracts.
- Deployment/nginx/Docker scripts and documented production constraints.

Validation evidence:

- Static review only; I did not run the full lint/typecheck/test/build gates because this assignment requested a review artifact only and no implementation changes.
- Exact line references above were taken from the current workspace during this review.

Final count:

- High: 1
- Medium: 4
- Low: 1
- Total findings: 6
