# Cycle 8 Aggregate Review - 2026-06-29

Repository: `/Users/hletrd/flash-shared/gallery`
Cycle: 8/100
Baseline application HEAD: `d43f9fc5`

## Reviewer Coverage

Completed reviewer reports:

- `code-reviewer.md`
- `perf-reviewer.md`
- `security-reviewer.md`
- `critic.md`
- `verifier.md`
- `test-engineer.md`
- `tracer.md`
- `architect.md`
- `debugger.md`
- `document-specialist.md`
- `designer.md`

Local reviewer prompts discovered:

- `product-marketer-reviewer.md` was not applicable to this self-hosted gallery implementation cycle.
- `ui-ux-designer-reviewer.md` was represented by the `designer.md` lane with live browser/DOM/accessibility evidence.

Agent failures: none. Native subagent concurrency limited the fan-out to batches, but all required review specialties completed.

## Merged Findings

### C8-01 - Tracked review log discloses credential material

Severity: High
Confidence: High
Status: Confirmed
Reported by: security-reviewer

Evidence:

- `.context/reviews/logs-cycle4/security-reviewer.log:19495-19496`
- `.context/reviews/logs-cycle4/security-reviewer.log:26298-26302`

Issue:
Tracked review logs contain live-looking `.env.local` credential values, including admin password material, `SESSION_SECRET`, and database password material.

Failure scenario:
Anyone with repo/archive/fork access can recover the logged values. If any value is current or reused, an attacker can sign sessions, attempt admin login, or access the DB where network reachability allows.

Fix:
Rotate every exposed credential, redact or remove the tracked log content, and add a secret-scanning gate that covers `.context/**`, `plan/**`, and generated logs before commit.

### C8-02 - Bounded concurrency env knobs accept `Infinity`, fractions, and unbounded values

Severity: Medium
Confidence: High
Status: Confirmed
Reported by: code-reviewer

Evidence:

- `apps/web/src/lib/clip-model.ts:52-67`
- `apps/web/src/lib/image-queue.ts:289-297`
- `apps/web/src/app/actions/images.ts:796-810`

Issue:
`CLIP_INFERENCE_CONCURRENCY`, `QUEUE_CONCURRENCY`, and `IMAGE_CLEANUP_CONCURRENCY` parse with raw `Number(...)` / `Math.max(...)`, accepting `Infinity`, `1e309`, fractions, and arbitrary large numbers.

Failure scenario:
An operator typo such as `QUEUE_CONCURRENCY=Infinity` can make the image queue start every pending job concurrently, multiplying Sharp, CLIP, disk, and DB pressure on the single web instance.

Fix:
Centralize bounded positive-integer env parsing with finite checks, flooring/rejecting fractions, and subsystem caps. Add tests for invalid, fractional, infinite, and oversized inputs.

### C8-03 - CLIP image preprocessing and side-effect admission bypass the concurrency governor

Severity: Medium
Confidence: Medium-High
Status: Likely issue, confirmed code path
Reported by: perf-reviewer

Evidence:

- `apps/web/src/lib/clip-model.ts:52-67`
- `apps/web/src/lib/clip-model.ts:167-202`
- `apps/web/src/lib/image-queue.ts:611-670`

Issue:
The CLIP limiter wraps only the model call. Sharp decode/resize/raw conversion and float tensor allocation happen before slot acquisition, and image queue side effects can admit many embedding jobs after `processed=true`.

Failure scenario:
A production semantic-search batch can launch many concurrent original-file decodes and tensor allocations before waiting for serialized model inference, competing with live upload and request work.

Fix:
Gate the whole real image embedding job, including Sharp preprocessing, behind the CLIP slot or a dedicated bounded embedding queue. Add regression coverage proving preprocessing is not entered concurrently at default settings.

### C8-04 - Durable semantic-search snapshots bypass the runtime production opt-in gate

Severity: Medium
Confidence: High
Status: Confirmed
Reported by: architect

Evidence:

- `apps/web/src/lib/gallery-config.ts:123-140`
- `apps/web/src/lib/image-queue.ts:85-112`
- `apps/web/src/lib/image-queue.ts:151-163`
- `apps/web/src/lib/image-queue.ts:620-636`
- `apps/web/src/app/actions/images.ts:418`
- `apps/web/src/app/api/admin/lr/upload/route.ts:424`

