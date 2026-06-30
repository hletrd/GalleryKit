# Cycle 33 Aggregate Review

Cycle: 33/100
Date: 2026-06-30 KST
Reviewed HEAD: `a21d053e`

## Agent Coverage

Completed review artifacts:

- `code-reviewer.md`
- `perf-reviewer.md`
- `security-reviewer.md`
- `test-engineer.md`
- `architect-debugger.md`
- `designer.md`
- `document-specialist.md`
- `critic-verifier.md`
- `tracer.md`

No agent failures were recorded. The locally installed reviewer prompt files `product-marketer-reviewer.md` and `ui-ux-designer-reviewer.md` are BurstPick-specific and were not treated as GalleryKit reviewer roles; the GalleryKit UI review was covered by `designer.md`.

## Merged Findings

### AGG-C33-01 - Bulk apply-suggested-alt bypasses metadata sanitization and length checks

Severity: Medium
Confidence: High
Agents: code-reviewer, critic/verifier

Regions: `apps/web/src/app/actions/images.ts:1102-1147`, `apps/web/src/lib/sanitize.ts:161-190`, `apps/web/src/db/schema.ts:82-86`, `apps/web/src/__tests__/bulk-update-images.test.ts:471-518`

Applying `alt_text_suggested` into `title` or `description` only strips the stub prefix and Unicode formatting, then writes the value directly. It does not run `sanitizeAdminString()` or enforce the target field limits. A restored or future-produced suggestion with C0/C1 controls or an overlong title can violate the admin metadata invariant or fail/truncate at MySQL write time.

Fix: sanitize copied suggestions with the same target-field contract as manual metadata updates and add tests for controls, Unicode formatting, overlong title/description, and valid-row behavior.

### AGG-C33-02 - Lightroom/PAT upload buffers full multipart bodies before serialization

Severity: High
Confidence: High
Agents: perf-reviewer, critic/verifier

Regions: `apps/web/src/app/api/admin/lr/upload/route.ts:153-167`, `apps/web/src/app/api/admin/lr/upload/route.ts:225-259`, `apps/web/nginx/default.conf:124-145`, `apps/web/docker-compose.yml:12-28`

The LR/PAT upload route calls `request.formData()` for up to 216 MiB bodies before app-level serialization and before the existing disk/processing lock. Several concurrent authenticated uploads can therefore materialize large bodies in the Next.js process before any single-flight protection applies.

Fix: stream multipart uploads or add a pre-parse semaphore/lock that bounds concurrent body materialization, then add tests/source contracts around the bounded path.

### AGG-C33-03 - Public route rate-limit scanner misses non-`/api` route handlers

Severity: Medium
Confidence: High
Agents: test-engineer, critic/verifier

Regions: `apps/web/scripts/check-public-route-rate-limit.ts:25-85`, `apps/web/src/app/feed.xml/route.ts:41-53`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:41-78`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:739-744`

The scanner only discovers `src/app/api/**/route.*`, while public route handlers outside `/api` can do expensive GET work. Future route handlers outside `/api` can ship without a limiter or explicit exemption.

Fix: discover all `src/app/**/route.*` files, classify/exclude private/admin surfaces explicitly, and add fixture tests for root and localized feed route shapes.

### AGG-C33-04 - `auth.ts` mutating server actions are excluded from origin-gate linting

Severity: High
Confidence: High
Agents: test-engineer, critic/verifier

Regions: `apps/web/scripts/check-action-origin.ts:13-19`, `apps/web/scripts/check-action-origin.ts:49-73`, `apps/web/src/__tests__/check-action-origin.test.ts:493-503`, `apps/web/src/app/actions/auth.ts:95-99`, `apps/web/src/app/actions/auth.ts:264-299`

Current auth mutators are manually same-origin guarded, but the lint gate intentionally skips `auth.ts`. A future auth mutation could omit the manual guard and still pass `lint:action-origin`.

Fix: include `auth.ts` with an auth-specific approved guard detector or add a dedicated auth-action scanner.

