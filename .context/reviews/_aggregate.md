# Cycle 23 Aggregate Review

Date: 2026-06-30 KST  
Scope: merged results from the cycle 23 review-plan-fix fan-out on current HEAD `45208b2181add5db64395e4dac30134cfd1fcf35`.

## Agent Coverage

All available reviewer-style lanes completed and wrote provenance reports:

- `code-reviewer.md`
- `performance-reviewer.md`
- `security-reviewer.md`
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

The two globally installed custom reviewer prompts were tailored to a different SwiftUI product, so they were constrained to GalleryKit's actual Next.js gallery/admin surface. No reviewer failed after retry; there are no agent failures to report.

## Summary

Unique merged findings: 50

- Critical: 0
- High: 0
- Medium or Medium-High: 25
- Low-Medium: 6
- Low: 19

Highest-signal cross-agent findings:

- Image queue workers can pin most of the shared MySQL pool during Sharp work.
- Browser and Lightroom upload ingestion still duplicate a large lifecycle.
- The single-writer deployment topology is documented but not mechanically enforced.
- Browser upload quota settlement is structurally fragile and under-tested.
- Audit retention and upload fallback serving have lower-severity operational/safety gaps.
- `createToken` still bypasses the canonical `safeInsertId` helper.
- The E2E seed script permits destructive cleanup on `CI=true` alone.
- The public error boundary drops normal recovery/navigation chrome.

## Merged Findings

### AGG23-01 - Foreground image queue can pin most of the shared MySQL pool

Severity: Medium  
Confidence: High  
Agreement: code-reviewer C23-01, performance PERF-C23-04, critic CRIT23-01, tracer TRC23-02, architect ARCH23-02, debugger DBG23-01

Evidence centers on `apps/web/src/db/index.ts:23-33`, `apps/web/src/lib/image-queue.ts:87-90`, `:446-463`, `:513-520`, `:622-657`, and `:812-815`. With `QUEUE_CONCURRENCY` raised near its cap, queue workers can hold advisory-lock pool connections while CPU/filesystem-heavy Sharp work runs, leaving little pool capacity for live requests.

Fix: add a live-queue pool-budget clamp or redesign the queue claim so DB advisory-lock connections are not held through encode-duration work. Lock with regression coverage around resolved concurrency.

### AGG23-02 - Browser and Lightroom upload ingestion still duplicate lifecycle ownership

Severity: Medium  
Confidence: High  
Agreement: code-reviewer C23-02, critic CRIT23-03, architect ARCH23-01

Browser upload assembly lives mainly in `apps/web/src/app/actions/images.ts:238-596`; Lightroom/PAT upload mirrors quota, validation, DB insert, queue payload, audit, and settlement in `apps/web/src/app/api/admin/lr/upload/route.ts:130-547`. Prior parity-fix comments in the LR route show this boundary has drifted before.

Fix: extract a shared upload-ingest coordinator or shared payload builder used by both adapters, with route/action tests proving parity for settings snapshots, semantic mode, captions, color metadata, and quota settlement.

### AGG23-03 - Single-writer topology is documented but not enforced

Severity: Medium  
Confidence: High  
Agreement: code-reviewer C23-03, critic CRIT23-02, tracer TRC23-06, architect ARCH23-03, debugger DBG23-02

`CLAUDE.md:233-236` documents single-process assumptions. The app still relies on process-local restore maintenance (`apps/web/src/lib/restore-maintenance.ts`), upload tracking (`apps/web/src/lib/upload-tracker-state.ts`), queue bootstrap (`apps/web/src/instrumentation.ts`), image queue state, and shared-group view buffers (`apps/web/src/lib/data.ts:13-63`) without a startup lease.

Fix: add a startup/runtime singleton guard, or fail fast when the deployment is scaled beyond one web process unless shared coordination is configured.

### AGG23-04 - Mutable topic slugs remain a manual fan-out natural key

Severity: Medium  
Confidence: High  
Agreement: code-reviewer C23-04, critic CRIT23-07, architect ARCH23-06, debugger DBG23-05