Issue:
`semanticSearchMode: "production"` is persisted in `processing_settings_json` and later rehydrated without reapplying the current `SEMANTIC_SEARCH_ALLOW_PRODUCTION` env gate.

Failure scenario:
An operator can disable production semantic search after upload but before queue drain. Bootstrap can still rehydrate the old production snapshot and run real CLIP embedding despite the current env opt-out.

Fix:
Separate byte-processing snapshots from runtime capability gates, or re-resolve persisted semantic mode through an env-gated helper at queue-consume time. Add a regression test for production snapshot plus absent env flag.

### C8-05 - Failed-image retry reopens snapshotless fail-open processing-config path

Severity: Medium
Confidence: High
Status: Confirmed
Reported by: architect

Evidence:

- `apps/web/src/app/actions/images.ts:1183-1215`
- `apps/web/src/lib/image-queue.ts:491-511`
- `apps/web/src/lib/gallery-config.ts:184-200`

Issue:
`retryFailedImage()` clears `processing_settings_json` and re-enqueues without a fresh strict settings snapshot. The queue then uses non-strict `getGalleryConfig()` and can process with defaults on DB/config read failure.

Failure scenario:
An admin retry under non-default output settings can succeed with fallback defaults if queue config read fails transiently, marking the image processed with bytes that do not match current admin settings.

Fix:
Make retry a strict write path: read strict config, persist a new snapshot, enqueue with that snapshot, and fail the retry without clearing the row if settings cannot be read.

### C8-06 - Restore failures after queue quiesce can strand pending image rows

Severity: Medium
Confidence: High
Status: Confirmed
Reported by: debugger; independently confirmed by tracer

Evidence:

- `apps/web/src/app/[locale]/admin/db-actions.ts:360-381`
- `apps/web/src/app/[locale]/admin/db-actions.ts:443-582`
- `apps/web/src/lib/image-queue.ts:953-1007`
- `apps/web/src/__tests__/restore-upload-lock.test.ts:56-63`

Issue:
Restore quiesces and clears the image queue before restore validation/import can fail. For failures that end maintenance without `keepMaintenance`, the finally block does not resume/bootstrap the queue unless full restore lifecycle verification succeeded.

Failure scenario:
An admin uploads a malformed dump while images are pending. The bad restore fails visibly, maintenance ends, but pre-existing pending image rows stay unprocessed until restart or another bootstrap path.

Fix:
Validate before quiesce where possible, or resume/bootstrap after any failed restore that leaves maintenance. Preserve no-resume behavior for post-import/migration failures that keep maintenance active.

### C8-07 - Analytics top-view queries lack bot/time-window/entity indexes

Severity: Medium
Confidence: High
Status: Confirmed schema/query mismatch
Reported by: critic

Evidence:

- `apps/web/src/lib/analytics-data.ts:1-5`
- `apps/web/src/lib/analytics-data.ts:28-46`
- `apps/web/src/lib/analytics-data.ts:62-79`
- `apps/web/src/lib/analytics-data.ts:161-180`
- `apps/web/src/db/schema.ts:232`
- `apps/web/src/db/schema.ts:245`
- `apps/web/src/db/schema.ts:256`
- `apps/web/drizzle/0010_analytics_views.sql:1-43`

Issue:
Top photo/topic/shared-group analytics queries filter by `bot=false` and optional `viewed_at >= since`, then group by entity, but current indexes lead with the grouped entity rather than the filter window.

Failure scenario:
On production-shaped analytics tables, `/admin/analytics` can devolve into broad scans and temp-table grouping during traffic spikes.

Fix:
Measure with `EXPLAIN ANALYZE`, then add window-compatible aggregate indexes such as `(bot, viewed_at, image_id)`, `(bot, viewed_at, topic)`, and `(bot, viewed_at, group_id)` with migration and reconcile coverage.

### C8-08 - Referrer privacy sanitizer misses IPv4/IPv6 link-local hosts

