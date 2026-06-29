# Tracer Review - Review-Plan-Fix Cycle 4

**Date:** 2026-06-29  
**HEAD reviewed:** `10b500bb30399f7c66812a5ad899f070f88d5501` (`docs(reviews): 📝 record cycle 4 critic report`)  
**Role:** tracer specialist. Current HEAD source only. No application code edited.

## Tracing Inventory

Read first: `AGENTS.md`, `CLAUDE.md`.

Duplicate filter consulted: current `.context/reviews/tracer.md` from cycle 3, `.context/reviews/_aggregate.md`, and recent tracer history only enough to avoid stale re-reporting. Cycle 3 restore-gating findings for `bulkUpdateImages`, LR token create/revoke, and public analytics are fixed in current HEAD.

Files/regions examined for this pass:

- Upload/process/delete: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/image-queue.ts` references, `apps/web/src/lib/process-image.ts` references, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-tracker*.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`.
- Restore maintenance: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/db-restore.ts`, restore guards across `apps/web/src/app/actions/*.ts`, and public analytics recorders.
- Sharing: `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, shared data access in `apps/web/src/lib/data.ts`, share-key rate-limit helpers.
- Admin tokens: `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx`.
- Semantic search: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/clip-embedding-constants.ts`, `apps/web/src/lib/search-enrichment-fields.ts`.
- Service worker/cache/revalidation: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/scripts/build-sw.ts`, `apps/web/src/lib/sw-cache.ts`, `apps/web/src/lib/serve-upload.ts`, both uploads route handlers, `apps/web/next.config.ts`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, and `apps/web/src/lib/revalidation.ts`.
- Public asset state: `apps/web/public/**`, `apps/web/src/lib/process-topic-image.ts`, topic actions, topic image render sites, Docker public mount/copy behavior.

## Findings

### TRC-C4-01 - Topic cover uploads are stored in non-persistent container state after the public mount was narrowed

**Severity:** Medium  
**Confidence:** High  
**Status:** Confirmed / manual validation for deployed data loss

**Code region:**  
`apps/web/src/lib/process-topic-image.ts:20-28` resolves topic image storage to `apps/web/public/resources` or `public/resources`. `processTopicImage()` writes new cover files there at `apps/web/src/lib/process-topic-image.ts:72-89`, and topic actions persist only the generated filename in DB (`apps/web/src/app/actions/topics.ts:128-154`, `:238-351`). Runtime deployment now bind-mounts only uploads (`apps/web/docker-compose.yml:23-26`). The runner receives build-time public files through `.next/standalone`, but no host bind mount persists new `public/resources` writes across container replacement.

**Why this is a problem:**  
Cycle 3 correctly stopped mounting the entire host `./public` over the built app so `/sw.js`, fonts, icons, and static workers are not masked. But `public/resources` is also a runtime write path for admin-uploaded topic covers. With only `./public/uploads` mounted, new topic cover bytes live inside the current container filesystem, while the database row outlives the container.

**Concrete failure scenario:**  
An admin creates or updates a topic with a cover image. The app writes `public/resources/<uuid>.webp` and stores that filename in `topics.image_filename`. The next `npm run deploy` rebuilds/replaces the container. The DB still points at `<uuid>.webp`, but the new container only has committed resources from the image, not the runtime-uploaded file. Navigation topic thumbnails request `/resources/<uuid>.webp` and 404.

**Concrete fix:**  
Persist `public/resources` the same way as uploads, for example add `./public/resources:/app/apps/web/public/resources` to `docker-compose.yml`, create/chown it in the runner, and extend deploy/docs/tests to pin that mount. Alternatively move topic resources under `data/` plus a serving route, but keep the DB filename and filesystem bytes in the same persistence domain.

### TRC-C4-02 - Lightroom upload checks restore maintenance only after parsing the multipart body and querying topics

**Severity:** Low  
**Confidence:** High  
**Status:** Confirmed

**Code region:**  
`apps/web/src/app/api/admin/lr/upload/route.ts:70-133` calls `request.formData()`, validates the uploaded file/topic/title/description, and queries `topics` before the restore-maintenance guard at `apps/web/src/app/api/admin/lr/upload/route.ts:143-148`.

**Why this is a problem:**  
The guard prevents the eventual insert, but it does not fail fast. During a restore window, the route still accepts and materializes a large Lightroom multipart body and performs a DB read against tables that may be in the middle of restore. That weakens the restore quiescence contract and can turn “restore in progress” into a slow 400/404/500 depending on body parsing or topic-table timing.

**Concrete failure scenario:**  
Lightroom retries a 180 MB publish while an admin restore is active. The server verifies the token, reads the whole multipart upload, and attempts the topic lookup before returning the restore 503. If the restore has dropped/recreated `topics` at that moment, the handler can throw or return a misleading topic error instead of the intended retryable maintenance response.

**Concrete fix:**  
Move the `isRestoreMaintenanceActive()` check to the top of the authenticated handler, before `request.formData()` and before any topic DB query. Keep the later `cleanupOriginalIfRestoreMaintenanceBegan()` post-save check, because it covers the race where maintenance starts during a slow save/GPS-strip window.

### TRC-C4-03 - Scoped PAT authorization updates `last_used_at` before scope acceptance

**Severity:** Low  
**Confidence:** High  
**Status:** Confirmed

**Code region:**  
`apps/web/src/lib/admin-tokens.ts:136-165` verifies a token and immediately touches `last_used_at` at `apps/web/src/lib/admin-tokens.ts:157-159`. `withAdminAuth()` then checks the required scope only after verification at `apps/web/src/lib/api-auth.ts:63-84`. The token list renders this timestamp as “Last used” at `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:123-126`.

**Why this is a problem:**  
A valid token presented to a route for which it lacks scope is rejected, but the UI records it as used. That makes the “Last used” field ambiguous for credential forensics: it may mean a successful Lightroom upload, or just a denied wrong-scope probe. The LR upload route also re-verifies the token for audit user id (`apps/web/src/app/api/admin/lr/upload/route.ts:65-67`), so successful scoped uploads can touch the same field twice.

**Concrete failure scenario:**  
An admin issues a future `lr:read`-only token. That token is accidentally configured against `/api/admin/lr/upload`. Every failed upload attempt returns 401 because `lr:upload` is missing, but `last_used_at` advances. The admin sees recent “Last used” activity and may conclude the token successfully uploaded or was accepted by an integration.

**Concrete fix:**  
Split token lookup from usage marking. Have `verifyToken()` return the validated token without side effects, then update `last_used_at` only in `withAdminAuth()` after `tokenHasScope()` passes. Pass the verified token through to the handler so the LR upload route can use the wrapper-provided token for audit instead of re-verifying.

## Confirmed-Correct Flow Notes

- Cycle 3 restore gaps are fixed in current HEAD: `bulkUpdateImages` has a restore guard (`apps/web/src/app/actions/images.ts:928-933`), LR token create/revoke have restore guards (`apps/web/src/app/actions/lr-tokens.ts:33-37`, `:109-113`), and public analytics recorders return during maintenance before header/rate-limit/insert work (`apps/web/src/app/actions/public.ts:357-410`).
- Browser upload holds the upload-processing contract lock, claims quota before disk/DB awaits, cleans saved originals if restore begins mid-upload, forwards config snapshots into the queue, and settles quota after success/failure (`apps/web/src/app/actions/images.ts:107-591`).
- LR upload mirrors the core save/insert/enqueue cleanup contract after the late restore check: post-save failures delete the original and settle quota, and successful rows enqueue with the same processing config snapshot (`apps/web/src/app/api/admin/lr/upload/route.ts:159-502`).
- Restore flow serializes with MySQL `gallerykit_db_restore`, also holds the upload-processing contract lock, begins process-local maintenance, drains shared-group view counts, quiesces/resumes the image queue, and releases locks in finally blocks (`apps/web/src/app/[locale]/admin/db-actions.ts:266-360`).
- Sharing public metadata avoids unthrottled share-key DB lookups; page bodies rate-limit once before lookup. Admin share mutations are restore-gated and roll back pre-incremented quota on no-op/failure paths.
- Semantic search and similar-image search are same-origin-gated, restore-gated, rate-limited before expensive work, model-version filtered, scan-limited, and enrich results through the shared PII-guarded select.
- The narrowed `./public/uploads` mount no longer masks built `/sw.js`; the current risk is the sibling runtime-write path `public/resources`, not the static public asset copy.

## Final Missed-Issues Sweep

Ran final source sweeps for:

- Mutating server actions with DB writes versus restore guards and same-origin guards.
- Public mutating API routes versus pre-increment rate-limit helpers.
- `revalidate = 0`, React `cache()`, upload serving ETags, `Cache-Control`, service-worker generated/template parity, and public asset mount/copy paths.
- Admin-token verification/scope/last-used transitions.

No additional confirmed defects surfaced in photo delete cleanup, shared-group lookup rate limiting, semantic search scan caps, public route freshness, upload derivative serving, or restore lock release paths.

## Coverage Statement

This was a read-only causal trace of current HEAD source. I did not run the full test suite because the requested artifact is a review report and no application code was changed. Evidence is from source inspection, targeted greps, local HEAD/git state, and prior-context duplicate filtering.

**Disposition:** 3 findings: 1 Medium, 2 Low.