`topics.slug` is the primary key and appears in relational references plus smart-collection JSON (`apps/web/src/db/schema.ts`, `apps/web/src/app/actions/topics.ts:255-339`). Current guards are improved, but rename correctness depends on manual fan-out and JSON remapping.

Fix: long term, move to immutable topic IDs with slug as a unique mutable attribute. Short term, keep strong source/behavior tests for every slug reference.

### AGG23-05 - Browser upload quota settlement is structurally fragile

Severity: Medium  
Confidence: High  
Agreement: code-reviewer C23-05, critic CRIT23-04, tracer TRC23-03, debugger DBG23-08, test-engineer T23-02

`uploadImages` preclaims quota at `apps/web/src/app/actions/images.ts:238-242`, then relies on manually paired `settleUploadTrackerClaim` calls for later awaited failure paths (`:247-292`, `:536-596`). LR upload uses a stronger idempotent settlement closure at `apps/web/src/app/api/admin/lr/upload/route.ts:139-151`.

Fix: use one browser-upload idempotent settlement helper around all post-claim work and add behavior tests for post-claim failures.

### AGG23-06 - Audit retention deletes all expired rows in one statement

Severity: Low  
Confidence: High  
Agreement: code-reviewer C23-06, critic CRIT23-05, tracer TRC23-04, debugger DBG23-07

`apps/web/src/lib/audit.ts:97-122` performs an unbounded delete. Analytics retention already batches deletes in `apps/web/src/lib/view-retention.ts`.

Fix: batch audit deletion with an iteration cap and add a test for bounded delete behavior.

### AGG23-07 - Upload fallback serving validates a path and later streams by pathname

Severity: Low  
Confidence: Medium  
Agreement: code-reviewer C23-07, critic CRIT23-06, tracer TRC23-05, debugger DBG23-09

`apps/web/src/lib/serve-upload.ts:169-269` validates with `lstat`/realpath, builds headers from that result, then opens a stream by path. The backup download route already uses descriptor-backed streaming.

Fix: open once, stat the descriptor, validate it, and stream from that descriptor.

### AGG23-08 - Dynamic public first pages still run grouped exact-count queries

Severity: Medium  
Confidence: High  
Agreement: performance PERF-C23-01, debugger DBG23-03

Public home/topic/smart-collection first pages use grouped listing queries with `COUNT(*) OVER()` and tag aggregation (`apps/web/src/lib/data.ts:878-907`, `:1446-1461`) while pages are dynamic (`revalidate = 0`).

Fix: avoid exact counts on hot public first pages, cache counts separately, or fetch one extra row for "more" state.

### AGG23-09 - Infinite masonry keeps every loaded card mounted

Severity: Medium  
Confidence: High  
Agreement: performance PERF-C23-02

`apps/web/src/components/home-client.tsx` accumulates and maps the full image list (`:127-130`, `:286-411`) and `load-more.tsx` auto-loads more pages without a mounted-item cap.

Fix: add virtualization/windowing or a bounded DOM strategy for long sessions.

### AGG23-10 - CSV image export buffers the whole export in server and browser memory

Severity: Medium  
Confidence: High  
Agreement: performance PERF-C23-03, debugger DBG23-04

`apps/web/src/app/[locale]/admin/db-actions.ts:79-159` loads rows, builds all CSV lines, joins the full string, returns it through a server action, then the client creates a `Blob`.

Fix: move image CSV export to an authenticated streaming route or background export file.

### AGG23-11 - Admin analytics fans out aggregate scans on the shared DB pool

Severity: Low-Medium  
Confidence: Medium  
Agreement: performance PERF-C23-05

`apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:24-36` dispatches multiple aggregate scans concurrently against the same pool used by public traffic and workers.

Fix: cap analytics concurrency, cache common windows, or move long windows to precomputed summaries.

### AGG23-12 - Timeline/archive routes use non-sargable date predicates

Severity: Low  
Confidence: High  
Agreement: performance PERF-C23-06

`apps/web/src/lib/data-timeline.ts` uses `YEAR`, `MONTH`, and `DAYOFMONTH` predicates on dynamic routes. Existing indexes do not support those functions directly.

Fix: use generated/indexed year/month/day columns or range predicates.

### AGG23-13 - Topic navigation computes per-topic latest-image timestamps on common paths

