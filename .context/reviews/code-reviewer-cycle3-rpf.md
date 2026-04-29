# Code Review Report — cycle 3 / Prompt 1

**Role:** code-reviewer
**Repository:** `/Users/hletrd/flash-shared/gallery`
**Date:** 2026-04-29
**Scope:** entire repository code-quality, logic, SOLID/maintainability, data-flow, and cross-file interaction review.
**Implementation files edited:** none.

## Executive summary

I built a review inventory first, then read every inventoried file (299 files / 42,757 lines) excluding dependency/build/generated/runtime artifacts (`node_modules`, `.next`, generated uploads/binaries, `.omx`/`.omc` state, and prior `.context` review artifacts). I then did targeted cross-file passes through auth/origin/rate-limit flows, upload/processing/queue flows, public data privacy boundaries, admin mutations, restore/backup flows, CSP/proxying, i18n routing, test/lint guard scripts, Docker/nginx/deploy configuration, and migration/schema alignment.

**Findings:**

| ID | Status | Severity | Confidence | Summary |
| --- | --- | --- | --- | --- |
| C3-CODE-01 | Confirmed | High | High | TLS-edge nginx config overwrites `X-Forwarded-Proto` with `http`, which breaks same-origin checks and secure-cookie inference behind the deployment topology described in the file. |
| C3-CODE-02 | Confirmed | Medium | High | Upload and topic-image pipelines ignore EXIF orientation, so common phone portrait photos can be stored/rendered sideways with incorrect aspect ratios/dimensions. |
| C3-CODE-03 | Confirmed | Medium | High | EXIF/ICC text values are inserted into bounded MySQL `varchar` columns without column-length normalization, causing otherwise valid uploads to fail on long metadata. |
| C3-CODE-04 | Likely risk | Low | Medium | `getSharedGroupCached` wraps a function that mutates view-count state, making future call-site changes easy to undercount or overcount. |
| C3-CODE-05 | Likely risk | Low | Medium | CSV export has a `LIMIT 50000` without deterministic ordering, so large exports are unstable and truncation is arbitrary. |

No critical findings were identified in this pass. The repository already has strong protections in several areas: same-origin gates on mutating server actions, API admin auth scanning, public select-field privacy guards, SQL restore scanning, restore/upload locking, rate-limit pre-increment patterns, CSP nonce plumbing, and filename/path containment checks.

## Review inventory and coverage

- **Inventory source:** all review-relevant repository files, excluding `node_modules`, `.next`, generated artifacts, runtime state, binary uploads/fixtures/assets, and previous review artifacts.
- **Read audit:** 299 files, 42,757 lines.
- **Inventory groups:** root/config/docs 12; GitHub workflow/assets 3; app config/deploy/nginx/package 21; Drizzle schema/migrations 7; e2e 6; messages 2; scripts 17; `apps/web/src` 231.
- **Missed-issues sweep:** searched for dangerous patterns (`TODO/FIXME`, `eslint-disable`, `dangerouslySetInnerHTML`, `eval`/`Function`, storage/cookie access, direct env use, forwarded headers, LIKE query construction, origin/auth guards), then rechecked the high-risk flows named above.

## Verification performed

- `npm run lint` — **passed**.
- `npm run typecheck` — **passed**.
- `npm run lint:api-auth --workspace=apps/web` — **passed**.
- `npm run lint:action-origin --workspace=apps/web` — **passed**.
- `npm test --workspace=apps/web` — attempted after the static gates; the shared host was running dozens of concurrent Vitest workers from another workspace, and several gallery tests exceeded their default per-test timeouts before I stopped the run to avoid further contention. I did not use that interrupted run as evidence for or against the findings.

---

## Confirmed issues

### C3-CODE-01 — TLS-edge nginx config rewrites the trusted protocol to `http`

**Status:** Confirmed
**Severity:** High
**Confidence:** High

**Where:**