Severity: Low-Medium
Confidence: High
Status: Confirmed
Reported by: critic; test gap confirmed by test-engineer

Evidence:

- `apps/web/src/lib/analytics.ts:4-10`
- `apps/web/src/lib/analytics.ts:63-77`
- `apps/web/src/lib/analytics.ts:126-136`
- `apps/web/src/__tests__/analytics.test.ts:113-143`

Issue:
The privacy contract says private/link-local referrers become `direct`, but `PRIVATE_IP_RE` omits IPv4 `169.254.0.0/16` and IPv6 `fe80::/10`.

Failure scenario:
Referrers such as `http://169.254.169.254/latest/meta-data/` or `http://[fe80::1]/admin` can be stored as internal-looking hosts instead of `direct`.

Fix:
Extend private-host handling for those ranges or replace regex-only logic with explicit IP/range parsing. Add link-local fixtures.

### C8-09 - Auth/origin lint gates trust helper names without proving import source

Severity: Medium
Confidence: High
Status: Confirmed gate false-confidence risk
Reported by: test-engineer

Evidence:

- `apps/web/scripts/check-api-auth.ts:64-72`
- `apps/web/scripts/check-action-origin.ts:115-121`
- `apps/web/src/__tests__/check-api-auth.test.ts:12-78`
- `apps/web/src/__tests__/check-action-origin.test.ts:17-129`

Issue:
The admin API and action-origin scanners accept any local identifier named `withAdminAuth` or `requireSameOriginAdmin`, regardless of whether it was imported from the security helper module.

Failure scenario:
A future file can define a no-op local helper with the same name and pass the scanner while bypassing the real auth/origin guard.

Fix:
Build approved-import maps and accept only helpers imported from `@/lib/api-auth` and `@/lib/action-guards`, including aliases. Add negative tests for local spoofing and wrong-module imports.

### C8-10 - Public-route rate-limit exemption accepts bare/incidental tags

Severity: Low
Confidence: High
Status: Confirmed gate completeness issue
Reported by: test-engineer

Evidence:

