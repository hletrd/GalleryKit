# Cycle 33 Tracer Review

Scope: causal source tracing only. I edited only this review artifact and did not use comments or tests as proof of behavior.

## Relevant File Inventory

- Upload -> processing -> persistence -> display: `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/components/photo-viewer.tsx`, public photo/share/topic pages under `apps/web/src/app/[locale]/(public)/`.
- Auth -> mutation -> audit: `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/audit.ts`, `apps/web/src/proxy.ts`.
- Route -> cache/rate limit: `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/serve-upload.ts`.
- Settings -> derivative bytes: `apps/web/src/app/actions/settings.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/settings-hash.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/src/lib/admin-backfill-runner.ts`.
- Backup/restore: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/backup-filename.ts`.
- Semantic search: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/src/db/schema.ts`.

## Findings

### TRC-33-01 - MEDIUM - Byte-impacting setting changes can leave public derivatives stale and mixed

- Location: `apps/web/src/app/actions/settings.ts:68-79`, `apps/web/src/app/actions/settings.ts:82-134`, `apps/web/src/lib/settings-hash.ts:47-59`, `apps/web/src/lib/image-queue.ts:122-137`, `apps/web/src/lib/image-queue.ts:646-661`, `apps/web/src/lib/serve-upload.ts:197-223`, `apps/web/scripts/backfill-color-pipeline.ts:332-341`.
- Severity: Medium.
- Confidence: High.

Causal chain:

1. The settings mutation path treats only `image_sizes` and `strip_gps_on_upload` as upload-processing-contract changes (`settings.ts:68-79`).
2. Once any image exists, the same action blocks changes to `image_sizes` and `strip_gps_on_upload` (`settings.ts:82-134`), but it still accepts other byte-impacting settings such as `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `force_srgb_derivatives`, `wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, and `wide_gamut_max_source_pixels`.
3. The serving hash considers all of those settings byte-impacting (`settings-hash.ts:47-59`), and the upload queue snapshots/applies them when encoding new derivatives (`image-queue.ts:122-137`, `image-queue.ts:646-661`).
4. Existing derivative files are not rewritten by `updateGallerySettings()`. The fallback route ETag includes the settings hash (`serve-upload.ts:197-223`), but its body is still the already-written file. Static-served files likewise keep their old bytes until a re-encode happens.
5. The operator script can force a re-encode of all processed rows (`backfill-color-pipeline.ts:332-341`), but the settings action does not enqueue it, mark derivatives stale, or block the setting change until it runs.

Failure scenario:

- An admin changes `force_srgb_derivatives=true` or lowers `image_quality_jpeg` after the gallery already contains processed images. New uploads immediately use the new encoder settings, while existing `/uploads/{avif,webp,jpeg}/...` files remain encoded with the prior settings. Public pages, share pages, OG image fetches, and downloads now present a mixed derivative corpus under one admin configuration. Clients that revalidate through the fallback route may get a new ETag with unchanged old bytes, which makes the stale-byte state look freshly validated.

Suggested fix:

- On `updateGallerySettings()`, diff all `COLOR_IMPACTING_KEYS`, not only `image_sizes`. For changed derivative-byte keys, either block with an explicit "run re-encode" flow, enqueue/trigger the existing all-row re-encode path, or persist a `derivatives_stale_since`/settings revision flag that admin UI and serving paths can surface. Treat clearing a setting back to default the same as setting a new value. Add a targeted regression that changes `force_srgb_derivatives` or a quality key after a processed image exists and asserts the app either blocks, marks stale, or schedules re-encoding instead of silently accepting mixed bytes.

### TRC-33-02 - LOW - Invalid public view-recording calls consume the analytics limiter

- Location: `apps/web/src/app/actions/public.ts:341-395`, `apps/web/src/app/actions/public.ts:417-442`, `apps/web/src/app/actions/public.ts:444-474`, `apps/web/src/app/actions/public.ts:477-510`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:164-166`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:173-174`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:137-142`.
- Severity: Low.
- Confidence: Medium.

Causal chain:

1. Public pages fire-and-forget server actions to record image, topic, and shared-group views (`p/[id]/page.tsx:164-166`, `[topic]/page.tsx:173-174`, `g/[key]/page.tsx:137-142`).
2. Each recorder validates only cheap shape first, then calls `checkViewRecordRateLimit()` before the target existence/visibility query (`public.ts:417-428`, `public.ts:444-461`, `public.ts:477-497`).
3. `checkViewRecordRateLimit()` increments the in-memory and durable `view_record` bucket before returning `ok` (`public.ts:341-395`).
4. If the later existence/visibility query returns no image, topic, or group, the recorder returns without using `rollbackViewRecordAttempt()` (`public.ts:424-429`, `public.ts:457-462`, `public.ts:486-498`).

Failure scenario:

- A bot posts repeated public server-action calls with syntactically valid but nonexistent positive image IDs, valid-looking topic slugs, or random base56 group keys. Those calls do not insert analytics rows, but they consume the same per-IP `view_record` budget used by legitimate page views. Once the 120/minute bucket is exhausted, real users behind the same IP/NAT can have valid view events dropped for the rest of the window. The impact is analytics accuracy, not authorization or stored photo data.

Suggested fix:

- Decide whether invalid target calls should be charged. If not, keep the cheap syntactic precheck but either validate target existence before the durable increment, or store the returned `{ bucketStart, dbIncremented }` and call `rollbackViewRecordAttempt()` on the `!visibleImage`, `!visibleTopic`, and `!visibleGroup` exits. If charging invalid targets is intentional to protect DB reads, make that policy explicit and consider a separate low-cost invalid-target limiter so legitimate analytics cannot be suppressed by nonexistent IDs.

## Traced But No New Finding

- Upload -> processing -> persistence -> display: the upload action validates admin/origin/maintenance, writes originals before DB insert, inserts `processed=false`, snapshots processing settings, and queues work. The queue encodes all formats, verifies output files, updates `processed=true` conditionally, and cleans derivatives if the row disappeared mid-processing. Public data selection uses explicit public fields before rendering.
- Auth -> mutation -> audit: password login/change and admin-user mutations perform same-origin/admin checks before writes, use session verification or token scopes for privileged API access, and record audit events around successful mutations and relevant auth failures.
- Route -> cache/rate limit: semantic and similar-search routes pre-increment public rate limits before model/scanning work, bound input size and scan size, and gate production CLIP mode. Backup download validates filename shape, realpath containment, and streams from the already-opened file handle.
- Backup/restore: restore obtains DB restore, upload-processing, color-backfill, and semantic-backfill locks before durable maintenance, drains queue/background DB writes, scans restore SQL, runs `mysql --one-database`, and keeps maintenance active on partial restore failure.
- Semantic search: upload processing writes embeddings after the row is marked processed, bootstrap covers processed rows missing the active embedding version, search routes filter by target model version, and the manual backfill script re-embeds rows missing the target model version.

## Final Sweep

Final sweep rechecked schema shape, backup download containment, SQL restore scanning, semantic backfill selection, public view-recording call sites, byte-impacting settings membership, serving ETags, queue encoding inputs, and color backfill force-reencode behavior. I found two actionable issues above and no critical/high causal break in upload processing, auth/audit, restore, or semantic search from the code paths traced.
