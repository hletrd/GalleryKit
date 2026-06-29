# Plan 369 — Cycle 8/100 Fixes

Created: 2026-06-29
Source: `.context/reviews/cycle-8-2026-06-29/_aggregate.md` and all per-agent review reports.
Status: IMPLEMENTED

This plan schedules every Cycle 8 aggregate finding for implementation. No current-cycle finding is silently dropped. The only non-code portion is credential rotation for C8-01, which requires external operator authority and cannot be performed from the repository; local repository remediation is still scheduled.

Progress update 2026-06-29:

- Implemented all repository code/test/doc work items below.
- Targeted validation passed:
  - `npm test --workspace=apps/web -- check-api-auth check-action-origin check-public-route-rate-limit env analytics restore-upload-lock grid-picture-fallback-boundary tracked-secrets`
  - `npm test --workspace=apps/web -- image-queue-embed-wiring failed-image-retry cycle-7-source-contracts retry-failed-image-auth images-actions image-queue-settings-wiring`
  - `npm test --workspace=apps/web -- migrate-reconcile-coverage privacy-fields map-privacy view-retention`
- Full configured gates passed:
  - `npm run lint --workspace=apps/web`
  - `npm run lint:api-auth --workspace=apps/web`
  - `npm run lint:action-origin --workspace=apps/web`
  - `npm run lint:public-route-rate-limit --workspace=apps/web`
  - `npm run typecheck --workspace=apps/web`
  - `npm run build --workspace=apps/web`
  - `npm test --workspace=apps/web`
- Gate warning recorded: `npm run build --workspace=apps/web` logged the existing sitemap fallback warning because local MySQL at `127.0.0.1:3306` was unavailable during static generation. Severity: warning. Reason not fixed this cycle: the route already degrades to homepage-only sitemap and the gate exits 0; changing local DB availability is environment setup, not a code defect. Exit criterion: warning reopens if production deploy/build lacks DB access where sitemap completeness is required or if the fallback stops succeeding.

Required gates after implementation:

- `npm run lint --workspace=apps/web`
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- `npm run build --workspace=apps/web`
- `npm test --workspace=apps/web`

Deployment after green gates and pushed commits:

- `npm run deploy`

## Work Items

### 1. Secret hygiene and review-log guard

Status: DONE
Findings: C8-01
Severity/confidence: High / High
Citations: `.context/reviews/logs-cycle4/security-reviewer.log:19495-19496`, `.context/reviews/logs-cycle4/security-reviewer.log:26298-26302`

Implementation:

- Redact the tracked credential values from the review log without copying the values elsewhere.
- Add a repository secret-scan guard that covers tracked source, `.context/**`, and `plan/**` artifacts for env-style secret assignments.
- Wire the guard into the app test or lint surface so future review logs cannot pass silently with `ADMIN_PASSWORD`, `SESSION_SECRET`, `DB_PASSWORD`, token, or key assignment values.
- Document the operator residual: rotate any exposed admin password, session secret, and DB password values that were ever used outside disposable local test contexts.

Acceptance:

- A targeted secret scan fails before redaction and passes after redaction.
- Full gates pass.

Operational residual:

- Credential rotation requires access to the affected runtime environments and secret stores. This cycle cannot perform rotation from local repository code. Exit criterion: operator confirms all exposed values were rotated or proven disposable.

### 2. Bounded concurrency parsing and CLIP admission

Status: DONE
Findings: C8-02, C8-03
Severity/confidence: Medium / High; Medium / Medium-High
Citations: `apps/web/src/lib/clip-model.ts:52-67`, `apps/web/src/lib/clip-model.ts:167-202`, `apps/web/src/lib/image-queue.ts:289-297`, `apps/web/src/lib/image-queue.ts:611-670`, `apps/web/src/app/actions/images.ts:796-810`

Implementation:

- Add a shared positive bounded integer env parser for concurrency knobs.
- Use it for `CLIP_INFERENCE_CONCURRENCY`, `QUEUE_CONCURRENCY`, and `IMAGE_CLEANUP_CONCURRENCY`.
- Move real image embedding preprocessing inside the CLIP slot or otherwise gate the whole real image embedding job behind the same concurrency cap.
- Add tests for `Infinity`, `1e309`, fractional, zero, negative, and oversized values.
- Add a test proving concurrent `embedImageReal()` calls do not enter preprocessing concurrently at default settings.

Acceptance:

- Concurrency env knobs are finite positive integers with documented caps.
- CLIP image preprocessing is bounded by the same governor as model inference.

### 3. Semantic mode snapshots and failed-image retry config authority

Status: DONE
Findings: C8-04, C8-05
Severity/confidence: Medium / High; Medium / High
Citations: `apps/web/src/lib/gallery-config.ts:123-140`, `apps/web/src/lib/image-queue.ts:85-112`, `apps/web/src/lib/image-queue.ts:151-163`, `apps/web/src/lib/image-queue.ts:620-636`, `apps/web/src/app/actions/images.ts:418`, `apps/web/src/app/api/admin/lr/upload/route.ts:424`, `apps/web/src/app/actions/images.ts:1183-1215`, `apps/web/src/lib/image-queue.ts:491-511`

Implementation:

- Reapply the current `SEMANTIC_SEARCH_ALLOW_PRODUCTION` runtime gate before queue-consumed semantic mode can invoke production CLIP.
- Make failed-image retry read strict gallery config, persist a fresh processing snapshot, and enqueue with that snapshot.
- If retry cannot read strict config, leave the row failed and return an admin-visible retry error.
- Add tests for a persisted production snapshot with env opt-out and retry settings-read failure.

Acceptance:

- Stored snapshots cannot force production embeddings when runtime opt-in is absent.
- Retry no longer clears failed state before it has a strict processing snapshot.

### 4. Restore queue lifecycle repair

