# Cycle 27 Critic Review

Reviewer: cycle-27 critic
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `4a51d345d2aa5f7de7e791adbaf3d4868c62bf46`
Mode: read-only repository critique; no product code edits.

## Inventory First

I read the workspace instructions and project context first, then inventoried the review surface before tracing implementation paths. Fresh inventory:

- Git-tracked files: 2,594.
- Top tracked areas: `.context` 1,775, `apps` 621, `plan` 180, plus root docs/manifests/deploy files.
- Tracked app TypeScript/TSX/e2e files: 509.
- Tracked review/plan markdown files under `.context`: 1,591.

Review-relevant files and categories examined:

- Governance and product constraints: `AGENTS.md`, `CLAUDE.md`, `apps/web/README.md`, latest `.context/reviews/run9-cycle8/*`, `.context/plans/archive/73-deferred-cycle27.md`, `plan/user-injected/pending-next-cycle.md`.
- Build/deploy/ops: root `package.json`, `apps/web/package.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/scripts/entrypoint.sh`, `apps/web/deploy.sh`, `apps/web/next.config.ts`.
- Schema/migration/data safety: `apps/web/src/db/schema.ts`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance*.ts`, `apps/web/src/lib/advisory-locks.ts`.
- Upload/color/photographer intent: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/gallery-config*.ts`.
- Public serving/search/privacy: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/lib/serve-upload.ts`, public upload routes, public photo/topic/share pages, `apps/web/src/app/actions/public.ts`, semantic/similar search routes.
- Auth/origin/rate-limit gates: `apps/web/src/proxy.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, lint-gate scripts.
- Regression locks: privacy/search/migration/upload/restore/action-origin/API-auth/public-route-rate-limit tests, plus targeted fresh test run noted below.

Targeted validation run:

- `npm test --workspace=apps/web -- migrate-legacy-originals privacy-fields search-route-privacy` -> 3 files passed, 15 tests passed.

## Confirmed Issues

### C27-CRIT-01 - Legacy original migration moves private originals without tightening filesystem permissions

Severity: Medium
Confidence: High
Perspective: data safety, photographer intent, operational deployment

Evidence:

- `apps/web/scripts/migrate.js:71-80` creates the private original root and iterates legacy public originals, but `fs.mkdirSync(privateOriginalRoot, { recursive: true })` does not request a private mode or follow with `chmod`.
- `apps/web/scripts/migrate.js:99-110` migrates files by `renameSync` or `copyFileSync`/`unlinkSync`; neither branch explicitly sets the target file mode after the file lands in the private store.
- New uploads are deliberately stricter: `apps/web/src/lib/process-image.ts:910` writes originals with `mode: 0o600`, and the GPS-strip rewrite path documents the same 0600 contract at `apps/web/src/lib/process-image.ts:1729-1731`, then writes/chmods temp files at `apps/web/src/lib/process-image.ts:1762` and `apps/web/src/lib/process-image.ts:1803-1808`.
- The production container does create the intended private mount path (`apps/web/Dockerfile:97-102`, `apps/web/Dockerfile:131-134`) and the entrypoint ensures it is writable (`apps/web/scripts/entrypoint.sh:16-19`), but the entrypoint also does not tighten mode.
- Existing regression tests cover duplicate-byte safety, conflict fail-closed behavior, and EXDEV copy verification (`apps/web/src/__tests__/migrate-legacy-originals.test.ts:46-85`), but no test asserts private directory/file modes.

Concrete failure scenario:

A production site that previously stored originals under `public/uploads/original` has legacy files with common web-server or copy defaults such as `0644`. On deploy, `migrateLegacyOriginalUploads()` moves them out of the HTTP public tree, which is correct, but migrated-by-rename files keep their legacy filesystem mode and copied files have no explicit mode normalization. On a shared deploy host, backup sidecar, support shell, or accidental broad bind mount, files now documented as private originals can remain readable by users/processes that should not inspect full-resolution originals or embedded metadata. The HTTP original-streaming vector remains closed; this is a host/filesystem privacy gap.

Suggested fix:

After creating `privateOriginalRoot`, set it to a private directory mode where the platform supports it, and normalize every migrated target file to `0600` after either `renameSync` or `copyFileSync`. Add a regression test that creates a legacy file with permissive mode, runs `migrateLegacyOriginalUploads()`, and asserts the migrated target is not group/world-readable. Keep the duplicate/conflict safeguards unchanged.

