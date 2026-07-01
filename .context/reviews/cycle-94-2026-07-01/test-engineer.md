# Cycle 94 Test-Engineer / Verifier Review

Scope: `/tmp/gallery-recovery-check` at `33eca7b5e4102bd5097777dbb926ee2cb94c6d71` (`HEAD == origin/master == origin/HEAD` during review). Read-only source review; no source files edited.

Focus areas requested: lint guards, privacy guards, migrations, uploads, image pipeline, public API rate limits, and recent plan/review history.

## Confirmed Safe/Narrow Findings

### C94-TE-01 - Cycle 93 release ledger is stale after the pushed commit

- Severity / confidence: Medium / High.
- Citations: `.context/plans/cycle-93-2026-07-01-plan.md:50`, `.context/plans/cycle-93-2026-07-01-plan.md:51`, `.context/plans/cycle-93-2026-07-01-plan.md:52`, `.context/plans/README.md:5`, `.context/plans/README.md:7`, `.context/reviews/_aggregate.md:3`.
- Evidence: `git rev-parse HEAD` and `git rev-parse origin/master` both returned `33eca7b5e4102bd5097777dbb926ee2cb94c6d71`; `git show --show-signature HEAD` reported a good GPG signature for `fix(a11y): ♿ make cycle 93 failures perceivable`.
- Problem: the committed Cycle 93 plan records all gates passing but still leaves commit/pull-rebase/push, deploy, and production smoke unchecked. The plan index also still marks Cycle 93 active.
- Failure scenario: Cycle 94 cannot prove from committed artifacts whether the pushed Cycle 93 commit was deployed and smoked, so later cycles may make release decisions from stale terminal state.
- Suggested narrow fix: update the Cycle 93 plan/index/latest aggregate with terminal evidence for `33eca7b`, including whether deploy/smoke happened. If deploy/smoke did not happen, keep that explicit and schedule the missing release step.

### C94-TE-02 - Lightroom upload API still lacks route-level behavior coverage

- Severity / confidence: Medium / High.
- Citations: `apps/web/src/app/api/admin/lr/upload/route.ts:84`, `apps/web/src/app/api/admin/lr/upload/route.ts:94`, `apps/web/src/app/api/admin/lr/upload/route.ts:117`, `apps/web/src/app/api/admin/lr/upload/route.ts:123`, `apps/web/src/app/api/admin/lr/upload/route.ts:583`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:7`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:8`, `.context/plans/cycle-93-2026-07-01-deferred.md:17`.
- Problem: the PAT upload route is a high-value integration path, but current coverage is mostly source-contract scanning. That locks important wiring, but it does not execute the route's early rejection branches, wrapper behavior, multipart boundary, success response, or cleanup path.
- Failure scenario: a refactor can keep source strings such as `allowTokenScope: 'lr:upload'`, restore-maintenance checks, or cleanup helper names while changing runtime order or response behavior. The source-contract test can stay green while Lightroom clients see wrong status codes, missing `no-store` headers, leaked temporary/original files, or broken success JSON.
- Suggested tests: add a focused mocked route-level suite for `/api/admin/lr/upload` that invokes `POST` with controlled `NextRequest`/`Request` objects and module mocks. Cover at least token/scope rejection through `withAdminAuth`, restore-maintenance `503`, missing/invalid `Content-Length` `411`, over-limit `429`/`413`, parsed-file too-large rejection, one happy-path `201 { success: true, id }`, and cleanup on post-save failure.

### C94-TE-03 - Admin Playwright navigation still omits first-class admin pages