Severity: Low  
Confidence: Medium  
Agreement: performance PERF-C23-07

`apps/web/src/lib/data.ts:509-529` computes `last_image_updated_at` with a correlated `MAX` per topic and public nav/layout call the helper frequently.

Fix: add a matching index/materialized topic freshness field or stop computing this on hot page requests.

### AGG23-14 - Public map can render up to 10k markers plus 10k list items

Severity: Low-Medium  
Confidence: High  
Agreement: performance PERF-C23-08, debugger DBG23-06

`MAP_MAX_MARKERS = 10000` and the map page renders both the marker set and a full fallback list (`apps/web/src/lib/data.ts:1649-1685`, `apps/web/src/app/[locale]/(public)/map/page.tsx:77-89`, `components/map/map-client.tsx:119-140`).

Fix: cluster, paginate, or reduce marker/list rendering.

### AGG23-15 - Upload-processing contract lock spans full browser/LR upload work

Severity: Low  
Confidence: High  
Agreement: performance PERF-C23-09

`apps/web/src/lib/upload-processing-contract-lock.ts` holds a pooled advisory-lock connection across long upload/file work in browser and LR flows.

Fix: narrow the lock window to only settings/quota contract-critical sections, or move to a non-pooled lock connection.

### AGG23-16 - Mutable Docker and apt inputs remain a supply-chain risk

Severity: Low  
Confidence: High  
Agreement: security SEC23-01

`apps/web/Dockerfile` uses floating `node:24-slim` and unpinned apt package inputs.

Fix: pin image digests and package sources or add artifact provenance/SBOM verification.

### AGG23-17 - Deploy helper executes raw shell from env file

Severity: Low  
Confidence: Medium  
Agreement: security SEC23-02

`scripts/deploy-remote.sh` sources a selected env file and executes `DEPLOY_CMD`/derived shell through `bash -lc`.

Fix: validate env file ownership/permissions, parse an allowlist of keys instead of shell-sourcing arbitrary syntax, and avoid raw command strings where possible.

### AGG23-18 - Nginx template is unsafe if exposed as the public cleartext edge

Severity: Low  
Confidence: Medium  
Agreement: security SEC23-03

`apps/web/nginx/default.conf` listens on port 80 and documents an upstream TLS edge, but emits HSTS and can be misread as enforcing TLS itself.

Fix: add HTTPS redirect/server-block support or a deploy assertion documenting/enforcing upstream TLS termination.

### AGG23-19 - Production CLIP readiness depends on manual/conditional smoke coverage

Severity: Medium  
Confidence: High  
Agreement: critic CRIT23-08, test-engineer T23-04

Production CLIP is live per `CLAUDE.md`, but real ranking/offline-load tests skip unless env flags and model weights are present. Production route tests mock the encoder.

Fix: add a lightweight production-readiness script/test that validates model-root artifacts and loader bootstrap when production mode is enabled.

### AGG23-20 - Lightroom token creation drops non-number insert IDs to `0`

Severity: Low  
Confidence: High  
Agreement: verifier V23-01, tracer TRC23-01

`apps/web/src/lib/admin-tokens.ts:221-228` manually coerces `insertId` and returns `0` for `BigInt`, while the repo's canonical helper is `safeInsertId` in `apps/web/src/lib/validation.ts:173-199`.

Fix: use `safeInsertId` and add a test for BigInt insert IDs.

### AGG23-21 - Lightroom upload route lacks behavior-level route tests

Severity: Medium  
Confidence: High  
Agreement: test-engineer T23-01

`apps/web/src/__tests__/lr-upload-hdr-gate.test.ts` is source-text oriented around a route with many critical side effects in `apps/web/src/app/api/admin/lr/upload/route.ts`.

Fix: add a mocked route harness for success and key failure branches.

### AGG23-22 - CLIP inference queue correctness is source-text tested

Severity: Medium  
Confidence: High  
Agreement: test-engineer T23-03

Queue limits and abort/timeout behavior live in `apps/web/src/lib/clip-model.ts:53-160`, but `clip-model-contract.test.ts` string-matches the source.