### AGG-C33-05 - Lightroom upload route parity is mostly source-locked, not behavior-locked

Severity: Medium
Confidence: High
Agents: test-engineer, critic/verifier

Regions: `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-172`, `apps/web/src/app/api/admin/lr/upload/route.ts:194-547`

The LR upload tests mainly verify imports and source strings. They do not execute representative `POST` branches, so cleanup ordering, tracker settlement, status codes, and browser-upload parity can regress while source-grep tests remain green.

Fix: add mocked route-level tests for representative validation, cleanup, quota, lock, and success branches.

### AGG-C33-06 - Feed conditional tests cover dead helper behavior instead of live route ETag semantics

Severity: Low
Confidence: High
Agents: test-engineer, critic/verifier

Regions: `apps/web/src/lib/feed-conditional.ts:1-42`, `apps/web/src/__tests__/feed-conditional.test.ts:1-66`, `apps/web/src/app/feed.xml/route.ts:151-180`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:158-187`

`feed-conditional.ts` remains tested, but live feed routes use inline content ETags and no longer call the helper. The tests can pass while live 200/304 behavior regresses.

Fix: delete the dead helper/test or replace with executable route tests for matching and stale `If-None-Match` behavior.

### AGG-C33-07 - Caption stub truncates by UTF-16 code units

Severity: Low
Confidence: Medium
Agents: code-reviewer, critic/verifier

Regions: `apps/web/src/lib/caption-generator.ts:29-38`, `apps/web/src/__tests__/caption-generator.test.ts:1-65`

The stub uses `.slice(0, ALT_TEXT_MAX_CHARS)`, which can split surrogate pairs and persist malformed suggestion text.

Fix: truncate by code points and test a boundary supplementary character.

### AGG-C33-08 - Bulk image update caps raw IDs before de-duplicating

Severity: Low
Confidence: High
Agents: code-reviewer, critic/verifier

Regions: `apps/web/src/app/actions/images.ts:997-1008`

Payloads with more than 100 entries but no more than 100 unique IDs are rejected as `tooManyImages`.

Fix: validate ID shape, de-duplicate, then apply the mutation-count cap to unique IDs.

### AGG-C33-09 - Initial public listings still pay full grouped window counts

Severity: Medium
Confidence: High
Agents: perf-reviewer

Regions: `apps/web/src/lib/data.ts:898-927`, `apps/web/src/lib/data.ts:1466-1481`, public home/topic/smart collection pages

Dynamic public listing pages fetch `pageSize + 1` but also compute `COUNT(*) OVER()` across the grouped result. Large galleries and smart collections can make first-page SSR expensive.

Fix: remove exact total counts from critical first-page queries or compute counts separately behind cache/invalidation.

### AGG-C33-10 - Timeline and On This Day queries are non-sargable

Severity: Low
Confidence: High
Agents: perf-reviewer

Regions: `apps/web/src/lib/data-timeline.ts:97-117`, `apps/web/src/lib/data-timeline.ts:129-145`, `apps/web/src/lib/data-timeline.ts:186-207`

`MONTH()`, `DAY()`, and `YEAR()` filters prevent efficient use of capture-date indexes.

Fix: use range predicates where possible and plan generated/indexed date-part columns for larger galleries.

### AGG-C33-11 - GPS stripping reads full originals into memory

Severity: Low
Confidence: High
Agents: perf-reviewer

Regions: `apps/web/src/lib/process-image.ts:1737-1816`, browser and PAT upload callers

The upload path streams originals to disk, then privacy-mode GPS stripping reads the full saved file and may hold another output buffer.

Fix: move stripping toward streaming/range-based processing or bound the privacy-mode branch with a smaller cap/semaphore.

### AGG-C33-12 - Grid JPEG fallback can fetch base JPEGs for thumbnails

Severity: Low
Confidence: Medium
Agents: perf-reviewer

Regions: `apps/web/src/components/grid-picture.tsx:30-50`, `apps/web/src/components/grid-picture-fallback-boundary.tsx:14-26`

The masonry grid has AVIF/WebP `srcSet`s but the fallback `img src` is the base JPEG, so constrained or fallback browsers can pull large base JPEGs for tiles.

Fix: add a JPEG `srcSet` and make the fallback `src` a small derivative for processed rows.

### AGG-C33-13 - CI does not build the production Docker image

Severity: Medium
Confidence: High
Agents: architect/debugger

Regions: `.github/workflows/quality.yml:48-80`, `apps/web/Dockerfile:49-61`, `package-lock.json`

CI runs app build/tests but not the Dockerfile production build that manually installs native package pins. Dependency updates can pass CI and fail at deploy image build/runtime.

Fix: add a CI Docker build or lockfile assertion for Dockerfile native pins.

### AGG-C33-14 - Semantic/similar search silently misses older photos beyond the scan window

Severity: Medium
Confidence: High
Agents: architect/debugger

Regions: `apps/web/src/lib/clip-embeddings.ts:36-44`, `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`

Semantic routes scan only newest embeddings up to `SEMANTIC_SCAN_LIMIT`; older relevant photos cannot rank when the corpus exceeds the cap.

Fix: add operator-visible saturation warning/metrics now, and plan a vector index/ANN boundary before presenting search as corpus-wide at scale.

### AGG-C33-15 - Advisory lock names are globally scoped to a MySQL server

Severity: Low
Confidence: High
Agents: architect/debugger

Regions: `apps/web/src/lib/advisory-locks.ts:8-47`

Fixed lock names can serialize independent GalleryKit databases on the same MySQL server.

Fix: namespace through an instance identifier or assert the documented one-GalleryKit-per-MySQL-server topology.

### AGG-C33-16 - Optional DB health probe is unauthenticated and unthrottled

Severity: Low
Confidence: Medium
Agents: architect/debugger

Regions: `apps/web/src/app/api/health/route.ts:7-31`, `apps/web/src/__tests__/health-route.test.ts:42-69`

When `HEALTH_CHECK_DB=true`, public `/api/health` does a DB probe on every request.

Fix: keep it network-restricted, add a tiny TTL cache, or rate-limit the DB-aware branch.

### AGG-C33-17 - Root-equivalent admins widen compromise blast radius

Severity: Medium
Confidence: High
Agents: security-reviewer

Regions: `apps/web/src/app/actions/admin-users.ts:77-204`, `apps/web/src/app/[locale]/admin/db-actions.ts:164-372`, `apps/web/src/app/api/admin/db/download/route.ts:21-29`

Any admin can manage other admins, backup/restore, and download SQL backups.

Fix: add capability-scoped roles or fresh re-auth for highly sensitive operations, plus audit visibility/notifications.

### AGG-C33-18 - Restore accepts sensitive auth/session/token table state

Severity: Medium
Confidence: High
Agents: security-reviewer

Regions: `apps/web/src/lib/sql-restore-scan.ts:12-251`, `apps/web/src/app/[locale]/admin/db-actions.ts:570-744`

Scanner-compliant SQL can rewrite `admin_users`, `sessions`, and `admin_tokens`.

Fix: treat restore as a separate recovery privilege, sign backups, preview sensitive-table changes, and invalidate sessions/PATs after restore by default.

### AGG-C33-19 - Process-local limits depend on single-instance deployment

Severity: Low
Confidence: High
Agents: security-reviewer

Regions: `apps/web/src/lib/rate-limit.ts:74-375`, `apps/web/docker-compose.yml:3-22`

Several public/PAT rate limits are in-memory and reset or multiply under multi-instance deployment.

Fix: keep the single-instance invariant explicit or move those counters to shared storage before horizontal scaling.

### AGG-C33-20 - Plaintext SQL backups rely on host/operator controls

Severity: Low
Confidence: High
Agents: security-reviewer

Regions: `apps/web/src/app/[locale]/admin/db-actions.ts:185-332`, `apps/web/src/app/api/admin/db/download/route.ts:21-90`

Backup files are permissioned and admin-gated but remain plaintext SQL at rest.

Fix: encrypt dumps at rest or immediately after creation and add retention/pruning guidance.

### AGG-C33-21 - Admin login falls to generic error shell during auth DB outages

Severity: Medium
Confidence: High
Agents: designer

Regions: `apps/web/src/app/[locale]/admin/layout.tsx:14`, `apps/web/src/app/[locale]/admin/page.tsx:14`, `apps/web/src/app/actions/auth.ts:37-46`

The admin layout probes the current user before rendering login, so a DB outage shows a generic route error instead of an intelligible auth-unavailable login state.

Fix: keep login renderable when pre-login session probing fails or catch infrastructure errors and show a blocking unavailable alert.

### AGG-C33-22 - Settings validation does not focus or summarize invalid fields

Severity: Low
Confidence: High
Agents: designer

Regions: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:230-235`, field validation sections

