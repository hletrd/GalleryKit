# Tracer Review - Cycle 5/100

**Date:** 2026-06-29
**HEAD reviewed:** `2f7895a5782518236c124e490c5b374f92019473`
**Role:** tracer lane. Current HEAD source and built-output inspection. No application source edited.

## Inventory

Read first: `AGENTS.md`, `CLAUDE.md`.

Relevant files inventoried before judging findings:

- Upload/original migration: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/gps-exif-strip.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/scripts/migrate.js`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/scripts/backfill-cicp-recheck.ts`.
- Service worker/offline caching: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/src/lib/sw-cache.ts`, `apps/web/scripts/build-sw.ts`, `apps/web/src/components/register-service-worker.tsx`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/next.config.ts`, `apps/web/src/__tests__/sw-cache.test.ts`, `apps/web/src/__tests__/sw-template-contract.test.ts`.
- Semantic search: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/actions/embeddings.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/clip-embedding-constants.ts`, `apps/web/src/lib/clip-inference.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/clip-model-id.ts`, `apps/web/src/lib/clip-paths.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/scripts/download-clip-models.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/drizzle/0012_image_embeddings.sql`, `apps/web/drizzle/0022_image_embeddings_model_version_idx.sql`.
- Deploy packaging: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`, `apps/web/package.json`, `package.json`, `apps/web/scripts/entrypoint.sh`, `apps/web/public/**`, built directory `apps/web/.next/standalone/apps/web/public`.
- Rate limits: `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/bounded-map.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`.
- Data/public privacy: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/lib/image-types.ts`, `apps/web/src/app/[locale]/(public)/map/page.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/info-bottom-sheet.tsx`, `apps/web/src/__tests__/privacy-fields.test.ts`, `apps/web/src/__tests__/map-privacy.test.ts`, `apps/web/src/__tests__/search-route-privacy.test.ts`.

## Findings

### TRC-C5-01 - Docker runner omits immutable `public/` assets, breaking `/sw.js`, icons, fonts, and workers

**Severity:** High
**Confidence:** High
**Status:** Confirmed

**File/region:** `apps/web/Dockerfile:105-120`, `apps/web/docker-compose.yml:23-27`, `apps/web/public/*`, built output `apps/web/.next/standalone/apps/web/public`.

**Trace:** The runner copies `.next/standalone`, `.next/static`, migrations, and scripts (`Dockerfile:105-115`), then creates only `apps/web/public/uploads` and `apps/web/public/resources` (`Dockerfile:117-120`). Compose bind-mounts only `./public/uploads` and `./public/resources` plus config (`docker-compose.yml:23-27`). The immutable assets that must come from the image are real files in `apps/web/public`: `sw.js`, `sw.template.js`, `histogram-worker.js`, `fonts/PretendardVariable.woff2`, and `icons/*.png`. Local built-output inspection confirmed `apps/web/.next/standalone/apps/web/public` contains only `uploads/` and `resources/`, not those immutable files.

**Failure scenario:** Production starts from the runner image. `RegisterServiceWorker` registers `/sw.js` (`apps/web/src/components/register-service-worker.tsx:18-20`), the histogram component creates `/histogram-worker.js?v=...` (`apps/web/src/components/histogram.tsx:545`), CSS loads `/fonts/PretendardVariable.woff2?v=1` (`apps/web/src/app/[locale]/globals.css:6-7`), and the manifest references `/icons/*.png` (`apps/web/src/app/manifest.ts:36-47`). Because the runner image did not copy `public/` and the bind mounts cover only mutable subdirectories, those requests 404. Offline caching never registers, the PWA icons are broken, the self-hosted font falls back, and the histogram worker cannot load.

**Concrete fix:** In the runner stage, copy the full built `public` tree before runtime mounts overlay the mutable subdirectories:

```dockerfile
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
```

Keep the existing `./public/uploads` and `./public/resources` bind mounts so runtime data remains persistent. Add a source test that requires the Dockerfile to copy `/app/apps/web/public` and a packaging smoke check for `/sw.js`, `/histogram-worker.js`, `/fonts/PretendardVariable.woff2`, and `/icons/icon-192.png` in the standalone runtime path.

### TRC-C5-02 - Lightroom upload leaks pre-claimed quota when the topic lookup throws

**Severity:** Medium
**Confidence:** High
**Status:** Confirmed

**File/region:** `apps/web/src/app/api/admin/lr/upload/route.ts:94-117`, `apps/web/src/app/api/admin/lr/upload/route.ts:119-131`, `apps/web/src/app/api/admin/lr/upload/route.ts:198-205`.

**Trace:** The Lightroom route pre-claims one upload against `trackerKey` before parsing/validation completes (`route.ts:94-117`) and defines `settleTrackerToActual()` for rollback (`route.ts:119-131`). Most validation returns call the settlement closure, but the topic existence query is a bare awaited DB call (`route.ts:198-202`). If that query throws due to a transient DB outage, pool timeout, restore interference, or dropped connection, control leaves the handler before `settleTrackerToActual(false)` runs. The browser upload path explicitly wraps the analogous post-claim topic query and settles on throw (`apps/web/src/app/actions/images.ts:266-275`), so the parallel ingest path has drifted.

**Failure scenario:** A Lightroom token user uploads during a transient MySQL failure. The route has already incremented the per-token/IP upload tracker by one file and the declared multipart `Content-Length`. The topic `SELECT` throws, Next returns a 500, and the tracker remains inflated until the upload window expires. After enough transient failures, legitimate LR uploads from that token/IP get 429 even though no image landed.

**Concrete fix:** Wrap the topic lookup in `try/catch` and call `settleTrackerToActual(false)` before returning a JSON 503/500 or rethrowing. Keep the existing 404 no-topic settlement. A focused regression should mock `db.select(...).from(...).where(...).limit(...)` to throw after the preclaim and assert the tracker returns to its prior count/bytes.

### TRC-C5-03 - Legacy original migration deletes public source when private target exists without verifying bytes

**Severity:** Medium
**Confidence:** Medium
**Status:** Risk

**File/region:** `apps/web/scripts/migrate.js:58-95`, especially `apps/web/scripts/migrate.js:71-85`, and startup call `apps/web/scripts/migrate.js:771-774`.

**Trace:** Startup runs `migrateLegacyOriginalUploads(appRoot)` before asserting the legacy public directory is clear (`migrate.js:771-774`). For each file in `public/uploads/original`, the migrator computes a private target under `data/uploads/original` (`migrate.js:58-72`). If the target path already exists, it unconditionally deletes the public source and continues (`migrate.js:74-76`). It does not compare size, hash, mtime, or image identity.

**Failure scenario:** A previous cross-device migration attempt copies `public/uploads/original/<uuid>.jpg` to the private target but is interrupted after creating a truncated/corrupt target, or an operator restores a private originals directory from a different snapshot while the legacy public directory still has the good source. On next startup, `fs.existsSync(target)` is true, so the good public source is unlinked and the only remaining original for that DB row may be corrupt or wrong. Later backfill/semantic jobs resolve the private target first and process bad bytes.

**Concrete fix:** When the private target already exists, verify it matches the source before deleting the legacy file. At minimum compare file size; preferably compare SHA-256 and only unlink the source on a match. On mismatch, throw a migration error that leaves both files in place and fails closed with an operator message. Add a migration unit/source test for the duplicate-target mismatch branch.

## Confirmed-Correct Flow Notes

- Browser uploads hold the upload-processing contract lock, preclaim quota before awaited disk/DB work, roll back around the topic lookup, strip GPS from DB and original under the same snapshot, late-check restore maintenance after saving, and enqueue with processing/semantic config snapshots (`apps/web/src/app/actions/images.ts:107-580`).
- Lightroom upload mirrors the save/GPS/insert/enqueue path after the topic lookup: post-save failures delete the original and settle quota, HDR/restore rejections clean up, and successful rows enqueue with the same processing config snapshot (`apps/web/src/app/api/admin/lr/upload/route.ts:217-505`). The quota-leak finding is the pre-lock topic lookup branch only.
- Original privacy is layered: new originals go to `UPLOAD_ORIGINAL_ROOT` (`apps/web/src/lib/upload-paths.ts:27-40`), nginx returns 404 for `/uploads/original/` (`apps/web/nginx/default.conf:163-165`), and instrumentation fails production startup if legacy public originals remain (`apps/web/src/instrumentation.ts:1-5`).
- Service worker logic itself is coherent: image derivatives use stale-while-revalidate with a bounded 300 ms HEAD probe (`apps/web/public/sw.template.js:172-268`), HTML is network-first offline fallback only (`apps/web/public/sw.template.js:271-311`), and the generated `sw.js` is tested for parity.
- Semantic search and similar-image search are same-origin gated, restore-gated, rate-limited before heavy embedding/DB scan work, mode/version isolated, scan-limited, and enrich through `searchEnrichmentSelectFields` with a compile-time privacy guard (`apps/web/src/app/api/search/semantic/route.ts:100-333`, `apps/web/src/app/api/search/similar/[id]/route.ts:60-237`, `apps/web/src/lib/search-enrichment-fields.ts:29-47`).
- Public privacy projections are guarded in `data.ts`: `publicSelectFields` omits every `PrivacySensitiveKeys` member, map GPS exposure is isolated to `publicMapSelectFields` plus `topics.map_visible = true`, and timeline/search mirrors carry type/test guards (`apps/web/src/lib/data.ts:364-482`, `apps/web/src/lib/data.ts:1653-1690`, `apps/web/src/lib/data-timeline.ts:20-73`).
- Rate-limit posture matched source contracts in the reviewed paths: public mutating API lint passed, semantic/similar/OG charge before protected work, and public server actions roll back on documented low-risk read-path infrastructure failures.

## Validation Evidence

- `npm run lint:public-route-rate-limit --workspace=apps/web` passed. It reported no mutating public route gaps and confirmed `/api/search/semantic` uses a rate-limit helper.
- Initial `npm test --workspace=apps/web -- --runInBand ...` did not run tests because Vitest 4.1.9 rejects `--runInBand`.
- Re-run without the unsupported flag passed: `npm test --workspace=apps/web -- src/__tests__/deploy-script-contract.test.ts src/__tests__/sw-template-contract.test.ts src/__tests__/search-route-privacy.test.ts src/__tests__/map-privacy.test.ts src/__tests__/semantic-search-rate-limit.test.ts` -> 5 files, 39 tests passed.
- Static built-output check: `apps/web/.next/standalone/apps/web/public` contains only `uploads/` and `resources/`, while `apps/web/public` contains `sw.js`, `histogram-worker.js`, `fonts/PretendardVariable.woff2`, and `icons/*.png`.

## Final Missed-Issues Sweep

Final sweeps covered:

- `rg` inventory for upload/original paths, legacy public original handling, private original resolution, cleanup, and backfill consumers.
- Service-worker template/generated parity, registration path, runtime public assets, Docker copy/mount behavior, nginx upload/original rules, and deploy prune contracts.
- Semantic search mode gates, body-size/rate-limit ordering, model-version filtering, scan limits, result enrichment privacy, CLIP model packaging/seeding paths.
- Public/admin rate-limit helpers, public API route scanner output, OG charged-failure policy, and public server action rollback branches.
- Canonical public data projections, map GPS exception, timeline/search mirror guards, and UI render gates for admin-only GPS/HDR fields.

No additional confirmed defects surfaced in delete cleanup, derivative serving containment, semantic scan caps, public search privacy, map visibility gating, OG SSRF hardening, or deploy prune data safety.

**Disposition:** 3 findings: 1 High, 2 Medium.