- `apps/web/nginx/default.conf:16-19` says this nginx server is intended to run behind a TLS-terminating edge/load balancer that forwards HTTPS requests to the local HTTP listener.
- `apps/web/nginx/default.conf:57`, `:74`, `:89`, and `:124` set `X-Forwarded-Proto` to `$scheme` for every proxied location.
- `apps/web/src/lib/request-origin.ts:45-68` trusts the right-most `x-forwarded-proto` value when `TRUST_PROXY=true` and uses it to build the expected origin.
- `apps/web/src/app/actions/auth.ts:91-95` rejects login when `hasTrustedSameOrigin()` does not match the browser `Origin`/`Referer`.
- `apps/web/src/app/actions/auth.ts:207-217` and `:386-390` also use the same trusted protocol to infer whether session cookies should be `Secure`.

**Failure scenario:**

In the deployment topology described by `default.conf`, the public browser request is `https://gallery.atik.kr`, the TLS edge forwards to this nginx listener over plain HTTP, and nginx sees `$scheme == http`. The current proxy config overwrites any upstream `X-Forwarded-Proto: https` with `http`. With `TRUST_PROXY=true`, the app expects `http://gallery.atik.kr`, while the browser sends `Origin: https://gallery.atik.kr`; admin login and mutating server actions fail the same-origin check with a generic auth/unauthorized error. The same misread protocol can also make cookie security decisions disagree with the real public scheme outside production-like settings.

**Concrete fix:**

Preserve the edge-supplied protocol instead of overwriting it. For example, define an nginx `map` that uses a valid incoming `$http_x_forwarded_proto` (`http`/`https`) when present and falls back to `$scheme`, then set `X-Forwarded-Proto` to that mapped value in every proxy location. Alternatively, if this nginx instance terminates TLS itself, add the documented 443 server block and keep `$scheme`. Add an origin-guard deployment test that simulates `Origin: https://host` plus `X-Forwarded-Proto: https` through the nginx config.

---

### C3-CODE-02 — Image pipelines ignore EXIF orientation

**Status:** Confirmed
**Severity:** Medium
**Confidence:** High

**Where:**

- `apps/web/src/lib/process-image.ts:262-287` reads Sharp metadata directly and stores `metadata.width` / `metadata.height` as the gallery dimensions.
- `apps/web/src/lib/process-image.ts:389-478` builds AVIF/WebP/JPEG variants with `sharp(inputPath)` and `image.clone().resize(...)` but never calls Sharp auto-orientation (`rotate()`/`autoOrient()`).
- `apps/web/src/lib/process-topic-image.ts:68-71` resizes topic images without auto-orientation as well.
- `apps/web/src/components/home-client.tsx:197-200`, `apps/web/src/components/photo-viewer.tsx:216-221`, and `apps/web/src/components/photo-viewer.tsx:241-248` use the stored dimensions to drive aspect ratio and rendered image dimensions.

**Failure scenario:**

A common phone portrait JPEG can store landscape pixel data plus EXIF `Orientation=6/8`. Sharp does not apply that orientation unless the pipeline asks it to. The upload code therefore stores raw dimensions, generates unrotated derivatives, and renders cards/viewers using the raw aspect ratio. The visible result is a sideways portrait photo, wrong masonry placeholder/aspect ratio, wrong OG dimensions, and misleading displayed dimensions in the photo info panel. Topic cover images have the same risk and can be cropped from the wrong orientation.

**Concrete fix:**

Normalize orientation once in the processing boundary. Use Sharp auto-orientation before resize/blur/variant generation, and store oriented dimensions (`metadata.autoOrient` in Sharp 0.34 metadata, or metadata from an oriented clone) as `width`/`height` while preserving raw dimensions in `original_width`/`original_height` if needed. Apply the same orientation step in `processTopicImage()`. Add a regression fixture with an EXIF-orientation portrait JPEG and assert stored dimensions plus derivative output dimensions/orientation.

---

### C3-CODE-03 — EXIF/ICC strings are not normalized to DB column limits

**Status:** Confirmed
**Severity:** Medium
**Confidence:** High

**Where:**

