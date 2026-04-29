# Architect Review — Cycle 1 Fan-out Continuation

Date: 2026-04-29 (Asia/Seoul)  
Repository: `/Users/hletrd/flash-shared/gallery`  
Role: architect  
Write scope honored: only `.context/reviews/architect.md` was edited.

## Inventory first

I treated this as a full-repo architecture/design pass focused on boundaries, coupling, runtime/deployment topology, and hidden shared-state hazards. The worktree already contained edits by other review agents under `.context/reviews/*`; I did not touch them.

Reviewed inventory:

- Project/runtime contract: `README.md`, `CLAUDE.md`, root `package.json`, `apps/web/package.json`.
- Deployment topology: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/scripts/entrypoint.sh`, `apps/web/scripts/migrate.js`.
- Next/runtime config: `apps/web/next.config.ts`, `apps/web/src/proxy.ts`, `apps/web/src/instrumentation.ts`, health/live/OG/upload/API routes.
- Core app boundaries: `apps/web/src/app/**`, especially public/admin route groups and server actions.
- Data/runtime libraries: `apps/web/src/lib/data.ts`, `image-queue.ts`, `process-image.ts`, `upload-paths.ts`, `restore-maintenance.ts`, `upload-processing-contract-lock.ts`, `rate-limit.ts`, `storage/**`, `session.ts`, `request-origin.ts`, `content-security-policy.ts`.
- Persistence: `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, Drizzle migrations.
- Architecture guardrails/tests were sampled where they described enforced invariants.

## Architecture map observed

- Single Next.js app under `apps/web`; App Router serves localized public pages, protected admin pages, server actions, and a few API routes.
- MySQL/Drizzle is the relational source of truth for metadata, auth/session, sharing, settings, audit log, and persistent rate-limit buckets.
- Image ownership is split: DB rows store filenames; originals are private files under `data/uploads/original`; public derivatives live under `public/uploads/{jpeg,webp,avif}`.
- Upload flow crosses auth/origin checks → process-local quota tracker → filesystem original write → DB insert → process-local queue → Sharp derivative writes → DB `processed` update.
- Restore flow is SQL-only: it shells out to `mysql`, toggles process-local maintenance, quiesces the local queue, imports DB state, and revalidates app data.
- Several runtime states are intentionally process-local. `CLAUDE.md` documents the shipped topology as single web-instance/single-writer (`CLAUDE.md:158-161`).

## Findings

### A1. Shipped nginx forwards spoofable `X-Forwarded-For`, defeating the trusted-proxy boundary

- Severity: High
- Confidence: High
- Category: Confirmed deployment/runtime boundary bug
- Evidence:
  - `apps/web/src/lib/rate-limit.ts:82-105` trusts `X-Forwarded-For` when `TRUST_PROXY=true` and selects the client address before the trusted suffix.
  - `apps/web/docker-compose.yml:18-20` sets `TRUST_PROXY: "true"` for the documented deployment.
  - `apps/web/nginx/default.conf:53-57`, `70-74`, `85-89`, and `120-124` proxy client IP headers; each uses `$proxy_add_x_forwarded_for` rather than overwriting the header.
  - README explicitly says trusted proxies must overwrite forwarded headers (`README.md:146-148`).

Problem:

The app's trusted-proxy algorithm assumes the reverse proxy supplies a trustworthy forwarding chain. The shipped nginx config appends to any client-supplied `X-Forwarded-For`. With a direct client request containing `X-Forwarded-For: 1.2.3.4`, nginx forwards `1.2.3.4, <real-client-ip>`. With `TRUSTED_PROXY_HOPS=1`, the app selects the spoofed first address instead of the real client.

Failure scenario:

A scripted client spoofs a new `X-Forwarded-For` value on every request. Login/search/share/OG/load-more buckets are keyed to attacker-chosen IPs, so per-IP limits and audit IP attribution become unreliable behind the documented nginx deployment.

Suggested fix:

Change nginx to overwrite rather than append untrusted forwarding headers at the trust boundary, e.g. `proxy_set_header X-Forwarded-For $remote_addr;` in every proxy location, and keep `X-Real-IP $remote_addr`. Add an integration/fixture test for `getClientIp()` using the exact shipped nginx header shape, including a spoofed inbound XFF case. Consider failing startup when `TRUST_PROXY=true` and a deploy template still contains `$proxy_add_x_forwarded_for`.

---

### A2. Single-writer/process-local topology is documented but not enforced by the runtime

- Severity: Medium-High
- Confidence: High
- Category: Confirmed architectural invariant
- Evidence:
  - `CLAUDE.md:158-161` documents single web-instance/single-writer and process-local restore/upload/queue/view-count state.
  - `README.md:146` repeats that restore maintenance, upload quotas, and queue state are process-local and should not be horizontally scaled.
  - `apps/web/src/lib/restore-maintenance.ts:1-56` stores maintenance state in `globalThis`.
  - `apps/web/src/lib/upload-tracker-state.ts:7-20` stores upload quota state in a process-local `Map`.
  - `apps/web/src/lib/image-queue.ts:121-140` stores queue/enqueued/retry/bootstrap state in process memory.
  - `apps/web/src/lib/data.ts:11-23` buffers shared-group view counts in module-local state.
  - `apps/web/src/app/api/health/route.ts:7-15` reports only the local process' maintenance flag.

Problem:

The application relies on a single writer for correctness, but deployment only documents that constraint. A second container, PM2 cluster, Kubernetes replica, or parallel `next start` process can boot successfully against the same DB/uploads. Some advisory locks protect individual image jobs or restore operations, but they do not make maintenance, quota, health, and buffered counters globally consistent.

Failure scenario:

Instance A starts DB restore and flips its local maintenance flag. Instance B continues accepting uploads and public actions because its flag is false. Upload quota budgets split per process, health checks can pass against B, and DB/filesystem state can diverge while A imports SQL.

Suggested fix:

Pick and enforce one topology:

1. Keep single-writer: acquire a DB-backed instance lease at boot, fail fast if another writer is active, and expose writer identity/lease state in health/readiness; or
2. Support scale-out: move restore maintenance, upload quotas, queue scheduling, and view-count buffering into DB/Redis/shared storage.

Until enforced, expand deployment docs with concrete prohibited topologies and add a startup warning/error path for known cluster modes.

---

### A3. Admin DB backup/restore is SQL-only while gallery state spans DB plus filesystem assets

- Severity: Medium-High
- Confidence: High
- Category: Confirmed recovery-boundary gap
- Evidence:
  - `apps/web/src/app/[locale]/admin/db-actions.ts:128-251` creates DB dumps with `mysqldump` and returns a SQL download URL.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:369-521` restore validates/imports a SQL file only.
  - `apps/web/src/db/schema.ts:16-30` image rows store filenames, not image blobs.
  - `apps/web/src/lib/upload-paths.ts:11-46` separates public upload root from private original root.
  - `apps/web/src/lib/image-queue.ts:248-255` cannot process a pending row if the referenced original file is absent.
  - `apps/web/docker-compose.yml:22-25` persists `./data` and `./public` as separate mounted filesystem trees.
  - `README.md:176-181` says originals and derivatives live in those volumes.

Problem:

The admin-facing backup/restore path protects only relational state, but operational recovery requires matching filesystem state. SQL restore can create rows that point to missing derivatives/originals, or leave newer volume files orphaned after restoring an older dump.

Failure scenario:

An operator restores a SQL dump onto a fresh host. Public pages contain processed image rows whose `/uploads/...` files do not exist, and any `processed=false` rows cannot be repaired because their private originals are also missing. Conversely, restoring an older dump onto existing volumes leaves unreferenced files indefinitely.

Suggested fix:

Make the UI/docs label the feature as database-only. Add a full gallery backup format that bundles SQL, private originals, public derivatives/resources, and a checksum manifest. At minimum, add a post-restore reconciliation job that reports missing originals/derivatives, regenerates derivatives from originals where possible, and optionally sweeps orphaned files after operator confirmation.

---

### A4. Experimental storage abstraction has drifted from the live private/public storage boundary

- Severity: Medium
- Confidence: High
- Category: Confirmed design drift / future footgun
- Evidence:
  - `CLAUDE.md:97-100` says storage is not integrated and must not be exposed as S3/MinIO switching.
  - `apps/web/src/lib/storage/types.ts:1-15` says the storage interface is experimental and not used by every upload/serve path.
  - `apps/web/src/lib/storage/index.ts:1-12` says live uploads, processing, and serving still use direct filesystem code.
  - `apps/web/src/lib/process-image.ts:233-256` writes originals directly to `UPLOAD_DIR_ORIGINAL`.
  - `apps/web/src/lib/process-image.ts:389-478` writes derivatives directly to `UPLOAD_DIR_WEBP/AVIF/JPEG`.
  - `apps/web/src/lib/serve-upload.ts:63-99` serves public files directly from the filesystem.
  - `apps/web/src/lib/upload-paths.ts:24-46` keeps originals private and derivatives public.

Problem:

The repository contains two storage models: a partially built generic `StorageBackend` and the actual local filesystem pipeline. Because the abstraction is not wired end-to-end, future backend work can easily update one side and leave the other side writing/reading local paths. The live security boundary is data-class based (private originals vs public derivatives), not just a generic object-key namespace.

Failure scenario:

A future change adds S3/MinIO support through `getStorage()` and assumes uploads now use it, but `process-image.ts` and `serve-upload.ts` continue using local paths. Originals land in one backend, derivatives in another, public pages 404, and private-original assumptions may be broken if generic URL methods are used for original keys.

Suggested fix:

Either remove/quarantine the unused abstraction or finish the migration behind a single storage port used by upload, processing, deletion, and serving. Model visibility explicitly, e.g. `PrivateOriginalStore` and `PublicDerivativeStore`, so private originals cannot accidentally acquire public URLs. Add contract tests proving all live image paths use the same backend boundary.

---

### A5. Build-time and runtime asset-origin policy share one mutable `IMAGE_BASE_URL`

- Severity: Medium
- Confidence: High
- Category: Confirmed phase-boundary risk
- Evidence:
  - `apps/web/next.config.ts:8-28` parses `IMAGE_BASE_URL` during config/build evaluation.
  - `apps/web/next.config.ts:79-83` derives Next image allowlists from that parsed value.
  - `apps/web/Dockerfile:35-38` passes `IMAGE_BASE_URL` as a build arg.
  - `apps/web/docker-compose.yml:7-20` forwards `IMAGE_BASE_URL` through build args and runtime environment.
  - `README.md:142-144` warns it must be set before build.

Problem:

One variable controls two phases: build-time optimizer/CSP allowlisting and runtime URL generation. The docs warn operators, but the container does not enforce that runtime `IMAGE_BASE_URL` matches the value used to build the standalone app.

Failure scenario:

An image is built with `IMAGE_BASE_URL=https://cdn-a.example.com` and then run with `IMAGE_BASE_URL=https://cdn-b.example.com`. Rendered URLs point at `cdn-b`, while Next's built image policy may still allow only `cdn-a`, leading to optimization failures or inconsistent CSP/image behavior that is hard to diagnose from runtime env alone.

Suggested fix:

Persist a small build manifest containing the build-time asset origin and fail startup if the runtime value differs. Alternatively split variables by phase, e.g. `NEXT_IMAGE_REMOTE_BASE_URL` for build policy and `PUBLIC_ASSET_BASE_URL` for runtime rendering, with explicit rebuild requirements.

---

### A6. Edge admin mutation throttling does not cover all protected mutation pages

- Severity: Low-Medium
- Confidence: High
- Category: Confirmed deployment-policy drift
- Evidence:
  - `apps/web/nginx/default.conf:77-90` rate-limits only `dashboard|db|categories|tags|users|password` admin subpaths.
  - `apps/web/nginx/default.conf:115-129` generic fallback proxy has no equivalent `limit_req`.
  - `apps/web/src/app/actions/settings.ts:40-47` exposes a protected settings mutation action.
  - `apps/web/src/app/actions/seo.ts:55-62` exposes a protected SEO mutation action.
  - `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx:1-6` and `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx:1-5` are protected dynamic admin pages.

Problem:

App-level auth and same-origin checks still exist, so this is not an auth bypass. The architecture issue is that nginx's edge policy encodes a partial route inventory, and settings/SEO mutation pages fall through to the generic proxy path instead of the stricter admin mutation throttle.

Failure scenario:

A compromised admin browser session or accidental automation hammers SEO/settings forms. Those requests still hit DB writes and broad `revalidateAllAppData()` invalidations, but they bypass the nginx admin mutation budget applied to neighboring admin pages.

Suggested fix:

Broaden the nginx admin throttling location to all protected admin subpaths except explicit safe exceptions, or at least add `settings|seo`. Add a CI check that compares protected admin route directories against nginx rate-limit coverage.

---

### A7. Topic image resources can orphan on crash between file finalization and DB ownership

- Severity: Low
- Confidence: Medium
- Category: Likely crash-consistency gap
- Evidence:
  - `apps/web/src/lib/process-topic-image.ts:42-80` writes a final public `public/resources/<uuid>.webp` file.
  - `apps/web/src/lib/process-topic-image.ts:95-102` cleanup targets temporary `tmp-*` files, not already-final orphan resources.
  - `apps/web/src/app/actions/topics.ts:112-121` topic create processes the image before the DB write completes.
  - `apps/web/src/app/actions/topics.ts:214-229` topic update processes a replacement image before the update completes.
  - `apps/web/src/app/actions/topics.ts:283-286` deletes the previous image only after successful update.

Problem:

Normal error paths clean up, but there is no durable owner record for a finalized topic image until the DB mutation commits. A process crash after file finalization and before commit/catch cleanup leaves an unreferenced public file.

Failure scenario:

During topic create/update, Sharp writes `public/resources/<uuid>.webp`; the process exits before the topic row references that filename. The public file remains forever and is not removed by tmp cleanup.

Suggested fix:

Use a staged lifecycle: write to private/temp, commit the DB owner, then promote/rename after commit; or persist a pending asset record and finalize transactionally. Add a sweeper that compares `public/resources/*.webp` with `topics.image_filename` and reports/removes aged orphans.

## Final sweep

- Confirmed existing unrelated worktree changes are in other review artifacts and were not modified by this pass.
- This review intentionally did not change source code, tests, configs, or generated assets.
- No commit was created because the user explicitly requested `no source changes/commits` for this fan-out continuation.
