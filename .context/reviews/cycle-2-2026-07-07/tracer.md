# Causal Trace Review — GalleryKit (apps/web)

Evidence-driven trace of six suspicious end-to-end flows: upload→queue→processing→serving→SW,
admin settings→ETag→backfill, DB restore→maintenance→recovery, session→proxy→origin→PAT,
delete-racing-processing/backfill, and topic rename→FK/smart-collection remap.

Known issue explicitly excluded per instructions: Dockerfile workspace-nested `node_modules`
build failure (handled elsewhere).

---

## TRC-01 — `updateGallerySettings()` only fences `image_sizes` / `strip_gps_on_upload` as "upload-processing-contract" changes; every other byte-impacting setting (quality, chroma, force-sRGB, AVIF effort, wide-gamut cap) is accepted unconditionally with no block, no staleness marker, and no re-encode trigger

**Severity:** High | **Confidence:** High

**File:line chain:**
- `apps/web/src/app/actions/settings.ts:86-135` — `changedUploadProcessingKeys` is populated **only** from `image_sizes` (:88-114) and `strip_gps_on_upload` (:116-130). These two are the only keys checked against `hasActiveUploadClaims()` (:133) and, if an image already exists, blocked outright (:144-164, `imageSizesLocked` / `uploadSettingsLocked`).
- `apps/web/src/app/actions/settings.ts:170-182` — the generic upsert transaction persists **every** other sanitized key (including `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `force_srgb_derivatives`, `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `wide_gamut_max_source_pixels`) with no existence check, no lock, and no follow-up action.
- `apps/web/src/lib/settings-hash.ts:47` `COLOR_IMPACTING_KEYS` (= `DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS`) lists all 9 keys as byte-impacting — i.e. the codebase's own authoritative list agrees every one of the unfenced keys changes encoded bytes.
- `apps/web/src/lib/image-queue.ts:148-164` `createProcessingSettingsSnapshot` / `apps/web/src/lib/process-image.ts:1049-1485` `processImageFormats` — confirms new uploads pick up the changed value immediately (the settings snapshot is taken fresh at upload time), while nothing rewrites already-processed rows.
- `apps/web/src/lib/serve-upload.ts:204-230` — the fallback route ETag folds in the settings hash so *that* path revalidates promptly, but the response body served on a cache miss is still the unchanged on-disk file (no re-encode happens as a side effect of a 200 response).
- The only path that actually rewrites existing derivatives at the new settings is an operator-invoked backfill (`apps/web/scripts/backfill-color-pipeline.ts` with `--force-reencode`, or the in-app "Re-encode existing photos" button in `apps/web/src/lib/admin-backfill-runner.ts`) — neither is triggered automatically by `updateGallerySettings()`.

**Hypothesis:** The upload-processing-contract fence was designed for the two settings whose *shape* changes are structurally dangerous to mix within a single derivative directory (`image_sizes` — different files per size; `strip_gps_on_upload` — a privacy-affecting toggle), but the fence was never extended to cover the *encoder-quality/colorspace* settings even though `settings-hash.ts`'s own `COLOR_IMPACTING_KEYS` list already treats all nine as equally byte-impacting.

**Evidence for:** Directly confirmed by reading `updateGallerySettings()` end-to-end: `changedUploadProcessingKeys` literally only ever gets `.add('image_sizes')` or `.add('strip_gps_on_upload')` — there is no equivalent block for any of the other seven keys in `COLOR_IMPACTING_KEYS`. The CLAUDE.md operational note on ETag/cache invalidation independently corroborates this ("flipping a color/quality/size admin setting does NOT invalidate already-served STATIC derivatives... an admin who changes a setting and expects new bytes everywhere must run a backfill re-encode") — but that note describes the STATIC-path caching consequence; it does not describe the fact that the *settings mutation itself* applies no gate, block, or automatic remediation for these keys, unlike its siblings.