- Severity / confidence: Medium / High.
- Citations: `apps/web/src/components/admin-nav.tsx:16`, `apps/web/src/components/admin-nav.tsx:17`, `apps/web/src/components/admin-nav.tsx:18`, `apps/web/src/components/admin-nav.tsx:19`, `apps/web/src/components/admin-nav.tsx:20`, `apps/web/src/components/admin-nav.tsx:21`, `apps/web/src/components/admin-nav.tsx:22`, `apps/web/src/components/admin-nav.tsx:23`, `apps/web/src/components/admin-nav.tsx:24`, `apps/web/src/components/admin-nav.tsx:25`, `apps/web/e2e/admin.spec.ts:20`, `apps/web/e2e/admin.spec.ts:24`, `apps/web/e2e/admin.spec.ts:28`, `apps/web/e2e/admin.spec.ts:32`, `apps/web/e2e/admin.spec.ts:36`, `apps/web/e2e/admin.spec.ts:40`, `apps/web/src/__tests__/client-source-contracts.test.ts:57`, `apps/web/src/__tests__/client-source-contracts.test.ts:68`.
- Problem: source-contract metadata covers 11 admin pages, and the nav exposes 10 protected admin destinations, but the Playwright navigation smoke visits only categories, tags, users, password, and db.
- Failure scenario: dashboard, analytics, SEO, settings, or tokens can fail behind authentication while the admin E2E gate remains green. This matters because several recent fixes touched tokens/settings/admin UI behavior.
- Suggested tests: extend `apps/web/e2e/admin.spec.ts` with a small parameterized authenticated navigation smoke for every `AdminNav` destination, asserting one stable landmark/control per page. Keep it under the existing `adminE2EEnabled` gate and avoid mutating state except where a `finally` cleanup already exists.

## Areas Checked With No New Safe/Narrow Finding

- Lint guards: fixture coverage exists for admin API auth wrappers, server-action origin guards, and public route rate-limit scanning (`apps/web/src/__tests__/check-api-auth.test.ts:14`, `apps/web/src/__tests__/check-action-origin.test.ts:27`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:6`). Cycle 93 gate evidence also records the three custom lint guards passing (`.context/plans/cycle-93-2026-07-01-plan.md:58`, `.context/plans/cycle-93-2026-07-01-plan.md:59`, `.context/plans/cycle-93-2026-07-01-plan.md:60`).
- Privacy guards: symmetric admin-only/public field coverage includes the sensitive-key fixture, exact admin-only set assertion, timeline mirror, and search enrichment guard (`apps/web/src/__tests__/privacy-fields.test.ts:7`, `apps/web/src/__tests__/privacy-fields.test.ts:86`, `apps/web/src/__tests__/privacy-fields.test.ts:104`, `apps/web/src/__tests__/privacy-fields.test.ts:126`).
- Migrations: journal/index/schema reconcile tripwires cover monotonic `when`, tag/file pairing, silent-skip postcondition, full schema column presence, index mirrors, and FK repair (`apps/web/src/__tests__/migration-journal.test.ts:75`, `apps/web/src/__tests__/migration-journal.test.ts:118`, `apps/web/src/__tests__/migration-journal-monotonicity.test.ts:113`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:76`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:124`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:175`).
- Image pipeline: representative coverage exists for post-encode AVIF/WebP color verification and variant cleanup scanning (`apps/web/src/__tests__/process-image-post-encode-verification.test.ts:4`, `apps/web/src/__tests__/process-image-post-encode-verification.test.ts:132`, `apps/web/src/__tests__/process-image-variant-scan.test.ts:13`).

## Broader Deferred Items Not Classified Safe/Narrow Here

The Cycle 93 deferred ledger still contains real confirmed issues that are not narrow test-engineer fixes by themselves: coverage thresholds, sitemap policy, restore foreground mutation fencing, semantic embedding schema versioning, keyboard zoom pan design, and mobile admin redesign (`.context/plans/cycle-93-2026-07-01-deferred.md:39`, `.context/plans/cycle-93-2026-07-01-deferred.md:47`, `.context/plans/cycle-93-2026-07-01-deferred.md:75`, `.context/plans/cycle-93-2026-07-01-deferred.md:83`, `.context/plans/cycle-93-2026-07-01-deferred.md:94`, `.context/plans/cycle-93-2026-07-01-deferred.md:105`). I did not reclassify those as safe/narrow Cycle 94 fixes.

## Validation Notes

- No source files were edited.
- No test suite was executed, to keep this review read-only and avoid incidental generated output. Evidence is from source, test, plan, review, and git-state inspection.