Save returns after a toast; focus remains on Save while the invalid field can be far below.

Fix: focus/scroll the first invalid input or render a persistent error summary with links.

### AGG-C33-23 - One-time upload-token copy lacks clipboard fallback

Severity: Low
Confidence: High
Agents: designer

Regions: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:88-95`, `apps/web/src/lib/clipboard.ts:1-43`

The one-time plaintext token dialog uses `navigator.clipboard.writeText()` directly instead of the existing fallback helper.

Fix: use `copyToClipboard()` and gate acknowledgement behavior around successful copy or explicit manual acknowledgement.

### AGG-C33-24 - Mobile home tag filter can consume the first viewport

Severity: Medium
Confidence: Medium
Agents: designer

Regions: `apps/web/src/components/home-client.tsx:257-287`, `apps/web/src/components/tag-filter.tsx:63-88`

Large tag sets render before the photo grid and can make the first mobile viewport feel like taxonomy instead of photography.

Fix: collapse/cap/scroll tag chips on small screens while keeping active filters visible.

### AGG-C33-25 - Schema comment misstates alt-text precedence

Severity: Low
Confidence: High
Agents: document-specialist

Regions: `apps/web/src/db/schema.ts:82-86`, `apps/web/src/lib/photo-title.ts:85-127`, `apps/web/src/__tests__/alt-text-fallback.test.ts:1-90`

`schema.ts` says title/description take precedence over suggestions, but the actual public alt helper uses title, tags, suggestion, then generic fallback. Description is not in the chain.

Fix: update the schema comment or change the helper/tests if description should intentionally participate.

### AGG-C33-26 - `.context/plans/README.md` is stale with broken links

Severity: Low
Confidence: High
Agents: document-specialist

Regions: `.context/plans/README.md:3-80`

The plan index lists stale active/completed states and broken links to absent cycle 18/19 files.

Fix: refresh the index from actual files or mark it non-authoritative.

### AGG-C33-27 - Byte-impacting settings can leave derivative bytes mixed/stale

Severity: Medium
Confidence: High
Agents: tracer

Regions: `apps/web/src/app/actions/settings.ts:68-134`, `apps/web/src/lib/settings-hash.ts:47-59`, `apps/web/src/lib/image-queue.ts:122-137`, `apps/web/src/lib/serve-upload.ts:197-223`, `apps/web/scripts/backfill-color-pipeline.ts:332-341`

Changing byte-impacting settings such as quality/chroma/force-sRGB is accepted after images exist, but existing derivatives are not rewritten or marked stale.

Fix: diff all byte-impacting settings and either block until re-encode, schedule re-encode, or persist/surface a derivative-stale state.

### AGG-C33-28 - Invalid public view-recording calls consume analytics limiter budget

Severity: Low
Confidence: Medium
Agents: tracer

Regions: `apps/web/src/app/actions/public.ts:341-395`, `apps/web/src/app/actions/public.ts:417-510`

View recorders charge the limiter before existence/visibility checks and do not roll back nonexistent-target exits.

Fix: roll back invalid-target attempts if they should not count, or document and separate the invalid-target limiter policy.