**Evidence against:** None — this is a direct reading of unconditional code, not a hypothesis. The severity is somewhat tempered by the fact that the *documented* operator workflow already expects a manual backfill after any color/quality setting change (CLAUDE.md's "Adding a new color-impacting setting" and backfill sections) — but that expectation is not enforced or even surfaced by the action itself.

**Concrete failure scenario:** An admin lowers `image_quality_jpeg` from 90 to 40 (e.g. to save disk space) on a gallery that already has thousands of processed photos. `updateGallerySettings()` accepts the change immediately with `{success: true}` and no warning. From that moment: (1) every new upload is encoded at quality 40; (2) every existing photo's `/uploads/jpeg/...` files remain at quality 90 until an operator manually runs the backfill script or clicks the in-app re-encode button, which CLAUDE.md documents as a distinct, unprompted, easy-to-forget manual step. The gallery silently serves two different JPEG quality tiers under one nominal "current setting" indefinitely (no `derivatives_stale` flag exists anywhere for the admin UI to surface). The same applies to `force_srgb_derivatives` (a colorimetric behavior change) and `wide_gamut_jpeg_chroma`/`avif_effort`/`sdr_jpeg_chroma`/`wide_gamut_max_source_pixels`.

**Suggested fix:** Extend the `changedUploadProcessingKeys` diff in `settings.ts` to cover all of `COLOR_IMPACTING_KEYS` (importing the same list `serve-upload.ts`/`settings-hash.ts` already treat as authoritative), and either (a) require the admin to explicitly acknowledge/trigger a re-encode as part of accepting the change once images exist, or (b) auto-enqueue the existing in-app backfill runner, or (c) at minimum persist a `derivatives_stale_since` marker that the admin dashboard surfaces prominently until a full re-encode completes. Since `image_sizes`/`strip_gps_on_upload` currently hard-block the change entirely once an image exists, a lighter-touch "warn + optionally auto-backfill" policy is likely more appropriate for the quality/colorspace keys (which don't have the same directory-shape hazard).

**Remaining uncertainty / next probe:** None needed to confirm the gap exists. The open question is a product decision (block vs. warn vs. auto-backfill) rather than something further tracing would resolve.

---

## TRC-02 — Image-queue concurrency cap uses a locally duplicated pool-limit constant, not the real pool size

**Severity:** Medium | **Confidence:** High

**File:line chain:**
- `apps/web/src/lib/image-queue.ts:113` `const DEFAULT_DB_POOL_CONNECTION_LIMIT = 10;`
- `apps/web/src/lib/image-queue.ts:117-128` `resolveImageQueueConcurrency(requested, poolLimit = DEFAULT_DB_POOL_CONNECTION_LIMIT)`
- `apps/web/src/lib/image-queue.ts:130-134` `QUEUE_CONCURRENCY = resolveImageQueueConcurrency(REQUESTED_QUEUE_CONCURRENCY)` — called with **one argument**, so `poolLimit` always resolves to the local `10`, never the live pool value.
- Contrast: `apps/web/src/lib/admin-backfill-runner.ts:59` imports `POOL_CONNECTION_LIMIT` directly from `@/db` and threads it through `resolveBackfillConcurrency(requested, poolLimit = POOL_CONNECTION_LIMIT)` (line 131).
- Source of truth: `apps/web/src/db/index.ts:23` `export const POOL_CONNECTION_LIMIT = 10;`

**Hypothesis:** Two independent reserved-connection-budget formulas exist for the same underlying resource (the shared MySQL pool). The backfill runner's formula is wired to the actual exported constant; the live image-processing queue's formula duplicates the number as a local literal instead of importing it.

**Evidence for:** Confirmed by direct read — `image-queue.ts`'s only import from `@/db` is `{ connection, db, images, sessions, imageEmbeddings }` (`image-queue.ts:6`); `POOL_CONNECTION_LIMIT` is never imported there.

**Evidence against:** Today both constants equal `10`, so there is currently no observable behavioral divergence — this is a latent/structural risk, not an active bug.

**Concrete failure scenario:** If `POOL_CONNECTION_LIMIT` is ever made configurable (e.g. via env var) and raised, `admin-backfill-runner.ts`'s reserved-connection cap scales correctly; `image-queue.ts`'s `QUEUE_CONCURRENCY` keeps computing its cap against the stale `10`, silently under- or over-provisioning the live upload-processing queue's concurrency relative to the actual pool size — breaking the lockstep CLAUDE.md's documented formula assumes between the two subsystems.

**Suggested fix:** Import `POOL_CONNECTION_LIMIT` from `@/db` in `image-queue.ts` and pass it explicitly to `resolveImageQueueConcurrency`, keeping `DEFAULT_DB_POOL_CONNECTION_LIMIT` only as the exported function's test-default parameter (matching the `admin-backfill-runner.ts` pattern).

**Remaining uncertainty / next probe:** None for the finding itself (fix is mechanical); worth grepping for any other hardcoded pool-size literals to confirm this is the only drifted copy.

---

## TRC-03 — `deleteImage`/`deleteImages` never acquire the per-image processing claim, so a delete can interleave with an in-flight backfill re-encode (convergence is correct, but not free, and the original-file unlink-during-read path is filesystem-dependent)

**Severity:** Low-Medium | **Confidence:** Medium

**File:line chain:**
- `apps/web/src/app/actions/images.ts:655-757` (`deleteImage`) and `:759-923` (`deleteImages`) — neither acquires `gallerykit:image-processing:{id}` before deleting the DB row and unlinking files; they only clear queue-state Maps (`:710-717`, `:828-835`).
- `apps/web/src/lib/admin-backfill-runner.ts:517-541` `reprocessOne` acquires that same lock for the whole re-encode→detect→persist window specifically because, per its own comment (`:441-449`), `deleteImage` does **not** hold it.
- Convergence path: `apps/web/src/lib/admin-backfill-runner.ts:468-485` `cleanupIfUpdateMissedDeletedRow` + `:450-460` `cleanupDeletedMidReencodeVariants` (full directory scan, `sizes=[]`) run after the version-bump `UPDATE` observes `affectedRows === 0` and a follow-up existence probe confirms the row is gone.
- Symmetric handling on the live-queue side: `apps/web/src/lib/image-queue.ts:723-744` (same `affectedRows === 0` → `deleteImageVariants(..., [])` pattern).

**Hypothesis:** A `deleteImage(X)` call can run entirely (DB delete + file cleanup) while `admin-backfill-runner`'s `reprocessOne(X)` is mid-`processImageFormats`, because the two paths do not share a lock. `processImageFormats` has no knowledge the row was deleted mid-encode — it keeps writing derivative files until its own final `UPDATE ... WHERE id = X` observes 0 affected rows, triggers a fresh existence probe, and re-runs the same directory-scan cleanup to remove what it just wrote.

**Evidence for:** Directly confirmed — `deleteImage`/`deleteImages` contain no call to `acquireImageProcessingClaim`/`GET_LOCK('gallerykit:image-processing:...')` anywhere, and the backfill runner's own header comment states this explicitly.

**Evidence against:** The eventual state is correct — no orphaned files persist, per the `deleted-mid-reencode` tally and its dedicated tests (`__tests__/admin-backfill-runner-deleted-mid-reencode*.test.ts`). This is a tested, intentionally-handled race, not an unhandled one.

**Concrete failure scenario:** Under this race, the backfill fully re-encodes (all configured sizes × 3 formats) an image an admin just deleted, before discovering the row is gone and deleting everything it wrote — pure wasted CPU/IO with no correctness impact, but real cost on a large gallery with an admin actively curating (deleting) while a backfill runs.

**Suggested fix:** Optional — have `deleteImage`/`deleteImages` attempt (non-blocking, 0-timeout) the same per-image advisory lock before the DB delete, purely as a performance optimization; current behavior is already correctness-safe.

**Remaining uncertainty / next probe:** Whether the *original* file (`data/uploads/original/...`) being unlinked by `deleteOriginalUploadFileStrict` while `processImageFormats`'s Sharp/libvips pipeline holds it open mid-read is safe depends on the filesystem's unlink-of-open-file semantics — always safe on local POSIX filesystems (ext4/xfs/APFS), but CLAUDE.md documents NAS-backed deployments as a real target (`IMAGE_CLEANUP_CONCURRENCY`'s doc mentions "NAS/high-latency storage"). If that mount is NFS, unlink-of-open-file has had client/server-dependent edge cases historically. Static tracing can't settle this — the next probe is to check the actual deployment's mount type for `data/uploads/original` and, if NFS, verify client-version silly-rename behavior, or reproduce with a concurrent delete+backfill against the real storage backend.

---

## TRC-04 — `getGalleryConfig()` (React `cache()`-wrapped) is called from detached PQueue background tasks, outside any request/render scope

**Severity:** Medium | **Confidence:** Low-Medium (needs runtime verification)

**File:line chain:**
- `apps/web/src/lib/gallery-config.ts:186-187` — `export const getGalleryConfig = cache(_getGalleryConfig);`, documented as "deduped within a single SSR request via React cache()".
- Call sites inside detached `PQueue` task bodies (not inside any HTTP request/render):
  - `apps/web/src/lib/image-queue.ts:429` — `bootstrapMissingActiveEmbeddings`'s semantic-mode resolution.
  - `apps/web/src/lib/image-queue.ts:673` — the `!quality && !imageSizes` bootstrap/legacy-re-enqueue config-load gate inside `state.queue.add(async () => {...})`.
  - `apps/web/src/lib/image-queue.ts:791` — the post-processing embedding side-effect's semantic-mode resolution, also inside `state.queue.add(async () => {...})`.

**Hypothesis:** React's `cache()` primitive scopes its memoization to an active render/request context. `PQueue` task callbacks execute later, asynchronously, on the event loop — potentially after the request/action that called `enqueueImageProcessing()` has already returned a response — and are not part of any React render. If `cache()` has no defined behavior for "call site outside any active cache scope," either it degrades to no memoization (harmless — always fresh) or it falls back to some broader/global scope, which would make the first config value observed by a given worker/process effectively frozen until restart.

**Evidence for:** The `gallery-config.ts` module comment explicitly ties the caching contract to "a single SSR request" — these three call sites are not in an SSR request. `image-queue.ts:791-798`'s own comment ("resolved at write time, not from the upload-time processing snapshot, so a mode flip while a job waits in the queue cannot write stale stub rows over the active production model") depends on `getGalleryConfig()` actually re-reading current DB state at call time — exactly the behavior in question.

**Evidence against:** Not observed failing at runtime (builds/tests were out of scope for this trace). It's plausible React's `cache()` simply degrades to "no memoization" when called outside a component tree, which is actually the *correct* behavior for a background worker — just not the behavior the code comment documents.

**Concrete failure scenario (if worst case holds):** Admin flips `semantic_search_mode` from `disabled` to `stub`. New uploads pick this up immediately (upload path always supplies a fresh snapshot). But the two `getGalleryConfig()` calls that decide whether to write a CLIP embedding after processing (`:791`) and during the bootstrap missing-embedding retry sweep (`:429`) could, in the worst case, keep returning whatever value was cached at first invocation in that process — silently never starting (or never stopping) embedding writes until the container restarts.

**Suggested fix:** Replace these three call sites with a small time-boxed in-memory cache explicitly designed for non-request callers (matching the pattern already used in `settings-hash.ts`'s 5-second TTL), or call the underlying uncached resolver directly from the queue worker.

**Remaining uncertainty / next probe:** Needs a runtime check — add a temporary counter inside `_getGalleryConfig` and observe whether it increments on every queue job or only once per process across jobs with different `semantic_search_mode` values.

---

## TRC-05 — `restoreDatabase` returns an identical, misleading "restore in progress" error when the actual blocker is a long-running color-pipeline or CLIP-embedding backfill

**Severity:** Low-Medium (operator UX / observability) | **Confidence:** High

**File:line chain:** `apps/web/src/app/[locale]/admin/db-actions.ts:403-528` — `restoreDatabase` sequentially acquires `LOCK_DB_RESTORE` (:428-436), the upload-processing-contract lock (:442-449), `LOCK_COLOR_PIPELINE_BACKFILL` (:451-465), and `LOCK_SEMANTIC_EMBEDDING_BACKFILL` (:467-485) — all non-blocking. On failure to acquire **any** of these four, the function returns the identical `{ success: false, error: t('restoreInProgress') }`.

**Hypothesis / evidence:** Directly confirmed by reading every early-return branch (lines 434, 448, 463, 483) — all four use the same `restoreInProgress` message, even though only the first case is literally a concurrent restore.

**Concrete failure scenario:** An admin starts the sidecar color-pipeline backfill on a large gallery (documented as potentially long-running), then separately tries a DB restore from the admin UI. The restore fails immediately with "restore in progress" though no restore is running, with no indication that a backfill (invisible from the restore UI) is the real blocker — the operator may assume the restore action itself is broken.

**Suggested fix:** Distinguish the four failure causes with distinct i18n messages, at least for the two backfill-lock branches.

**Remaining uncertainty / next probe:** None — confirmed, low-risk UX fix.

---

## TRC-06 — Audit-log writes are fire-and-forget with `.catch(console.debug)` across every security-sensitive mutation; a transient DB error silently drops the forensic record with no retry, escalation, or metric

**Severity:** Medium | **Confidence:** High

**File:line chain:**
- `apps/web/src/lib/audit.ts` — `logAuditEvent` documented at its own definition as a "Fire-and-forget audit log writer. Callers should use `.catch(console.debug)`."
- Representative call sites (the same shape recurs at essentially every mutating action):
  `apps/web/src/app/actions/auth.ts:187,206,281,433` (login failure/success, logout, password change);
  `apps/web/src/app/actions/images.ts:626-632,733,850-857,992,1216-1225` (upload, delete, batch delete, metadata update, bulk update);
  `apps/web/src/app/actions/topics.ts:164,393,479,553,622,664` (create/update/delete/alias-create/alias-delete/map-visible);
  `apps/web/src/app/[locale]/admin/db-actions.ts:160,362-367,821-826` (CSV export, backup, restore).

**Hypothesis:** Because every audit write is wrapped in `.catch(console.debug)` (the lowest-verbosity console method, routinely filtered from production log aggregation), a transient DB blip at the exact moment a security-relevant action occurs (login, password change, admin delete, DB restore) causes that audit record to vanish with no operator-visible signal — no warning-level log, no retry, no dead-letter.

**Evidence for:** Directly confirmed — this is the explicitly documented, repo-wide pattern, not an isolated oversight.

**Evidence against:** This is a deliberate design choice (documented as intentional fire-and-forget, presumably so audit logging can never block/break the primary mutation) — a defensible tradeoff, tempered by CLAUDE.md's stated personal/small-scale threat model.

**Concrete failure scenario:** During DB stress (e.g. a large backfill or restore saturating the connection pool), failed login attempts, a password change, or an admin account deletion could silently fail to be recorded in `audit_log` while the primary action still completes/rejects normally — leaving undetectable gaps in the forensic trail precisely during the conditions most likely to coincide with an incident.

**Suggested fix:** At minimum, promote the catch handler from `console.debug` to `console.error`/`console.warn` for the highest-value security actions (login_failure, login_success, password_change, admin user delete/create, db_restore, db_backup).

**Remaining uncertainty / next probe:** Purely a product/ops judgment call; worth confirming whether existing monitoring already captures `console.debug`-level output in production (if so, this finding is moot).

---

## TRC-07 — Ad hoc administrative advisory-lock connections (topic-route lock, restore's chained locks) are not accounted for in the documented connection-pool budget formulas

**Severity:** Low | **Confidence:** Medium

**File:line chain:**
- `apps/web/src/app/actions/topics.ts:63-84` `withTopicRouteMutationLock` — acquires one dedicated pooled connection for `GET_LOCK(..., 5)` plus the whole wrapped `action()`, which itself runs a `db.transaction(...)` on a **second**, separately-acquired connection.
- `apps/web/src/app/[locale]/admin/db-actions.ts:416-485` `restoreDatabase` — one dedicated connection reused for three sequential `GET_LOCK`s, **plus** a second independent connection inside `acquireUploadProcessingContractLock(0)` — two connections pinned simultaneously for the whole restore-preparation window.
- Compare: the carefully-budgeted formulas — `image-queue.ts:114-128` and `admin-backfill-runner.ts:33-34,129-136` — both reason only about image-processing-claim connections vs. live request traffic; neither accounts for a concurrent topic mutation or an in-flight restore also holding 1-2 dedicated connections apiece.

**Hypothesis:** The documented pool-budget arithmetic is scoped only to the image-processing-claim vs. live-request tradeoff and doesn't model the additional connections topic mutations, restore, and backup transiently pin.

**Evidence for:** Directly confirmed by reading every lock-acquisition call site.

**Evidence against:** At the documented "personal gallery, single admin, single web instance" scale, these operations are rare/short relative to the pool size of 10; no evidence of an actual exhaustion incident found in comments/tests.

**Concrete failure scenario:** A multi-admin deployment (the schema explicitly supports multiple root admins) where one admin restores a DB while another renames a topic and a third browses could add several simultaneously-pinned connections beyond what the documented formulas assume — most likely manifesting as increased request latency (mysql2 pool queues rather than errors immediately) rather than an outright failure.

**Suggested fix:** Low priority given the scale caveat; if revisited, fold these connections into the same budget model or shorten their hold time.

**Remaining uncertainty / next probe:** Would need a load test under realistic multi-admin concurrent-mutation conditions; not resolvable from static tracing alone.

---

## Final sweep — commonly missed issue categories checked

- **Unbounded in-memory growth:** all retry/failure/rate-limit Maps and Sets (`image-queue.ts`, `auth-rate-limit.ts`, `admin-backfill-runner.ts`) are explicitly bounded with FIFO/oldest-eviction — no leak found.
- **Lock-scope vs. mutation-scope mismatches:** `admin-mutation-barrier.ts` correctly separates "restore-maintenance active" (checked once, at entry, by every action) from "admin-mutation slot held" (counted for the whole body via `using`/`Symbol.dispose`, drained by the restore before it proceeds). Traced the interleaving window explicitly: an action that passes its maintenance check just before the marker flips, then stalls before acquiring its slot, correctly gets rejected at `acquireAdminMutationSlot()` once `exclusiveActive` flips true, because every traced action performs all its writes strictly after slot acquisition.
- **ETag/atomic-rename consistency:** `serve-upload.ts`'s `lstat`→`realpath`→`open`→`fileHandle.stat()` ordering guarantees the ETag always describes the exact inode about to be streamed, even if a backfill's atomic rename lands between path-resolution and open — no torn-read / ETag-mismatch possible (cross-checked against `process-image.ts`'s `writeFinalPathAtomically`, temp-file-then-rename).
- **Restore-maintenance process-local flag vs. durable marker:** confirmed (already documented in CLAUDE.md, not a new finding) that `syncRestoreMaintenanceFromDurable()` runs only once, at process startup (`instrumentation.ts:3-4`), never per-request — clearing the durable marker from a separate process genuinely requires restarting `gallerykit-web`. Matches documented operational guidance exactly; no drift found.
- **Session/token verification:** HMAC verification in `session.ts` runs `timingSafeEqual` before any structural/expiry checks (avoiding a timing oracle); admin PAT verification (`admin-tokens.ts`) similarly hashes-then-constant-time-compares. Both fail closed on any parse/DB error. No issues found.
- **CSRF/origin checks:** `hasTrustedSameOrigin` fails closed when neither `Origin` nor `Referer` is present; `withAdminAuth`'s token bypass path is scoped to `allowTokenScope`-configured routes only and does not weaken the cookie-session path's origin check. No issues found.

## Flows and files traced

1. **Upload → tracker claim/rollback → save → queue → claim lock → Sharp → conditional UPDATE → serving → SW** — `app/actions/images.ts` (`uploadImages`, `retryFailedImage`), `lib/image-queue.ts` (full file), `lib/process-image.ts` (`processImageFormats` and its atomic-rename helpers, lines 1049-1485), `lib/serve-upload.ts`, `lib/settings-hash.ts`.
2. **Admin settings → settings hash → ETag invalidation → backfill → static-path mtime invalidation** — `app/actions/settings.ts` (full file), `lib/settings-hash.ts`, `lib/serve-upload.ts`, `lib/gallery-config.ts`, `lib/admin-backfill-runner.ts` (full file).
3. **DB restore → advisory locks → maintenance marker → recovery → process-local flag reset** — `app/[locale]/admin/db-actions.ts` (full file), `lib/restore-maintenance.ts`, `lib/restore-maintenance-durable.ts`, `lib/db-restore.ts`, `lib/admin-mutation-barrier.ts`, `lib/upload-processing-contract-lock.ts`, `lib/advisory-locks.ts`, `instrumentation.ts` (grep-confirmed single call site).
4. **Session issuance → cookie → proxy.ts guard → origin checks → PAT scope path** — `app/actions/auth.ts`, `proxy.ts`, `lib/session.ts`, `lib/action-guards.ts`, `lib/request-origin.ts`, `lib/api-auth.ts`, `lib/admin-tokens.ts`.
5. **Delete racing processing/backfill → file cleanup → orphan prevention** — `app/actions/images.ts` (`deleteImage`, `deleteImages`), `lib/image-queue.ts` (claim + `affectedRows===0` cleanup), `lib/admin-backfill-runner.ts` (`reprocessOne`, `cleanupDeletedMidReencodeVariants`, `cleanupIfUpdateMissedDeletedRow`, `runBackfill`).
6. **Topic rename → FK repointing → smart-collection predicate remap** — `app/actions/topics.ts` (full file: `createTopic`/`updateTopic`/`deleteTopic`/`createTopicAlias`/`deleteTopicAlias`/`setTopicMapVisible`, `withTopicRouteMutationLock`).

Additional supporting files read for cross-cutting concerns: `lib/audit.ts`, `db/index.ts` (pool config), `lib/background-db-writes.ts`, `lib/queue-shutdown.ts`, `lib/gallery-config.ts`.