- `apps/web/src/lib/process-image.ts:317-340` can extract an ICC profile description up to 1024 characters into `iccProfileName`.
- `apps/web/src/lib/process-image.ts:496-504` defines `cleanString()` with trimming only; it does not cap length or strip control characters.
- `apps/web/src/lib/process-image.ts:549-556` returns `camera_model`, `lens_model`, and `exposure_time` directly from `cleanString()`.
- `apps/web/src/app/actions/images.ts:288-316` spreads those EXIF values, plus `color_space: data.iccProfileName || exifDb.color_space`, into the `images` insert.
- `apps/web/src/db/schema.ts:34-47` bounds those destination columns (`camera_model`, `lens_model`, `exposure_time`, `color_space`, `white_balance`, `metering_mode`, `exposure_program`, `flash`) to `varchar(20..255)`.

**Failure scenario:**

A valid image with an unusually long camera model/lens string or ICC profile description can pass image validation and original-file save, then fail at the DB insert because a metadata string exceeds the destination `varchar` length. The catch path deletes the saved original and records the upload as failed, so an otherwise usable image is rejected because optional metadata was not bounded at the ingestion boundary.

**Concrete fix:**

Add a single EXIF-to-DB normalization helper, e.g. `cleanDbString(value, maxChars)`, that trims, strips control characters, rejects Unicode formatting where appropriate, and truncates or nulls values based on the schema column limit. Apply it to every string returned by `extractExifForDb()` and to `iccProfileName` before it is assigned to `color_space`. Add unit tests with overlong EXIF and ICC profile strings to assert the upload path stores a bounded/null metadata value instead of failing insertion.

---

## Likely risks / maintainability concerns

### C3-CODE-04 — Cached shared-group getter contains a view-count side effect

**Status:** Likely risk
**Severity:** Low
**Confidence:** Medium

**Where:**