- `apps/web/scripts/check-public-route-rate-limit.ts:1-17`
- `apps/web/scripts/check-public-route-rate-limit.ts:286-295`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:79-100`

Issue:
The scanner documents `@public-no-rate-limit-required: <reason>` but passes when the tag appears anywhere outside strings, even with no reason or in incidental TODO prose.

Failure scenario:
A mutating public route can pass because a stale comment mentions the exemption tag, with no rate limit and no explicit reasoned exception.

Fix:
Parse comments and require the full tag plus non-empty reason, ideally scoped to file/handler comments. Add negative fixtures.

### C8-11 - Action-origin docs/comments still say `public.ts` is excluded

Severity: Low
Confidence: High
Status: Confirmed
Reported by: verifier and document-specialist

Evidence:

- `CLAUDE.md:590-602`
- `apps/web/scripts/check-action-origin.ts:47-72`
- `apps/web/scripts/check-action-origin.ts:328-344`
- `apps/web/src/__tests__/check-action-origin.test.ts:383-394`
- `apps/web/src/__tests__/check-action-origin.test.ts:476-501`
- `apps/web/src/app/actions/public.ts:311-316`

Issue:
Docs, comments, and a test title say `public.ts` is excluded from `lint:action-origin`, but the current scanner includes it and enforces a public rate-limit-before-mutation sub-contract.

Failure scenario:
Maintainers follow stale docs and misunderstand why public actions pass/fail the security gate.

Fix:
Update CLAUDE.md, the `public.ts` header, and the stale test title to document the real scanner behavior.

### C8-12 - Stateful grid fallback hydrates every archive/share image card

Severity: Low-Medium
Confidence: Medium
Status: Risk, confirmed code path
Reported by: perf-reviewer

Evidence:

- `apps/web/src/components/grid-picture.tsx:1-59`
- `apps/web/src/lib/data-timeline.ts:159`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:12`
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:213-257`
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:13`
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:174-215`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:12`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:177-221`

Issue:
Every archive/share image card hydrates a client component and `useState` solely for rare AVIF/WebP fallback handling.

Failure scenario:
Timeline/year pages with up to 500 cards hydrate hundreds of stateful components before low-end mobile devices become responsive.

Fix:
Use static server-rendered `<picture>` markup plus one delegated client listener per grid, or otherwise avoid one stateful client boundary per card.

### C8-13 - Public layout collapses to route error UI when nav data fails

Severity: High
Confidence: High
Status: Confirmed locally
Reported by: designer

Evidence:

- `apps/web/src/components/nav.tsx:6`
- `apps/web/src/app/[locale]/(public)/layout.tsx:7`
- Browser evidence in `designer.md`: local `/en` rendered `Error | GalleryKit` after a DB-backed nav query failure.

Issue:
`<Nav />` awaits topic/SEO/config data without isolation, and the public layout renders it before `<main>`, so nav data failures collapse the entire public shell into the route error UI.

Failure scenario:
Temporary DB/admin-settings failure prevents visitors from seeing otherwise useful public photo/share content or a degraded header.

Fix:
Isolate nav data failures with a fallback/minimal nav or route-level error boundary around `<Nav />`.

### C8-14 - Search modal remains nested in nav landmark and exposes background content to accessibility tree

Severity: Medium
Confidence: High
Status: Confirmed on production snapshot; source-backed
Reported by: designer

Evidence:

- `apps/web/src/components/nav-client.tsx:156`
- `apps/web/src/components/search.tsx:321`
- `apps/web/src/components/search.tsx:334`

Issue:
The custom search overlay renders inline inside the navigation controls with `role="dialog" aria-modal="true"` and focus trap, but no portal/inert/aria-hidden handling for background content.

Failure scenario:
Screen-reader users open search and still traverse background gallery content and landmarks, creating two active contexts.

Fix:
Render the modal through a portal or Radix `Dialog`, and make non-dialog siblings inert/`aria-hidden` while open.

### C8-15 - Photo map lacks a non-map browse fallback

Severity: Medium
Confidence: Medium
Status: Risk; marker runtime could not be live-confirmed
Reported by: designer

Evidence:

- `apps/web/src/app/[locale]/(public)/map/page.tsx:51`
- `apps/web/src/components/map/map-client.tsx:107`
- `apps/web/src/components/map/map-client.tsx:128`

Issue:
When geotagged photos exist, the map route exposes only Leaflet markers/popups without an adjacent structured list of the same photos.

Failure scenario:
Keyboard-only or screen-reader users must operate a slippy map to discover photo links.

Fix:
Render a companion list below the map with the same markers and `View photo` links, plus an accessible summary/instructions.

### C8-16 - Image edit dialog validation is toast-only and not field-associated

Severity: Low
Confidence: Medium
Status: Likely; protected admin runtime not browser-confirmed
Reported by: designer

Evidence:

- `apps/web/src/components/image-manager.tsx:269`
- `apps/web/src/components/image-manager.tsx:275`
- `apps/web/src/components/image-manager.tsx:279`
- `apps/web/src/components/image-manager.tsx:604`
- `apps/web/src/components/image-manager.tsx:608`
- `apps/web/src/components/bulk-edit-dialog.tsx:286`

Issue:
Image edit title/description validation failures only show transient toast errors, with no `maxLength`, counters, `aria-invalid`, or `aria-describedby` on the invalid fields.

Failure scenario:
Admins, especially screen-reader users, get a transient global message but no persistent field-associated correction path.

Fix:
Mirror the bulk-edit inline validation pattern: persistent field errors, `aria-invalid`, `aria-describedby`, counters or `maxLength`, and focus to first invalid field.

## Cross-Agent Agreement

- C8-06 is higher-signal because debugger and tracer independently confirmed the same restore queue-liveness failure.
- C8-08 is higher-signal because critic found the sanitizer bug and test-engineer found the missing link-local fixtures.
- C8-11 is higher-signal because verifier and document-specialist independently reported the same stale action-origin documentation contract.

## Deferred/Previously Known Notes

Some findings overlap historically deferred performance/topology themes, but every current-cycle finding above is preserved here because each reviewer supplied current file/line evidence and a concrete failure scenario. Prompt 2 must either schedule each item for implementation or record a strict deferral with original severity/confidence and an exit criterion.