Status: DONE
Findings: C8-06
Severity/confidence: Medium / High
Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:360-381`, `apps/web/src/app/[locale]/admin/db-actions.ts:443-582`, `apps/web/src/lib/image-queue.ts:953-1007`

Implementation:

- Ensure failed restores that end maintenance also resume/bootstrap the image queue after quiesce.
- Preserve no-resume behavior for post-import/post-migration failures that keep maintenance active.
- Add regression tests for invalid header/dangerous SQL/mysql failure after quiesce and for migration-failure latch behavior.

Acceptance:

- Pre-import validation/import failures no longer strand pending rows after queue quiesce.

### 5. Analytics privacy and index contracts

Status: DONE
Findings: C8-07, C8-08
Severity/confidence: Medium / High; Low-Medium / High
Citations: `apps/web/src/lib/analytics-data.ts:28-46`, `apps/web/src/lib/analytics-data.ts:62-79`, `apps/web/src/lib/analytics-data.ts:161-180`, `apps/web/src/db/schema.ts:232`, `apps/web/src/db/schema.ts:245`, `apps/web/src/db/schema.ts:256`, `apps/web/src/lib/analytics.ts:4-10`, `apps/web/src/lib/analytics.ts:63-77`, `apps/web/src/lib/analytics.ts:126-136`, `apps/web/src/__tests__/analytics.test.ts:113-143`

Implementation:

- Fix `sanitizeReferrerHost()` so IPv4 link-local and IPv6 link-local referrers resolve to `direct`.
- Add analytics tests for `169.254.169.254`, `169.254.1.2`, and bracketed `fe80::1`.
- Add a Drizzle migration, schema indexes, journal entry, and `migrate.js` reconcile coverage for analytics top-view bot/time/entity indexes.
- Update analytics docs/comments so the index contract matches the actual query shape.

Acceptance:

- Link-local privacy fixtures pass.
- Migration journal remains monotonic and migration/reconcile tests pass.

### 6. Security lint gate hardening and docs alignment

Status: DONE
Findings: C8-09, C8-10, C8-11
Severity/confidence: Medium / High; Low / High; Low / High
Citations: `apps/web/scripts/check-api-auth.ts:64-72`, `apps/web/scripts/check-action-origin.ts:115-121`, `apps/web/scripts/check-public-route-rate-limit.ts:286-295`, `CLAUDE.md:590-602`, `apps/web/src/app/actions/public.ts:311-316`, `apps/web/src/__tests__/check-action-origin.test.ts:383-394`

Implementation:

- Require `withAdminAuth` calls to use an identifier imported from `@/lib/api-auth`.
- Require `requireSameOriginAdmin` calls to use an identifier imported from `@/lib/action-guards`.
- Preserve supported alias imports and add negative tests for local spoofing/wrong-module imports.
- Require `@public-no-rate-limit-required: <non-empty reason>` in comments, not arbitrary tag mentions.
- Update `CLAUDE.md`, `public.ts` header comments, and stale test names to document the current public-action sub-contract.

Acceptance:

- Auth/origin/rate-limit scanner tests fail on spoof/bare-tag cases and pass on current source.

### 7. Public UI resilience and accessibility

Status: DONE
Findings: C8-13, C8-14, C8-15, C8-16
Severity/confidence: High / High; Medium / High; Medium / Medium; Low / Medium
Citations: `apps/web/src/components/nav.tsx:6`, `apps/web/src/app/[locale]/(public)/layout.tsx:7`, `apps/web/src/components/nav-client.tsx:156`, `apps/web/src/components/search.tsx:321`, `apps/web/src/components/search.tsx:334`, `apps/web/src/app/[locale]/(public)/map/page.tsx:51`, `apps/web/src/components/map/map-client.tsx:107`, `apps/web/src/components/map/map-client.tsx:128`, `apps/web/src/components/image-manager.tsx:269`, `apps/web/src/components/image-manager.tsx:604`, `apps/web/src/components/image-manager.tsx:608`

Implementation:

- Isolate public nav data failures so a minimal shell still renders when topic/SEO/config data fails.
- Move the search modal out of the nav landmark or use the existing dialog primitive; make non-dialog content inert/hidden for assistive technology while open.
- Add an accessible non-map list for geotagged map photos using the same marker data.
- Add field-associated validation for image edit title/description, including persistent inline errors and ARIA associations.
- Add focused tests/source-contracts where browser coverage is not practical.

Acceptance:

- Local source/tests prove degraded nav, modal accessibility, map fallback, and field validation behavior.

### 8. Grid picture hydration reduction

Status: DONE
Findings: C8-12
Severity/confidence: Low-Medium / Medium
Citations: `apps/web/src/components/grid-picture.tsx:1-59`, `apps/web/src/lib/data-timeline.ts:159`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:213-257`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:174-215`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:177-221`

Implementation:

- Replace per-card stateful fallback with a delegated grid-level fallback or another approach that avoids one hydrated state cell per card.
- Preserve AVIF/WebP-to-JPEG fallback behavior.
- Add a source or component contract proving archive/share grids use the lower-hydration fallback path and broken sources still resolve.

Acceptance:

- Grid card fallback behavior remains, with less per-card client hydration.

## Coverage Assertion

- C8-01 -> Work item 1.
- C8-02, C8-03 -> Work item 2.
- C8-04, C8-05 -> Work item 3.
- C8-06 -> Work item 4.
- C8-07, C8-08 -> Work item 5.
- C8-09, C8-10, C8-11 -> Work item 6.
- C8-13, C8-14, C8-15, C8-16 -> Work item 7.
- C8-12 -> Work item 8.

No current-cycle finding is deferred as code work. Credential rotation from C8-01 is recorded as an external operational residual requiring operator authority.