- `apps/web/src/lib/data.ts:844-848` buffers a shared-group view count from inside `getSharedGroup()`.
- `apps/web/src/lib/data.ts:1037` exports `getSharedGroupCached = cache(getSharedGroup)`.
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:37` calls the cached function from metadata with `{ incrementViewCount: false }`, while `:103` calls it from the page with default incrementing behavior.

**Failure scenario:**

Current call sites avoid the obvious metadata overcount by passing `incrementViewCount: false`, but the cached export still mixes React render-cache semantics with mutation. A future component that calls `getSharedGroupCached(key)` in the same render tree can silently dedupe the side effect, while a future metadata call that omits the options object can count crawler/metadata fetches. That makes view-count behavior depend on render-call topology rather than an explicit mutation boundary.

**Concrete fix:**

Split the pure data read from the side effect: cache only `getSharedGroupData(key)` and call a separate `recordSharedGroupView(group.id)` exactly once in the page request path. Keep metadata on the pure reader. This makes count semantics explicit and keeps React cache safe for data-only work.

---

### C3-CODE-05 — CSV export truncation is not deterministic

**Status:** Likely risk
**Severity:** Low
**Confidence:** Medium

**Where:**

- `apps/web/src/app/[locale]/admin/db-actions.ts:77-92` selects up to 50,000 image rows for CSV export and applies `.limit(50000)` without any `orderBy`.

**Failure scenario:**

MySQL does not guarantee row order without `ORDER BY`. On galleries near or above the export cap, repeated exports can include a different subset/order depending on execution plan, inserts, deletes, or index changes. That makes CSV backups hard to diff and makes the `csvTruncated` warning less actionable because the truncated tail is arbitrary.

**Concrete fix:**

Choose and document a stable export order, e.g. `orderBy(asc(images.id))` for insertion-order reproducibility or the same chronological order used by the gallery. Apply that ordering before `.limit(50000)` and add a unit/SQL-shape test that locks the ordering.

---

## Final missed-issues sweep

I rechecked the highest-risk interactions after drafting findings:

- **Auth/origin:** mutating server actions call `requireSameOriginAdmin()` or equivalent; API admin DB download is wrapped in `withAdminAuth()` and has an origin check. The remaining issue is the nginx forwarded-proto deployment mismatch (C3-CODE-01), not missing action guards.
- **Public data privacy:** public select fields omit latitude/longitude/original filename/user filename and have compile-time guard types; share/group pages use public field sets.
- **Upload/delete/restore flow:** upload and restore use maintenance checks and advisory locks; delete validates filenames and reports cleanup failures. Orientation and metadata-length ingestion issues remain.
- **SQL/restore:** restore input is size/header checked and scanned for dangerous SQL before invoking `mysql`; backup download has filename and realpath containment checks.
- **CSP/JSON-LD:** JSON-LD uses `safeJsonLd()` before `dangerouslySetInnerHTML`; production CSP nonce is passed through middleware/layout.
- **Rate limits:** login, password update, share creation, user creation, search, load-more, and OG generation use pre-increment or bounded in-memory limit patterns.

## Full review-relevant inventory

The following inventory was examined; line counts are from the read audit.

```text
.agent/rules/commit-and-push.md	5
.dockerignore	22
.env.deploy.example	14
.github/assets/logo.svg	8
.github/dependabot.yml	19
.github/workflows/quality.yml	79
.gitignore	22
.nvmrc	1
AGENTS.md	4
CLAUDE.md	293
LICENSE	191
README.md	197
apps/web/.dockerignore	17
apps/web/.env.local.example	63
apps/web/.gitignore	50
apps/web/Dockerfile	90
apps/web/README.md	46
apps/web/components.json	22
apps/web/deploy.sh	34
apps/web/docker-compose.yml	25
apps/web/drizzle.config.ts	13
apps/web/drizzle/0000_nappy_madelyne_pryor.sql	79
apps/web/drizzle/0001_sync_current_schema.sql	81
apps/web/drizzle/0002_fix_processed_default.sql	1
apps/web/drizzle/0003_audit_created_at_index.sql	1
apps/web/drizzle/meta/0000_snapshot.json	536
apps/web/drizzle/meta/0001_snapshot.json	990
apps/web/drizzle/meta/_journal.json	34
apps/web/e2e/admin.spec.ts	90
apps/web/e2e/helpers.ts	200
apps/web/e2e/nav-visual-check.spec.ts	41
apps/web/e2e/origin-guard.spec.ts	88
apps/web/e2e/public.spec.ts	119
apps/web/e2e/test-fixes.spec.ts	70
apps/web/eslint.config.mjs	21
apps/web/messages/en.json	567
apps/web/messages/ko.json	567
apps/web/next-env.d.ts	6
apps/web/next.config.ts	86
apps/web/nginx/default.conf	130
apps/web/package.json	75
apps/web/playwright.config.ts	80
apps/web/postcss.config.mjs	8
apps/web/scripts/check-action-origin.ts	345
apps/web/scripts/check-api-auth.ts	178
apps/web/scripts/check-js-scripts.mjs	42
apps/web/scripts/ensure-site-config.mjs	43
apps/web/scripts/entrypoint.sh	39
apps/web/scripts/init-db.ts	35
apps/web/scripts/migrate-admin-auth.ts	77
apps/web/scripts/migrate-aliases.ts	31
apps/web/scripts/migrate-capture-date.js	82
apps/web/scripts/migrate-titles.ts	34
apps/web/scripts/migrate.js	556
apps/web/scripts/migration-add-column.ts	21
apps/web/scripts/mysql-connection-options.js	28
apps/web/scripts/prepare-next-typegen.mjs	32
apps/web/scripts/run-e2e-server.mjs	117
apps/web/scripts/seed-admin.ts	76
apps/web/scripts/seed-e2e.ts	268
apps/web/src/__tests__/action-guards.test.ts	81
apps/web/src/__tests__/admin-user-create-ordering.test.ts	145
apps/web/src/__tests__/admin-users.test.ts	178
apps/web/src/__tests__/auth-rate-limit-ordering.test.ts	139
apps/web/src/__tests__/auth-rate-limit.test.ts	103
apps/web/src/__tests__/auth-rethrow.test.ts	53
apps/web/src/__tests__/backup-download-route.test.ts	160
apps/web/src/__tests__/backup-filename.test.ts	19
apps/web/src/__tests__/base56.test.ts	56
apps/web/src/__tests__/blur-data-url.test.ts	207
apps/web/src/__tests__/check-action-origin.test.ts	315
apps/web/src/__tests__/check-api-auth.test.ts	124
apps/web/src/__tests__/client-source-contracts.test.ts	35
apps/web/src/__tests__/clipboard.test.ts	122
apps/web/src/__tests__/content-security-policy.test.ts	56
apps/web/src/__tests__/csv-escape.test.ts	132
apps/web/src/__tests__/data-pagination.test.ts	30
apps/web/src/__tests__/data-tag-names-sql.test.ts	174
apps/web/src/__tests__/data-view-count-flush.test.ts	179
apps/web/src/__tests__/db-pool-connection-handler.test.ts	68
apps/web/src/__tests__/db-restore.test.ts	33
apps/web/src/__tests__/error-shell.test.ts	32
apps/web/src/__tests__/exif-datetime.test.ts	45
apps/web/src/__tests__/gallery-config-shared.test.ts	64
apps/web/src/__tests__/health-route.test.ts	70
apps/web/src/__tests__/histogram.test.ts	60
apps/web/src/__tests__/image-queue-bootstrap.test.ts	194
apps/web/src/__tests__/image-queue.test.ts	112
apps/web/src/__tests__/image-url.test.ts	34
apps/web/src/__tests__/images-action-blur-wiring.test.ts	49
apps/web/src/__tests__/images-actions.test.ts	293
apps/web/src/__tests__/images-delete-revalidation.test.ts	25
apps/web/src/__tests__/lightbox.test.ts	12
apps/web/src/__tests__/live-route.test.ts	12
apps/web/src/__tests__/load-more-rate-limit.test.ts	183
apps/web/src/__tests__/locale-path.test.ts	95
apps/web/src/__tests__/mysql-cli-ssl.test.ts	21
apps/web/src/__tests__/next-config.test.ts	27
apps/web/src/__tests__/og-rate-limit.test.ts	60
apps/web/src/__tests__/photo-title.test.ts	108
apps/web/src/__tests__/privacy-fields.test.ts	62
apps/web/src/__tests__/process-image-blur-wiring.test.ts	47
apps/web/src/__tests__/process-image-dimensions.test.ts	137
apps/web/src/__tests__/process-image-variant-scan.test.ts	85
apps/web/src/__tests__/public-actions.test.ts	248
apps/web/src/__tests__/queue-shutdown.test.ts	53
apps/web/src/__tests__/rate-limit.test.ts	237
apps/web/src/__tests__/request-origin.test.ts	144
apps/web/src/__tests__/restore-maintenance.test.ts	53
apps/web/src/__tests__/restore-upload-lock.test.ts	18
apps/web/src/__tests__/revalidation.test.ts	78
apps/web/src/__tests__/safe-json-ld.test.ts	57
apps/web/src/__tests__/sanitize.test.ts	73
apps/web/src/__tests__/seo-actions.test.ts	139
apps/web/src/__tests__/serve-upload.test.ts	75
apps/web/src/__tests__/session.test.ts	44
apps/web/src/__tests__/settings-image-sizes-lock.test.ts	23
apps/web/src/__tests__/share-key-length.test.ts	14
apps/web/src/__tests__/shared-page-title.test.ts	137
apps/web/src/__tests__/sql-restore-scan.test.ts	112
apps/web/src/__tests__/storage-local.test.ts	38
apps/web/src/__tests__/tag-input.test.ts	34
apps/web/src/__tests__/tag-label-consolidation.test.ts	128
apps/web/src/__tests__/tag-records.test.ts	19
apps/web/src/__tests__/tag-slugs.test.ts	39
apps/web/src/__tests__/tags-actions.test.ts	178
apps/web/src/__tests__/topics-actions.test.ts	346
apps/web/src/__tests__/touch-target-audit.test.ts	608
apps/web/src/__tests__/upload-dropzone.test.ts	19
apps/web/src/__tests__/upload-limits.test.ts	65
apps/web/src/__tests__/upload-tracker.test.ts	76
apps/web/src/__tests__/validation.test.ts	260
apps/web/src/app/[locale]/(public)/[topic]/page.tsx	204
apps/web/src/app/[locale]/(public)/g/[key]/page.tsx	202
apps/web/src/app/[locale]/(public)/layout.tsx	24
apps/web/src/app/[locale]/(public)/p/[id]/page.tsx	263
apps/web/src/app/[locale]/(public)/page.tsx	193
apps/web/src/app/[locale]/(public)/s/[key]/page.tsx	132
apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts	10
apps/web/src/app/[locale]/admin/(protected)/categories/page.tsx	15
apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx	343
apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx	77
apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx	38
apps/web/src/app/[locale]/admin/(protected)/db/page.tsx	246
apps/web/src/app/[locale]/admin/(protected)/error.tsx	39
apps/web/src/app/[locale]/admin/(protected)/layout.tsx	18
apps/web/src/app/[locale]/admin/(protected)/loading.tsx	14
apps/web/src/app/[locale]/admin/(protected)/password/page.tsx	13
apps/web/src/app/[locale]/admin/(protected)/password/password-client.tsx	23
apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx	114
apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx	22
apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx	180
apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx	24
apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx	191
apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx	14
apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx	165
apps/web/src/app/[locale]/admin/(protected)/users/page.tsx	25
apps/web/src/app/[locale]/admin/db-actions.ts	522
apps/web/src/app/[locale]/admin/layout.tsx	29
apps/web/src/app/[locale]/admin/login-form.tsx	110
apps/web/src/app/[locale]/admin/page.tsx	16
apps/web/src/app/[locale]/error.tsx	39
apps/web/src/app/[locale]/globals.css	169
apps/web/src/app/[locale]/layout.tsx	134
apps/web/src/app/[locale]/loading.tsx	14
apps/web/src/app/[locale]/not-found.tsx	54
apps/web/src/app/actions.ts	30
apps/web/src/app/actions/admin-users.ts	264
apps/web/src/app/actions/auth.ts	431
apps/web/src/app/actions/images.ts	743
apps/web/src/app/actions/public.ts	168
apps/web/src/app/actions/seo.ts	177
apps/web/src/app/actions/settings.ts	174
apps/web/src/app/actions/sharing.ts	391
apps/web/src/app/actions/tags.ts	432
apps/web/src/app/actions/topics.ts	496
apps/web/src/app/api/admin/db/download/route.ts	108
apps/web/src/app/api/health/route.ts	43
apps/web/src/app/api/live/route.ts	10
apps/web/src/app/api/og/route.tsx	206
apps/web/src/app/apple-icon.tsx	40
apps/web/src/app/global-error.tsx	83
apps/web/src/app/icon.tsx	45
apps/web/src/app/manifest.ts	30
apps/web/src/app/robots.ts	19
apps/web/src/app/sitemap.ts	77
apps/web/src/app/uploads/[...path]/route.ts	10
apps/web/src/components/admin-header.tsx	30
apps/web/src/components/admin-nav.tsx	46
apps/web/src/components/admin-user-manager.tsx	192
apps/web/src/components/footer.tsx	56
apps/web/src/components/histogram.tsx	332
apps/web/src/components/home-client.tsx	320
apps/web/src/components/i18n-provider.tsx	19
apps/web/src/components/image-manager.tsx	505
apps/web/src/components/image-zoom.tsx	151
apps/web/src/components/info-bottom-sheet.tsx	411
apps/web/src/components/lazy-focus-trap.tsx	10
apps/web/src/components/lightbox.tsx	392
apps/web/src/components/load-more.tsx	125
apps/web/src/components/nav-client.tsx	166
apps/web/src/components/nav.tsx	14
apps/web/src/components/optimistic-image.tsx	82
apps/web/src/components/photo-navigation.tsx	241
apps/web/src/components/photo-viewer-loading.tsx	24
apps/web/src/components/photo-viewer.tsx	654
apps/web/src/components/search.tsx	300
apps/web/src/components/tag-filter.tsx	105
apps/web/src/components/tag-input.tsx	252
apps/web/src/components/theme-provider.tsx	11
apps/web/src/components/topic-empty-state.tsx	24
apps/web/src/components/ui/alert-dialog.tsx	157
apps/web/src/components/ui/alert.tsx	66
apps/web/src/components/ui/aspect-ratio.tsx	11
apps/web/src/components/ui/badge.tsx	46
apps/web/src/components/ui/button.tsx	62
apps/web/src/components/ui/card.tsx	92
apps/web/src/components/ui/dialog.tsx	145
apps/web/src/components/ui/dropdown-menu.tsx	257
apps/web/src/components/ui/input.tsx	21
apps/web/src/components/ui/label.tsx	24
apps/web/src/components/ui/progress.tsx	26
apps/web/src/components/ui/scroll-area.tsx	58
apps/web/src/components/ui/select.tsx	190
apps/web/src/components/ui/separator.tsx	32
apps/web/src/components/ui/sheet.tsx	141
apps/web/src/components/ui/skeleton.tsx	13
apps/web/src/components/ui/sonner.tsx	40
apps/web/src/components/ui/switch.tsx	31
apps/web/src/components/ui/table.tsx	116
apps/web/src/components/ui/textarea.tsx	18
apps/web/src/components/upload-dropzone.tsx	492
apps/web/src/db/index.ts	90
apps/web/src/db/schema.ts	143
apps/web/src/db/seed.ts	13
apps/web/src/i18n/request.ts	15
apps/web/src/instrumentation.ts	36
apps/web/src/lib/action-guards.ts	44
apps/web/src/lib/action-result.ts	4
apps/web/src/lib/api-auth.ts	27
apps/web/src/lib/audit.ts	62
apps/web/src/lib/auth-rate-limit.ts	93
apps/web/src/lib/backup-filename.ts	12
apps/web/src/lib/base56.ts	41
apps/web/src/lib/blur-data-url.ts	120
apps/web/src/lib/bounded-map.ts	132
apps/web/src/lib/clipboard.ts	43
apps/web/src/lib/constants.ts	14
apps/web/src/lib/content-security-policy.ts	91
apps/web/src/lib/csp-nonce.ts	9
apps/web/src/lib/csv-escape.ts	64
apps/web/src/lib/data.ts	1078
apps/web/src/lib/db-restore.ts	34
apps/web/src/lib/error-shell.ts	49
apps/web/src/lib/exif-datetime.ts	78
apps/web/src/lib/gallery-config-shared.ts	154
apps/web/src/lib/gallery-config.ts	101
apps/web/src/lib/image-queue.ts	503
apps/web/src/lib/image-types.ts	78
apps/web/src/lib/image-url.ts	48
apps/web/src/lib/locale-path.ts	95
apps/web/src/lib/mysql-cli-ssl.ts	16
apps/web/src/lib/photo-title.ts	95
apps/web/src/lib/process-image.ts	623
apps/web/src/lib/process-topic-image.ts	106
apps/web/src/lib/queue-shutdown.ts	37
apps/web/src/lib/rate-limit.ts	296
apps/web/src/lib/request-origin.ts	107
apps/web/src/lib/restore-maintenance.ts	56
apps/web/src/lib/revalidation.ts	57
apps/web/src/lib/safe-json-ld.ts	19
apps/web/src/lib/sanitize.ts	28
apps/web/src/lib/seo-og-url.ts	30
apps/web/src/lib/serve-upload.ts	115
apps/web/src/lib/session.ts	145
apps/web/src/lib/sql-restore-scan.ts	130
apps/web/src/lib/storage/index.ts	146
apps/web/src/lib/storage/local.ts	139
apps/web/src/lib/storage/types.ts	105
apps/web/src/lib/tag-records.ts	69
apps/web/src/lib/tag-slugs.ts	49
apps/web/src/lib/upload-limits.ts	31
apps/web/src/lib/upload-paths.ts	103
apps/web/src/lib/upload-processing-contract-lock.ts	75
apps/web/src/lib/upload-tracker-state.ts	61
apps/web/src/lib/upload-tracker.ts	33
apps/web/src/lib/utils.ts	6
apps/web/src/lib/validation.ts	117
apps/web/src/proxy.ts	107
apps/web/src/site-config.example.json	11
apps/web/src/site-config.json	11
apps/web/tailwind.config.ts	64
apps/web/tsconfig.json	43
apps/web/tsconfig.scripts.json	16
apps/web/tsconfig.typecheck.json	18
apps/web/vitest.config.ts	13
package-lock.json	7529
package.json	23
scripts/deploy-remote.sh	64
```