Fix: expose or isolate the queue primitive enough to unit-test concurrency, timeout, abort, and release semantics.

### AGG23-23 - E2E seed safety treats `CI=true` as sufficient for destructive cleanup

Severity: Medium-High  
Confidence: High  
Agreement: test-engineer T23-05

`apps/web/scripts/seed-e2e.ts:162-166` allows destructive seeding if explicit opt-in, disposable DB name, or `CI=true`. It then deletes/recreates rows and removes files for the E2E topic/shared group.

Fix: require explicit opt-in or a disposable DB name; do not let `CI=true` alone authorize destructive cleanup. Update the safety test.

### AGG23-24 - `retryFailedImage` lacks behavior coverage for stale rows and enqueue rejection

Severity: Medium  
Confidence: Medium  
Agreement: test-engineer T23-06

`apps/web/src/app/actions/images.ts:1202-1294` clears failure state and re-enqueues without a behavior test for stale rows or affected-row checks; enqueue rejection restoration is source-tested only.

Fix: inspect `affectedRows`, avoid clearing in-memory state or enqueueing when no row updates, and add behavior tests for stale row and enqueue rejection.

### AGG23-25 - `data.ts` remains an architectural choke point

Severity: Medium  
Confidence: High  
Agreement: architect ARCH23-04

`apps/web/src/lib/data.ts` combines privacy selectors, public/admin queries, SEO, search, shares, maps, caches, and process-local side-effect buffers in a 1,700+ line module.

Fix: decompose by ownership boundaries, starting with side-effect buffers and public/admin selector contracts.

### AGG23-26 - All admins are still root admins

Severity: Medium  
Confidence: High  
Agreement: architect ARCH23-05

Docs and implementation intentionally have multiple root admins and no role/capability model. Restore, user management, settings, and token actions gate only on root admin status plus narrow safeguards.

Fix: if the product grows beyond a personal gallery, add capability-scoped admin roles; otherwise keep the risk prominently documented.

### AGG23-27 - CLIP backfill script header can hide the real model-weight volume

Severity: Medium  
Confidence: High  
Agreement: document-specialist DOC23-01

`apps/web/scripts/backfill-clip-embeddings.ts:14-21` shows a sidecar command with an extra model mount that can mask the real `apps/web/data/models/clip` bind mount documented in `CLAUDE.md`.

Fix: align the script header command with the canonical `CLAUDE.md` command.

### AGG23-28 - `CLAUDE.md` advisory-lock inventory omits semantic embedding backfill

Severity: Low  
Confidence: High  
Agreement: document-specialist DOC23-02

`CLAUDE.md:399-403` omits `gallerykit_semantic_embedding_backfill`, which exists in `apps/web/src/lib/advisory-locks.ts:43-47` and is acquired by restore and CLIP backfill.

Fix: add the omitted lock and describe both color and semantic backfill locks.

### AGG23-29 - Deploy docs hardcode the production host despite config-driven deploy rules

Severity: Low  
Confidence: High  
Agreement: document-specialist DOC23-03

`CLAUDE.md:463-465` says deploy sshes to `gallery.atik.kr`, while AGENTS and deploy helpers require host/key/path to remain config-driven through `.env.deploy`.

Fix: reword to "configured deploy host" and reserve `gallery.atik.kr` for demo/current-production context.

### AGG23-30 - Lightroom/PAT wording and scopes imply unshipped integration breadth

Severity: Low  
Confidence: Medium-High  
Agreement: document-specialist DOC23-04, product-marketer PMR-23-03

Public docs correctly state no bundled Lightroom plugin, but lower-level comments still say "Lightroom plugin"; `admin-tokens.ts` also exports `lr:read`/`lr:delete` scopes even though only upload is shipped.

Fix: normalize comments/docs to "Lightroom-compatible publish API" and document `lr:read`/`lr:delete` as reserved until routes ship.

### AGG23-31 - Current aggregate carried a fixed prior env-example finding

Severity: Low  
Confidence: High  
Agreement: document-specialist DOC23-05

The previous `_aggregate.md` still carried a fixed cycle-22 env-example issue. This new aggregate replaces that stale status.

Fix: complete by replacing the stale aggregate in this cycle.

