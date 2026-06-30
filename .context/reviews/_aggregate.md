# Cycle 21 Aggregate Review

Date: 2026-06-30 KST
Baseline HEAD at review start: `2cc619bb` (`fix(cycle20): close review-plan-fix findings`)
Current HEAD during aggregation: `1ed96484` (`docs(security): preserve cycle 21 audit evidence`)

## Review Fan-Out

Native subagent roles available in this environment were `default`, `explorer`, and `worker`; the named reviewer roles were executed as `default` subagents with role-specific prompts. The first attempt to spawn `test-engineer` hit the native thread limit and was retried after a slot was freed.

Returned review lanes:

- `code-reviewer.md`
- `perf-reviewer.md`
- `security-reviewer.md` (0 findings)
- `critic.md`
- `verifier.md`
- `test-engineer.md`
- `tracer.md`
- `architect.md`
- `debugger.md`
- `document-specialist.md`
- `designer.md`
- `product-marketer-reviewer.md`
- `ui-ux-designer-reviewer.md`

Discovered custom reviewer prompts included `product-marketer-reviewer` and `ui-ux-designer-reviewer`; both were adapted to GalleryKit because their installed prompt bodies reference another product.

Agent failures: none after retry. Some review lanes committed and pushed their review artifacts (`ef698815`, `81cd6270`, `a1bc95d4`, `3046df67`, `1ed96484`); uncommitted review artifacts remain for lanes instructed not to commit.

## Aggregate Findings

### AGG-C21-01 - Primary photo/lightbox alt labels collapse to generic "Photo" on tag-only images

Severity: High
Confidence: High
Sources: ui-ux-designer-reviewer
Status: Confirmed

Citations:

- `apps/web/src/components/photo-viewer.tsx:520-522`
- `apps/web/src/components/photo-viewer.tsx:690-692`
- `apps/web/src/components/image-zoom.tsx:343-365`
- `apps/web/src/components/lightbox.tsx:496-499`
- `apps/web/src/lib/photo-title.ts:85-121`
- `apps/web/src/lib/data.ts:1116-1169`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:158-163`

Problem: direct photo pages can build meaningful titles from `image.tags`, but `PhotoViewer`, `ImageZoom`, and lightbox alt text call `getConcisePhotoAltText(image, "Photo")`, which does not see the tag array returned by `getImage`.

Fix direction: normalize tag names into the image object or extend the helper to accept tag arrays, then use the same computed accessible name across the page, viewer, zoom button, related thumbnails, and lightbox.

### AGG-C21-02 - Lightbox color pip can leave an invisible keyboard stop when controls auto-hide

Severity: High
Confidence: High
Sources: designer
Status: Confirmed

Citations:

- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/lightbox-color-pip.tsx`

Problem: the auto-hidden lightbox controls can leave the color pip reachable/focusable even while visually hidden, creating a confusing keyboard stop.

Fix direction: when controls are hidden, remove the pip trigger/panel from tab order or keep controls visible while any child has focus. Add focused keyboard regression coverage.

### AGG-C21-03 - Settings backfill CTA promises re-encoding next to a state it cannot process

Severity: High
Confidence: High
Sources: designer
Status: Confirmed

Citations:

- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`

Problem: the Settings UI backfill/re-encode CTA sits next to admin states where no actionable re-encode can happen, so the control overpromises work it cannot perform.

Fix direction: disable or reword the CTA when no eligible images/settings changes exist, and make the state-specific reason visible inline rather than only through a generic action affordance.

### AGG-C21-04 - README positioning is still a feature inventory, not a launch proposition

Severity: High
Confidence: High
Sources: product-marketer-reviewer
Status: Confirmed

Citations:

- `README.md:7-44`

Problem: the root README leads with framework and feature inventory. The strongest product promise, a self-hosted photographer gallery focused on color accuracy, private originals, controlled sharing, and no editing/culling surface, is assembled only after reading deeper details.

Fix direction: rewrite the README lead and early feature hierarchy around the product wedge and operator/photographer outcomes, while preserving precise technical proof points.

### AGG-C21-05 - CLIP embedding backfills can write through a database restore window

Severity: Medium
Confidence: High
Sources: tracer
Status: Confirmed

Citations:

- `apps/web/src/app/[locale]/admin/db-actions.ts:387-458`
- `apps/web/src/lib/restore-maintenance.ts:1-56`
- `apps/web/src/lib/image-queue.ts:350-368`
- `apps/web/src/app/actions/embeddings.ts:55-181`
- `apps/web/scripts/backfill-clip-embeddings.ts:94-201`
- `apps/web/src/lib/advisory-locks.ts:19-44`

Problem: restore locks backup/upload/color-backfill work and quiesces the in-process image queue, but semantic embedding backfills do not acquire any restore-conflicting advisory lock. The sidecar script cannot see the process-local restore flag.

Fix direction: add a semantic embedding backfill advisory lock, have restore acquire it with the other restore-conflicting locks, and have both CLIP backfill entry points hold it for the run.

### AGG-C21-06 - Backup download leaks the opened descriptor if a pre-stream step throws

Severity: Low-Medium
Confidence: High
Sources: verifier, test-engineer, architect
Status: Confirmed

Citations:

- `apps/web/src/app/api/admin/db/download/route.ts:56-74`
- `apps/web/src/app/api/admin/db/download/route.ts:87-99`
- `apps/web/src/__tests__/backup-download-route.test.ts:170-184`

Problem: the route opens a validated file handle, then awaits current-user/audit work before constructing the stream. If a pre-stream step throws, the catch path has no handle reference to close.

Fix direction: keep the handle in outer scope, track stream ownership transfer, close unowned handles in catch, and add a regression that throws after `open()` succeeds.

### AGG-C21-07 - Photo hover prefetch can count adjacent photos as viewed

Severity: Medium
Confidence: High
Sources: code-reviewer, test-engineer, debugger
Status: Likely/confirmed source risk

Citations:

- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:154-156`
- `apps/web/src/components/photo-navigation.tsx:220-228`
- `apps/web/src/components/photo-navigation.tsx:235-242`
- `apps/web/src/app/actions/public.ts:370-390`
- `apps/web/src/__tests__/cycle-20-source-contracts.test.ts:25-31`

Problem: photo page render records a view, while previous/next buttons still manually prefetch adjacent photo routes on hover. App Router prefetch can evaluate server components before committed navigation.

Fix direction: remove adjacent photo hover prefetch while analytics remains render-bound, or move analytics to a committed-view client effect. Extend tests to cover `photo-navigation.tsx`.

### AGG-C21-08 - Manual Docker deployment docs omit `--env-file` for build-time args

Severity: Medium
Confidence: High
Sources: verifier, architect
Status: Confirmed

Citations:

- `README.md:175-182`
- `CLAUDE.md:642-659`
- `apps/web/docker-compose.yml:4-22`
- `apps/web/deploy.sh:30-32`
- `apps/web/src/__tests__/deploy-script-contract.test.ts:56-60`

Problem: the scripted deploy uses `docker compose --env-file apps/web/.env.local ... --build`, but manual README/CLAUDE commands still omit `--env-file`, so build args can differ from runtime `env_file`.

Fix direction: update manual commands and add a source-contract test so documented build commands do not drift from deploy behavior.

### AGG-C21-09 - Upload ingest remains duplicated across browser, Lightroom, and retry paths

Severity: Medium
Confidence: High
Sources: code-reviewer, critic, architect
Status: Confirmed

Citations:

- `apps/web/src/app/actions/images.ts:114-190`
- `apps/web/src/app/actions/images.ts:340-531`
- `apps/web/src/app/actions/images.ts:1236-1282`
- `apps/web/src/app/api/admin/lr/upload/route.ts:15-18`
- `apps/web/src/app/api/admin/lr/upload/route.ts:225-516`
- `apps/web/src/lib/image-queue.ts:92-120`

Problem: browser upload, Lightroom upload, and retry processing still manually construct one ingest lifecycle, so new gates or processing snapshot fields can drift by entry point.

Fix direction: extract a server-only ingest builder/service and add exhaustiveness coverage for processing snapshot/job field forwarding.

### AGG-C21-10 - Image queue workers can pin most of the shared MySQL pool during Sharp work

Severity: Medium
Confidence: High
Sources: perf-reviewer, critic, architect
Status: Confirmed operational/performance risk

