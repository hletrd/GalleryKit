# GalleryKit Architecture Review - Cycle 6 Prompt 1

Date: 2026-07-07
Lane: architect
HEAD reviewed: `c5d6b27e71999e2e0140a78eaf12c26a19f9813f`
Mode: read-only architecture/design review, except this artifact.

## Inventory

I inventoried the contract and source surface before selecting findings, then checked cross-file interactions rather than isolated files.

- Governance and prior art: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/prompts/architect.md`, `.context/reviews/prompts/common_review_scope.md`, `.context/reviews/_aggregate.md`, `.context/plans/deferred-carry-forward.md`, `README.md`, `apps/web/README.md`, and current peer review artifacts.
- Runtime and background jobs: `apps/web/src/instrumentation.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/queue-shutdown.ts`, `apps/web/src/lib/background-db-writes.ts`, restore-maintenance modules, single-writer guard, upload path guards, analytics/view-retention helpers.
- DB/schema evolution: `apps/web/src/db/schema.ts`, `apps/web/drizzle/**`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, and migration/reconcile tests.
- Media pipeline and storage boundary: browser upload action, Lightroom upload route, image processing queue, Sharp processing module, upload-path/serve modules, and `apps/web/src/lib/storage/**`.
- Frontend/backend contracts: SEO admin UI/actions, data getters, locale/OG helpers, localized messages, app layout metadata generation, route locale tests, public/admin actions and API routes.
- Deployment architecture: Docker/deploy docs, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, nginx config tests, and host-nginx runbook sections.

I did not edit source, run formatters, start the app, or commit. This is static architectural review; runtime-only production assertions are reported as manual-validation risks.

## Confirmed Issues

### ARCH-C6-01 - SEO locale has a split frontend/backend/documentation contract

Severity: Low-Medium
Confidence: High
Status: Confirmed

Evidence:

- Root configuration docs say admin-editable DB SEO fields include `locale` and override file defaults at runtime (`README.md:50-52`).
- The detailed architecture docs say `locale` is not DB-overridable and requires an image rebuild because `site-config.json` is build-time inlined (`CLAUDE.md:148`).
- The admin UI still exposes a `seo_locale` input (`apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:151-161`), the admin action reads it from `admin_settings` (`apps/web/src/app/actions/seo.ts:27-47`), and save validation accepts normalized Open Graph locale values (`apps/web/src/app/actions/seo.ts:123-128`).
- Public metadata reads `seo_locale` as `seo.locale` (`apps/web/src/lib/data.ts:1804-1835`), but `getOpenGraphLocale()` deliberately lets supported route locales win and uses the configured value only for unsupported locales (`apps/web/src/lib/locale-path.ts:63-75`).
- The `[locale]` layout passes `locale` plus `seo.locale` to metadata generation (`apps/web/src/app/[locale]/layout.tsx:17-20`) and rejects unsupported route locales before page render (`apps/web/src/app/[locale]/layout.tsx:90-93`), making the configured fallback unreachable for normal public pages.
- Tests pin that route locale wins and configured locale is only for unsupported locale inputs (`apps/web/src/__tests__/locale-path.test.ts:48-66`). The UI hint now describes the fallback behavior (`apps/web/messages/en.json:482-483`), so the remaining split is the architecture/docs/control-plane contract.

Failure scenario:

An operator follows the root README and changes `locale` in the admin dashboard expecting a runtime site-wide locale/OG change. English and Korean public pages continue advertising route-derived OG locales. A future maintainer following `CLAUDE.md` may instead believe locale is file-only and remove or bypass `seo_locale`, breaking the existing fallback/test contract. The product has one field name but two architectural meanings.

Concrete fix:

Pick one source-of-truth contract and make code/docs/tests use that name. If the current behavior is intended, rename the setting and docs to `seo_og_locale_fallback` or "unsupported-route OG locale fallback", remove `locale` from root README's runtime-overridable list, and keep the `locale-path` tests as contract tests. If admins are supposed to override public page OG locale globally, change `getOpenGraphLocale()` and the layout contract accordingly, then rewrite the tests and UI hint.

### ARCH-C6-02 - The shipped nginx template still hardcodes the demo domain

Severity: Medium
Confidence: High
Status: Confirmed, also carried forward as `C96-07`

Evidence:

- The checked-in nginx server block is bound to `server_name gallery.atik.kr` (`apps/web/nginx/default.conf:46-49`).
- The root README presents Docker support as a documented Linux host-network + reverse-proxy deployment, not only as the demo site's private template (`README.md:47-48`).
- The web README says the checked-in nginx is the documented host-side reverse-proxy topology (`apps/web/README.md:55-56`).
- The deferred register already tracks the needed operator-template pass: "nginx template parameterizes the demo domain" (`.context/plans/deferred-carry-forward.md:40-42`).

Failure scenario:

A self-host operator copies the shipped nginx config expecting it to be a reusable GalleryKit template. Requests for their real `Host` may fall through to another default server block, or the GalleryKit locations/body caps/rate limits may not apply to the intended virtual host. In a multi-site nginx, the wrong server block can silently serve or proxy the wrong application while repository tests still pass because they do not assert domain neutrality.

Concrete fix:

Make the committed template host-neutral (`server_name _;`) or template the hostname through deployment/operator config, and keep the demo domain in an untracked host-specific file. Add a source-contract test that fails if `apps/web/nginx/default.conf` contains `gallery.atik.kr` or another concrete production/demo hostname.

## Manual-Validation Risks

### ARCH-C6-R1 - Edge throttling depends on host-nginx application outside `npm run deploy`

Severity: Medium
Confidence: High for repo design, Medium for live production state
Status: Manual Validation

Evidence:

- The nginx template defines shared limiter zones for login, admin, public pages, and Next image optimization (`apps/web/nginx/default.conf:1-19`).
- The public page limiter is applied only in the catch-all location (`apps/web/nginx/default.conf:272-293`), while the image optimizer uses its own limiter (`apps/web/nginx/default.conf:252-261`).
- The architecture docs explicitly state that public SSR page throttling is an nginx-edge responsibility and per-iteration deploys do not touch host nginx (`CLAUDE.md:235-238`).
- The host-nginx runbook says committed template changes are inert in production until an operator applies and reloads nginx, then records burst-test evidence (`CLAUDE.md:483-495`).

Failure scenario:

The codebase can be green and recently deployed while the live edge still runs an older nginx config without `zone=public` or `zone=nextimage`. A crawler or image-enumeration client then bypasses the intended edge backstop and pushes dynamic SSR or Sharp image optimization work into the app. Conversely, an LB-fronted topology that misses the documented real-IP setup can collapse all visitors into one limiter bucket.

Concrete fix:

Do not close nginx architecture findings on commit alone. Attach operator evidence for `nginx -t`, reload time, active config identity/hash, and burst probes for `/` and `/_next/image` to the deploy ledger. Longer term, make deploy verify the live nginx config hash or manage the host nginx file as a first-class deploy artifact with explicit rollback.

### ARCH-C6-R2 - The storage abstraction remains a quarantined local-only layer beside direct filesystem pipeline code

Severity: Low-Medium
Confidence: High
Status: Manual Validation / architectural carry-forward (`C2-27`)

Evidence:

- `CLAUDE.md` warns that `@/lib/storage` exists but the product supports local filesystem storage only and S3/MinIO switching is not supported until upload/processing/serving are wired end-to-end (`CLAUDE.md:150`).
- The storage singleton repeats that production upload, processing, and serving paths still use direct filesystem code and do not read from the abstraction (`apps/web/src/lib/storage/index.ts:1-18`).
- The storage interface warns that live upload/processing/public-serving paths still use direct filesystem helpers (`apps/web/src/lib/storage/types.ts:1-16`).
- The Sharp processing module imports direct upload directories and filesystem APIs (`apps/web/src/lib/process-image.ts:1-12`).
- The deferred register keeps the product decision open: "wire or delete the storage abstraction" (`.context/plans/deferred-carry-forward.md:73-75`).

Failure scenario:

A future feature starts using `getStorage()` for one path, or documentation exposes backend switching, while uploads, derivative writes, original-file serving, cleanup, and backup/restore still use direct local paths. That creates split-brain storage: some objects move through the abstraction while public serving or cleanup still expects local files, causing missing derivatives, undeleted originals, or rollback gaps.

Concrete fix:

Keep the abstraction internal and explicitly local-only until a dedicated storage migration owns every boundary: original ingest, derivative generation, public/private serving, cleanup, backups, restore, health checks, and operator docs. If that project is not planned, delete or rename the abstraction to remove the future-backend signal.

## Cross-File Validations / Non-Findings

- Maintenance scheduling is no longer owned by image-queue bootstrap: instrumentation starts `startMaintenanceScheduler()` before queue bootstrap (`apps/web/src/instrumentation.ts:7-10`), the scheduler owns site-wide sweeps and its interval (`apps/web/src/lib/maintenance-scheduler.ts:21-37`), and image queue now keeps only queue-local retry-map pruning (`apps/web/src/lib/image-queue.ts:1233-1240`).
- Analytics fire-and-forget DB writes now have an explicit bounded queue: concurrency and pending caps are defined at `apps/web/src/lib/background-db-writes.ts:8-9`, enforced in `trackAnalyticsDbWrite()` (`apps/web/src/lib/background-db-writes.ts:42-74`), drained on shutdown (`apps/web/src/lib/background-db-writes.ts:77-84`), and used by public photo/topic/share analytics writes (`apps/web/src/app/actions/public.ts:450-457`, `apps/web/src/app/actions/public.ts:482-489`, `apps/web/src/app/actions/public.ts:518-525`).
- Feed/sitemap updated-order indexes are mirrored across schema, migration SQL, legacy reconcile, and journal: `apps/web/src/db/schema.ts:118-123`, `apps/web/drizzle/0029_feed_updated_indexes.sql:1-3`, `apps/web/scripts/migrate.js:703-707`, and `apps/web/drizzle/meta/_journal.json:208-214`.
- Browser and Lightroom upload paths now snapshot processing settings before enqueue: browser upload reads strict config and snapshots it (`apps/web/src/app/actions/images.ts:203-212`), persists the snapshot (`apps/web/src/app/actions/images.ts:480-488`), and passes quality/sizes plus the remaining processing settings into the queue (`apps/web/src/app/actions/images.ts:527-554`). Lightroom mirrors that with `createProcessingSettingsSnapshot(config)` (`apps/web/src/app/api/admin/lr/upload/route.ts:306-315`), persisted `processing_settings_json` (`apps/web/src/app/api/admin/lr/upload/route.ts:484-490`), and queue fields through color/caption metadata (`apps/web/src/app/api/admin/lr/upload/route.ts:528-565`).
- The queue type/deserialize/apply path accepts and applies the processing snapshot contract: snapshot type/creation (`apps/web/src/lib/image-queue.ts:154-181`), parse/apply (`apps/web/src/lib/image-queue.ts:217-239`), job fields (`apps/web/src/lib/image-queue.ts:270-297`), and worker consumption (`apps/web/src/lib/image-queue.ts:794-850`).

## Final Sweep

I swept the requested architectural axes: coupling/layering, service boundaries, DB/schema evolution, background jobs, media pipeline, frontend/backend contracts, deployment topology, storage boundary, and current carry-forward risks. I found no Critical or High architecture defects in this static pass. The remaining confirmed issues are contract/template risks, and the manual-validation items are operational boundaries that require host evidence rather than source edits alone.