### AGG23-32 - Route scanner comments overstate Next route-file extension support

Severity: Low  
Confidence: Medium  
Agreement: document-specialist DOC23-06

Scanner comments/tests imply Next resolves `.tsx`, `.mjs`, and `.cjs` route files identically, while current Next docs document `route.js|ts`.

Fix: reword comments to "defensively scanned if present; repo standard is route.ts/route.tsx" or add build-level proof.

### AGG23-33 - Historical CLIP plan link is broken

Severity: Low  
Confidence: High  
Agreement: document-specialist DOC23-07

`docs/superpowers/plans/2026-06-15-clip-semantic-search.md:13-17` links to a same-directory spec that actually lives in `../specs/`.

Fix: update the relative link.

### AGG23-34 - Feed-sized derivative test comment has stale default sizes

Severity: Low  
Confidence: High  
Agreement: document-specialist DOC23-08

`apps/web/src/__tests__/feed-sized-derivative.test.ts:1-14` documents the old four-size default; current defaults include 5120 and 7680.

Fix: update or de-hardcode the comment.

### AGG23-35 - Error pages can keep the failed route title

Severity: Medium  
Confidence: High  
Agreement: designer finding 1

`apps/web/src/app/[locale]/error.tsx:16-20` only changes `document.title` when it is empty, so failed routes can retain normal titles like "Map | GalleryKit".

Fix: set an explicit localized error title.

### AGG23-36 - Public error boundary drops normal recovery shell

Severity: Medium  
Confidence: High  
Agreement: designer finding 2, ui-ux-designer-reviewer finding 1

`apps/web/src/app/[locale]/error.tsx:22-61` renders a stripped local shell, while `not-found.tsx` already documents and fixes the same wayfinding problem with `Nav` and `Footer`.

Fix: mirror the not-found shell or provide an equivalent fallback shell with locale/theme/admin/privacy links.

### AGG23-37 - Lightbox controls can remain invisible but pointer-active

Severity: Medium  
Confidence: Medium  
Agreement: designer finding 3

`apps/web/src/components/lightbox.tsx:543-643` hides controls with opacity and `aria-hidden`, but child controls keep `pointer-events-auto`.

Fix: make hidden controls pointer-inert and add an e2e regression.

### AGG23-38 - Mobile nav can show an expand button with no hidden topics

Severity: Low  
Confidence: High  
Agreement: designer finding 4

`apps/web/src/components/nav-client.tsx:99-107` renders the mobile expand button unconditionally even when `topics.length === 0`.

Fix: hide the expander unless it reveals actual hidden content.

### AGG23-39 - Login required-field validation is not localized or persistent

Severity: Low  
Confidence: High  
Agreement: designer finding 5

`apps/web/src/app/[locale]/admin/login-form.tsx:43-72` relies on native required validation without localized persistent inline messages.

Fix: add component-level localized required-field errors with `aria-invalid`/`aria-describedby`.

### AGG23-40 - Color/HDR positioning overstates cross-browser delivery guarantees

Severity: Medium  
Confidence: High  
Agreement: product-marketer PMR-23-01

Docs/product positioning can read broader than implementation limits: Firefox is treated as sRGB in `use-display-capability.ts`, and HDR ingest currently delivers SDR derivatives.

Fix: make README/top-level claims say best-effort browser-managed Display-P3 delivery, with Firefox and HDR caveats.

### AGG23-41 - Similar-photos copy is accurate only for operator-enabled production mode

Severity: Low  
Confidence: High  
Agreement: product-marketer PMR-23-02

Admin UI exposes disabled/stub semantic modes, while similar photos render only for production mode (`similar-photos.tsx`, `/api/search/similar/[id]`).

Fix: clarify that stub previews text-search wiring only; similar photos require production semantic search plus embeddings.

### AGG23-42 - README analytics sample uses a syntactically valid placeholder GA ID

Severity: Low  
Confidence: High  
Agreement: product-marketer PMR-23-04

`README.md:55-66` uses `"G-XXXXXXXXXX"`, which matches the layout loader's GA regex in `apps/web/src/app/[locale]/layout.tsx:147-159`.

Fix: use an empty value in copy-pasteable config and explain that real IDs opt into GA.