Citations:

- `apps/web/src/db/index.ts:23-38`
- `apps/web/src/lib/image-queue.ts:87-90`
- `apps/web/src/lib/image-queue.ts:446-455`
- `apps/web/src/lib/image-queue.ts:519-657`
- `apps/web/src/lib/image-queue.ts:812-815`

Problem: queue workers hold shared-pool advisory-lock connections across CPU/file-heavy Sharp processing; raising `QUEUE_CONCURRENCY` can consume most pool connections.

Fix direction: use a durable row claim, dedicated advisory-lock pool, or pool-budget-derived queue concurrency cap.

### AGG-C21-11 - Single-process topology is documented but not enforced

Severity: Medium
Confidence: High
Sources: critic, architect
Status: Confirmed latent topology risk

Citations:

- `CLAUDE.md:232-235`
- `apps/web/src/lib/restore-maintenance.ts:1-56`
- `apps/web/src/lib/upload-tracker-state.ts:7-20`
- `apps/web/src/lib/data.ts:13-249`

Problem: restore maintenance, upload quota state, queue state, some rate limits, and buffered view counts are process-local, but startup/runtime does not enforce the documented single-web-instance topology.

Fix direction: add a startup guard/lease or shared coordination backend before supporting scale-out; at minimum add a visible runtime warning for multiple web replicas.

### AGG-C21-12 - Topic slug is a mutable natural key with manual fan-out

Severity: Medium
Confidence: High
Sources: architect
Status: Confirmed architectural risk

Citations:

- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/lib/smart-collections.ts`

Problem: topic rename uses a mutable natural key and requires manual updates across every slug-referencing child store and smart-collection predicate.

Fix direction: plan a surrogate immutable topic id or stronger centralized fan-out contract before adding new topic references.

### AGG-C21-13 - Public map ships and hydrates up to 10,000 markers at once

Severity: Low-Medium
Confidence: High
Sources: critic
Status: Confirmed scale risk

Citations:

- `apps/web/src/lib/data.ts:1649-1685`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:31-89`
- `apps/web/src/components/map/map-client.tsx:118-140`

Problem: map payloads are all-or-nothing up to 10,000 GPS rows, including fallback links and one Leaflet marker per row.

Fix direction: add bbox loading, clustering, visible caps, or paginated accessible fallback.

### AGG-C21-14 - Infinite masonry keeps every loaded card in client state and DOM

Severity: Medium
Confidence: High
Sources: perf-reviewer, critic
Status: Confirmed scale/UI risk

Citations:

- `apps/web/src/components/home-client.tsx:124-130`
- `apps/web/src/components/home-client.tsx:286-410`
- `apps/web/src/components/load-more.tsx:116-132`

Problem: infinite scroll appends every page forever, leaving all cards, images, observers, and layout work mounted.

Fix direction: virtualize/window the masonry feed or cap automatic loading and switch to explicit pagination.

### AGG-C21-15 - Initial public gallery pages do grouped count work on every dynamic request

Severity: Medium
Confidence: High
Sources: perf-reviewer
Status: Confirmed performance risk

Citations:

- `apps/web/src/lib/data.ts:878-907`
- `apps/web/src/app/[locale]/(public)/page.tsx:14-16`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:17`
- `apps/web/src/components/home-client.tsx:267-269`

Problem: dynamic home/topic renders compute a grouped tag join plus exact `COUNT(*) OVER()` for small first pages.

Fix direction: split card-page fetching from exact counts/tag aggregation, cache counts, or remove exact totals from the public hot path.

### AGG-C21-16 - CSV export materializes the full export in server and browser memory

Severity: Medium
Confidence: High
Sources: perf-reviewer
Status: Confirmed performance risk

Citations:

- `apps/web/src/app/[locale]/admin/db-actions.ts:79-159`

Problem: CSV export loads up to 50,000 rows, builds an array of lines, joins one large string, and returns it through a server action.

Fix direction: move export to an authenticated streaming route or background file job.

### AGG-C21-17 - Admin analytics fans out multiple aggregate scans against the shared pool

Severity: Low-Medium
Confidence: Medium
Sources: perf-reviewer
Status: Risk

Citations:

- `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:24-36`
- `apps/web/src/lib/analytics-data.ts`

Problem: the analytics page runs five grouped aggregate queries concurrently; the `all` window can widen scans on the shared pool.

Fix direction: serialize or cap analytics fanout, cache aggregates, or move heavy analytics to a background/materialized summary.

### AGG-C21-18 - Timeline/archive date filters are non-sargable on dynamic public pages

Severity: Low
Confidence: High
Sources: perf-reviewer
Status: Confirmed performance risk

Citations:

- `apps/web/src/lib/data-timeline.ts`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx`