## Likely Issues

No likely-but-unconfirmed issue rose above the reporting bar. The main suspicious areas I traced either had current code fixes or explicit deferred policy:

- Public semantic/similar enrichment now shares `searchEnrichmentSelectFields` with a compile-time privacy guard (`apps/web/src/lib/search-enrichment-fields.ts:29-47`), and both routes use it (`apps/web/src/app/api/search/semantic/route.ts:324-335`, `apps/web/src/app/api/search/similar/[id]/route.ts:228-240`).
- Public image/map field exposure is guarded by derived public selects and GPS-only map select rules (`apps/web/src/lib/data.ts:368-489`, `apps/web/src/lib/data.ts:1660-1697`).
- Share-key metadata avoids unthrottled lookup and returns generic noindex metadata (`apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:36-102`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:41-110`).

## Risks Needing Manual Validation

### RISK-C27-01 - Existing host private-original modes need one-time inspection after the migration fix

Severity: Medium if permissive modes are present; otherwise none
Confidence: Medium

Code proves the migration does not normalize modes today, but actual exposure depends on historical file modes, host umask, bind-mount ownership, and which local users/sidecars can read the deploy volume. After fixing C27-CRIT-01, inspect the live `data/uploads/original` tree once and normalize existing files/directories. This is a manual production validation step, not a separate code defect.

### RISK-C27-02 - Production semantic search remains operator-state-dependent

Severity: Low-Medium
Confidence: High

The code and docs correctly gate real CLIP search behind DB setting, env opt-in, and seeded offline weights (`CLAUDE.md:159`, `CLAUDE.md:500-533`; `apps/web/Dockerfile:97-102`; `apps/web/src/lib/gallery-config.ts:1-203`). I did not validate the live host's DB row, embedding row count, or seeded model files in this read-only repo pass. Treat production semantic availability as needing host verification before any release claim.

## Checked Clean / Not Re-filed

- Payment/product scope: paid downloads and Stripe remain removed and explicitly forbidden by product policy (`CLAUDE.md:570`); I did not find an active source path reintroducing payment, culling, scoring, or photo editing.
- Deployment persistence: compose mounts `./data`, `public/uploads`, and `public/resources` (`apps/web/docker-compose.yml:23-27`); Dockerfile sets `UPLOAD_ORIGINAL_ROOT=/app/data/uploads/original` and `CLIP_MODELS_ROOT=/app/data/models/clip` (`apps/web/Dockerfile:97-102`); deploy prunes only after health succeeds (`apps/web/deploy.sh:55-85`).
- Restore/import safety: restore enters maintenance, quiesces the queue, scans SQL, imports with `--one-database`, and runs migrate postconditions (`apps/web/src/app/[locale]/admin/db-actions.ts:427-506`, `apps/web/src/lib/sql-restore-scan.ts:1-234`, `apps/web/scripts/migrate.js:835-866`).
- Public derivative serving: upload routes delegate to `serveUploadFile`, which allowlists derivative directories and handles HEAD without opening a stream on the primary unlocalized route (`apps/web/src/app/uploads/[...path]/route.ts:6-30`, `apps/web/src/lib/serve-upload.ts:1-320`).
- Privacy-field split: public/public-map/search/timeline/enrichment guards are aligned; targeted tests passed (`privacy-fields`, `search-route-privacy`).
- Known deferred policy items were not duplicated: process-local scale-out assumptions, data.ts size, CSP polish, CLIP heavy integration/weights CI, storage abstraction quarantine, and previously deferred UI polish remain historical/deferred unless their documented reopen criteria are met.

## Final Sweep Confirmation

Final sweep covered governance docs, current review history, root/app package scripts, Docker/compose/entrypoint/deploy, Next config, schema and journal, migration/reconcile, backup/restore, upload and Lightroom paths, queue and image processing, color/HDR/GPS handling, derivative serving, public photo/topic/share/map/search routes, admin auth/origin/rate-limit gates, privacy guards/tests, semantic-search CLIP gating, and operational docs.

I found one confirmed issue, no likely issues, and two manual-validation risks. No code was edited beyond this review artifact.