### AGG23-43 - Auto alt-text internal wording can leak a false AI claim

Severity: Low  
Confidence: Medium  
Agreement: product-marketer PMR-23-05

`apps/web/src/db/schema.ts:82-85` says "AI-generated alt text suggestion", but `caption-generator.ts` currently produces EXIF-derived deterministic hints and user-facing copy is honest.

Fix: update internal comments to "auto-generated EXIF-derived" with future AI wording only where explicitly reserved.

### AGG23-44 - Admin image management is table-only on narrow screens

Severity: Medium  
Confidence: High  
Agreement: ui-ux-designer-reviewer finding 2

`apps/web/src/components/image-manager.tsx:424-595` renders a dense nine-column table with horizontal overflow and no mobile card/list layout.

Fix: add a below-`lg` card/list layout using the same data/actions.

### AGG23-45 - Upload staging cards start at two columns on phones

Severity: Low-Medium  
Confidence: High  
Agreement: ui-ux-designer-reviewer finding 3

`apps/web/src/components/upload-dropzone.tsx:458-466` uses `grid-cols-2` for accepted-file cards on phones, squeezing filenames and tag controls.

Fix: change to `grid-cols-1 sm:grid-cols-2 md:grid-cols-3`.

### AGG23-46 - Accepted upload files can be skipped with only a generic limit toast

Severity: Low-Medium  
Confidence: High  
Agreement: ui-ux-designer-reviewer finding 4

`apps/web/src/components/upload-dropzone.tsx:143-170` drops structured skip reasons for accepted files filtered by GalleryKit aggregate limits.

Fix: track skipped file names/reasons and render persistent feedback below the dropzone.

### AGG23-47 - Desktop photo info toggling animates the photo canvas layout

Severity: Low-Medium  
Confidence: High  
Agreement: ui-ux-designer-reviewer finding 5

`apps/web/src/components/photo-viewer.tsx:630-633` uses `transition-all duration-500` while toggling the info/sidebar grid.

Fix: remove long layout animation or respect reduced/professional motion preferences.

### AGG23-48 - Swipe snap animation bypasses reduced-motion intent

Severity: Low  
Confidence: Medium-High  
Agreement: ui-ux-designer-reviewer finding 6

`apps/web/src/components/photo-navigation.tsx:153-155` applies an inline transition when snapping swipe feedback back to rest, bypassing global reduced-motion clamps.

Fix: route the transition through the reduced-motion state or CSS media query.

### AGG23-49 - Admin IA is a flat ten-link wrap

Severity: Low-Medium  
Confidence: Medium  
Agreement: ui-ux-designer-reviewer finding 7

`apps/web/src/components/admin-nav.tsx:15-49` renders ten peer admin links in one wrapping row without task grouping.

Fix: group admin navigation by task domain or add secondary organization for repeat admin workflows.

### AGG23-50 - Product/admin docs can overstate color and semantic feature readiness

Severity: Low  
Confidence: Medium  
Agreement: product-marketer PMR-23-01, PMR-23-02, document-specialist DOC23-04

This is a combined positioning risk across README/admin copy/comments where implementation has correct gates but the first-read copy can still imply broader color/HDR or semantic readiness than a fresh install gets.

Fix: keep top-level copy as explicit as implementation comments: feature availability depends on browser/display, production semantic opt-in, model weights, and backfill.

## Agent Failures

None.

## Validation Evidence From Review Agents

Review agents reported these checks during Prompt 1:

- `npm run lint --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm audit --workspace=apps/web --audit-level=low`
- `npm audit --workspace=apps/web --omit=dev --audit-level=low`
- Targeted Vitest slices for advisory locks, privacy fields, route/action scanners, deploy contracts, touch targets, i18n parity, audit retention, upload serving, image queue quiesce, admin tokens, smart collections, and cycle-22 source contracts
- Full Vitest from verifier: 265 files / 2,485 tests passed, 2 files / 4 tests skipped
- Designer browser-backed pass on local `localhost:3001`, with DB-backed pages blocked by local MySQL `ECONNREFUSED`

Prompt 3 must still run every configured gate against the current full repo after implementation.