Problem: date predicates use computed date parts, limiting index use on dynamic public pages.

Fix direction: use range predicates or persisted generated columns/indexes for timeline lookup shapes.

### AGG-C21-19 - Semantic rate-limit helper comment still names disabled mode as refundable

Severity: Low
Confidence: High
Sources: critic, tracer
Status: Confirmed docs/contract drift

Citations:

- `apps/web/src/lib/rate-limit.ts:361-378`
- `apps/web/src/app/api/search/semantic/route.ts:173-200`
- `apps/web/src/app/api/search/similar/[id]/route.ts:98-126`

Problem: route behavior intentionally keeps disabled/stub mode charged after config lookup, but the helper comment still lists disabled mode as a rollback example.

Fix direction: update the helper comment and add a source-contract assertion if this policy is important.

### AGG-C21-20 - CLIP inference queue safety is source-contract tested, not behavior-tested

Severity: Medium
Confidence: High
Sources: test-engineer
Status: Confirmed coverage gap

Citations:

- `apps/web/src/lib/clip-model.ts:65-160`
- `apps/web/src/lib/clip-model.ts:228-236`
- `apps/web/src/app/api/search/semantic/route.ts:253-257`
- `apps/web/src/__tests__/clip-model-contract.test.ts:32-50`

Problem: abort, timeout, queue-full, and slot-release behavior for CLIP inference are guarded mainly by source-string tests.

Fix direction: extract a queue seam or inject a fake model/tokenizer and add behavior tests with fake timers and aborted waiters.

### AGG-C21-21 - Real CLIP production behavior is opt-in and skipped by the default gate

Severity: Low-Medium
Confidence: High
Sources: test-engineer
Status: Confirmed coverage gap

Citations:

- `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`
- `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`
- `apps/web/src/__tests__/semantic-route-production.test.ts:3-16`
- `CLAUDE.md` semantic-search production notes

Problem: production semantic search is live, but default gates mock or skip real model/offline-load proof.

Fix direction: add a release/scheduled CI lane or pre-deploy evidence checklist for seeded real weights and offline production model loading.

### AGG-C21-22 - Failed-image retry snapshot forwarding lacks behavior/exhaustiveness coverage

Severity: Low-Medium
Confidence: High
Sources: test-engineer
Status: Confirmed coverage gap

Citations:

- `apps/web/src/lib/image-queue.ts:92-119`
- `apps/web/src/lib/image-queue.ts:208-232`
- `apps/web/src/app/actions/images.ts:1255-1271`
- `apps/web/src/__tests__/failed-image-retry.test.ts:87-103`

Problem: retry uses a fresh processing snapshot, but tests do not assert every snapshot field reaches `enqueueImageProcessing`.

Fix direction: add a behavior test with distinctive config values, or centralize snapshot-to-job mapping for TypeScript exhaustiveness.

### AGG-C21-23 - Similar-photo recommendations can expose repeated indistinguishable "Photo" links

Severity: Medium
Confidence: Medium-High
Sources: ui-ux-designer-reviewer
Status: Confirmed accessibility risk

Citations:

- `apps/web/src/components/similar-photos.tsx:136-141`
- `apps/web/src/components/similar-photos.tsx:186-194`
- `apps/web/src/components/search.tsx:100-105`

Problem: multiple title-less/description-less similar-photo links can all be named "Photo".

Fix direction: make fallback labels unique and contextual, at least `Photo {imageId}`, and add a component test.

### AGG-C21-24 - Admin image management remains a desktop table with horizontal panning on narrow screens

Severity: Medium
Confidence: High
Sources: ui-ux-designer-reviewer
Status: Confirmed UX risk

Citations:

- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:123-132`
- `apps/web/src/components/image-manager.tsx:424-590`

Problem: admin image management keeps one dense table across small screens, requiring horizontal panning for preview, metadata, tags, and actions.

Fix direction: add a responsive card/list presentation below the desktop breakpoint while preserving the desktop table.

### AGG-C21-25 - Admin data tables repeat horizontal-scroll patterns instead of a responsive primitive

Severity: Low-Medium
Confidence: Medium
Sources: ui-ux-designer-reviewer
Status: Confirmed design-system risk

Citations:

- `apps/web/src/components/image-manager.tsx:424-595`
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:218-279`
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:96-129`
- `apps/web/src/components/admin-user-manager.tsx:137-177`
- `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:91-274`

Problem: each admin area uses its own horizontal-scroll table pattern, spreading mobile/focus/empty-state fixes across pages.

Fix direction: introduce a shared responsive data-surface convention or component.

### AGG-C21-26 - Admin Users nests a card inside another card

Severity: Low
Confidence: High
Sources: ui-ux-designer-reviewer
Status: Confirmed polish issue

Citations:

- `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx:16-24`
- `apps/web/src/components/admin-user-manager.tsx:88-136`

Problem: the Users page renders outer card chrome, then `AdminUserManager` renders another card with a second header.

Fix direction: make one owner for page/card chrome and render the manager as a plain section when embedded.

### AGG-C21-27 - Settings validation errors are toast-only and not associated with invalid fields

Severity: Medium
Confidence: High
Sources: designer
Status: Confirmed accessibility/UX risk

Citations:

- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`

Problem: validation failures are surfaced as transient toasts without persistent field-associated error text.

Fix direction: add inline field errors with `aria-invalid`/`aria-describedby` and keep toast as secondary notification.

### AGG-C21-28 - Self-hosted onboarding punts database bootstrap to the reader

Severity: Medium
Confidence: High
Sources: product-marketer-reviewer
Status: Confirmed documentation gap

Citations:

- `README.md:83-106`
- `apps/web/README.md:7-21`

Problem: quick start says to create a MySQL database/user first, but does not provide a copy-pasteable local bootstrap path.

Fix direction: add minimal local MySQL creation examples or a clearly separated Docker/dev DB path.

### AGG-C21-29 - Semantic search activation is split across UI, README, and internal runbook

Severity: Medium
Confidence: High
Sources: product-marketer-reviewer
Status: Confirmed documentation/product gap

Citations:

- `README.md:37`
- `apps/web/README.md:56-77`
- `CLAUDE.md` CLIP semantic-search runbook
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`

Problem: semantic search is a live demo claim, but production activation requires stitching together public docs, admin UI copy, and internal operator notes.

Fix direction: make the public app README the authoritative activation runbook or link to a committed operator doc with exact sidecar commands.

### AGG-C21-30 - Upload API tokens are surfaced without a public integration contract

Severity: Medium
Confidence: High
Sources: product-marketer-reviewer
Status: Confirmed documentation gap

Citations:

- `README.md:40`
- `apps/web/src/app/[locale]/admin/(protected)/tokens`
- `apps/web/src/app/api/admin/lr/upload/route.ts`

Problem: the README mentions PAT-authenticated external uploads but does not document endpoint, headers, scopes, multipart fields, limits, or response shape.

Fix direction: add an Upload API section with the route contract and curl example.

### AGG-C21-31 - Auto Alt-Text is visible although implementation is an EXIF stub

Severity: Low
Confidence: High
Sources: product-marketer-reviewer
Status: Confirmed product-copy risk

Citations:

- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:620-632`
- `apps/web/messages/en.json:731-734`
- `apps/web/src/lib/caption-generator.ts:1-62`
- `apps/web/src/lib/image-queue.ts:678-695`

Problem: "Auto Alt-Text" commonly implies visual captioning, but the current implementation produces EXIF-derived hints.

Fix direction: rename visible copy to "EXIF Alt-Text Hints" until model-backed captioning ships, or hide it under experimental settings.

### AGG-C21-32 - Root README directory tree omits persisted runtime stores

Severity: Low
Confidence: High
Sources: document-specialist
Status: Confirmed docs drift

Citations:

- `README.md:64-81`
- `CLAUDE.md` repository structure / deploy persistence notes

Problem: the root README tree lists `public/uploads` but omits `public/resources` and private `data/uploads/original`.

Fix direction: update the tree to match persistence-critical directories.

### AGG-C21-33 - CLAUDE hardcodes deploy host despite config-driven helper rule

Severity: Low
Confidence: High
Sources: document-specialist
Status: Confirmed docs drift

Citations:

- `CLAUDE.md` backfill/CLIP sidecar examples
- `AGENTS.md` deploy helper rule

Problem: internal runbook examples hardcode the production host path while AGENTS says deploy host and SSH credentials are config-driven.

Fix direction: replace host-specific examples with placeholders or explicitly mark them as current-production examples.

### AGG-C21-34 - Code comments still imply a bundled Lightroom plugin

Severity: Low
Confidence: Medium-High
Sources: document-specialist
Status: Confirmed docs/comment drift

Citations:

- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/messages/*`
- README token/upload wording

Problem: some comments/copy still use Lightroom-plugin wording even though the repo ships only the server API.

Fix direction: consistently describe "Lightroom-compatible upload API" or "external upload clients", not a bundled plugin.

### AGG-C21-35 - Historical CLIP superpower plan contains obsolete snippets

Severity: Low
Confidence: Medium
Sources: document-specialist
Status: Confirmed historical-doc drift

Citations:

- `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`

Problem: a completed historical plan still contains outdated code snippets that can mislead future maintainers.

Fix direction: add a stale/historical note or update the snippets to point to current code.

### AGG-C21-36 - Non-archived `.context/plan/plan-cycle21.md` contradicts current semantic stub-mode behavior

Severity: Low
Confidence: High
Sources: verifier
Status: Confirmed plan drift

Citations:

- `.context/plan/plan-cycle21.md:10-24`
- `.context/plan/plan-cycle21.md:101-106`
- `apps/web/src/app/api/search/semantic/route.ts:19-31`
- `apps/web/src/app/api/search/semantic/route.ts:186-203`
- `apps/web/src/__tests__/semantic-search-route.test.ts:113-115`

Problem: a non-archived plan says semantic text search must reject stub mode, while current code/docs/tests intentionally serve stub mode with disclaimers.

Fix direction: mark the stale plan superseded or update/archive it so active planning does not reintroduce the old contract.

### AGG-C21-37 - `isProtectedAdminRoute` carries a dead localized admin equality branch

Severity: Low
Confidence: High
Sources: code-reviewer
Status: Confirmed maintainability issue

Citations:

- `apps/web/src/proxy.ts:57-61`

Problem: the outer condition includes `/{locale}/admin`, but the inner return only covers `/{locale}/admin/*`; behavior is correct, but the branch is misleading.

Fix direction: simplify the condition or comment that localized admin root is intentionally not protected.

### AGG-C21-38 - Audit retention purge remains a single unbounded DELETE

Severity: Low
Confidence: High
Sources: debugger
Status: Confirmed operational risk

Citations:

- `apps/web/src/lib/audit.ts:97-122`

Problem: audit retention deletes all expired rows in one statement, unlike chunked analytics retention.

Fix direction: chunk audit deletion if audit volume grows or audit retention becomes high-write.

### AGG-C21-39 - Upload fallback serving validates by path, then reopens by path

Severity: Low
Confidence: Medium
Sources: debugger
Status: Risk

Citations:

- `apps/web/src/lib/serve-upload.ts`

Problem: fallback upload serving validates a path and later opens by path rather than descriptor, leaving a small TOCTOU pattern.

Fix direction: use descriptor-backed stat/streaming like the backup download route.

## Cross-Agent Notes

High-signal duplicated findings:

- Upload ingest duplication: code-reviewer, critic, architect.
- Image queue/shared pool pressure: perf-reviewer, critic, architect.
- Manual Docker `--env-file` drift: verifier, architect.
- Backup descriptor leak: verifier, test-engineer, architect.
- Render-time analytics/prefetch: code-reviewer, test-engineer, debugger.
- Semantic rollback comment drift: critic, tracer.

No confirmed security vulnerabilities were reported by `security-reviewer`; several operational/correctness risks still need implementation or explicit deferral.
