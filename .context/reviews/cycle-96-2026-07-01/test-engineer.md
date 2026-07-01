# Cycle 96 Test-Engineer Review

## Scope and inventory

Read-only review at `HEAD == origin/master == 2f22620c361304ba0408053f546f45e3c74ddfdb`. No files modified; no tests executed to avoid incidental generated output.

Inventory was built across the full current tree, not a sampled subset:

| Area | Inventory |
|---|---:|
| Vitest unit specs | 304 `apps/web/src/__tests__/*.test.{ts,tsx}` |
| Test fixtures | 4 CLIP fixtures + 2 E2E image fixtures |
| Playwright specs | 5 `apps/web/e2e/*.spec.ts` |
| Gate/config files | package scripts, Vitest, Playwright, ESLint, TS configs, GitHub quality workflow |
| API route files | 8 |
| Server action files | 14 |
| Admin page files | 11 |
| Public page files | 10 |
| Lib/component/db files reviewed as source surface | 165 |
| Drizzle SQL + journal files | 30 |

Repo rules/gates checked against `AGENTS.md:29-38`, `CLAUDE.md:601-608`, `apps/web/package.json:13-27`, and `.github/workflows/quality.yml:54-80`.

## Confirmed findings

### C96-TE-01 — Current `HEAD` release/deploy evidence is not represented in durable ledgers

- **Severity:** Medium
- **Confidence:** High
- **Problem:** Current `HEAD`/`origin/master` is `2f22620c...`, but committed review-plan ledgers still describe Cycle 95 as closed/deployed at `2178046587484fb301bc731f855699e44888d2e6`.
- **Evidence:** `.context/plans/README.md:7`, `.context/plans/cycle-95-2026-07-01-plan.md:56`, `.context/reviews/_aggregate.md:29`.
- **Concrete failure scenario:** Cycle 96 or later agents treat `2178046` as the latest deployed reviewed state, while `2f22620c` is actually on `master`; deploy/smoke evidence for the current commit can be skipped or repeatedly rediscovered as stale release-ledger drift.
- **Suggested fix:** Record `2f22620c...` as current pushed/deployed/smoked state if already deployed; otherwise run the approved deploy path and then update the durable plan/index/aggregate evidence.

### C96-TE-02 — Lightroom upload API still lacks route-level behavior coverage

- **Severity:** Medium
- **Confidence:** High
- **Problem:** `/api/admin/lr/upload` has many high-value runtime branches, but current LR coverage is source-text contract coverage rather than invoking the route handler.
- **Evidence:** Route branches at `apps/web/src/app/api/admin/lr/upload/route.ts:84-128`, success response at `apps/web/src/app/api/admin/lr/upload/route.ts:583-593`; source-contract test reads the route as text at `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:7-10` and `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:22-25`. Deferred ledger confirms this remains active at `.context/plans/cycle-95-2026-07-01-deferred.md:20-25`.
- **Concrete failure scenario:** A refactor preserves strings like `allowTokenScope: 'lr:upload'` and `Content-Length` checks, so source tests pass, while runtime returns wrong status/headers, leaks temporary files, or breaks Lightroom success JSON.
- **Suggested fix:** Add a mocked route-level Vitest suite invoking `POST` with controlled `NextRequest`/`Request` objects. Cover token/scope rejection, restore `503`, missing/invalid `Content-Length`, over-limit branches, parsed-file too-large, happy-path `201`, and cleanup after post-save failure.

### C96-TE-03 — Admin E2E still omits first-class admin destinations

- **Severity:** Medium
- **Confidence:** High
- **Problem:** `AdminNav` exposes 10 protected destinations, but Playwright navigation coverage clicks/asserts only a subset.
- **Evidence:** Admin destinations are listed at `apps/web/src/components/admin-nav.tsx:15-25`. Current E2E clicks categories/tags/users/password/db at `apps/web/e2e/admin.spec.ts:24-42` and settings at `apps/web/e2e/admin.spec.ts:76-80`; login lands on dashboard via helper at `apps/web/e2e/helpers.ts:183-195`. Metadata source-contract coverage includes all admin routes but is not browser execution coverage at `apps/web/src/__tests__/client-source-contracts.test.ts:57-68`. Deferred ledger: `.context/plans/cycle-95-2026-07-01-deferred.md:27-32`.
- **Concrete failure scenario:** SEO, Tokens, or Analytics can fail after authentication while CI remains green because no browser spec visits those pages.
- **Suggested fix:** Add a parameterized authenticated navigation smoke for every `AdminNav` destination, asserting one stable landmark/control per page.

### C96-TE-04 — Unit gate has no coverage instrumentation or threshold

- **Severity:** Low
- **Confidence:** High
- **Problem:** The unit test script runs `vitest run` without coverage, and Vitest config defines include/exclude/timeout only.
- **Evidence:** `apps/web/package.json:13`, `apps/web/vitest.config.ts:16-38`; historical deferred item at `.context/plans/cycle-93-2026-07-01-deferred.md:40-45`.
- **Concrete failure scenario:** A broad module can lose meaningful behavioral coverage while all handpicked regression tests still pass; no gate reports reduced line/branch/function coverage.
- **Suggested fix:** Add agreed conservative coverage instrumentation/thresholds, likely starting with reporting-only or targeted thresholds for critical modules before making it blocking.

### C96-TE-05 — Restore maintenance lacks regression locks for mid-flight non-upload admin writes

- **Severity:** High
- **Confidence:** High
- **Problem:** Several non-upload mutations check restore maintenance only at entry, then perform validation/DB work later without a shared write barrier.
- **Evidence:** Settings precheck at `apps/web/src/app/actions/settings.ts:41-48`, later transaction at `apps/web/src/app/actions/settings.ts:163-172`; tags precheck at `apps/web/src/app/actions/tags.ts:42-49`, later transaction/update at `apps/web/src/app/actions/tags.ts:82-95`; smart collections precheck/write examples at `apps/web/src/app/actions/collections.ts:15-21`, `apps/web/src/app/actions/collections.ts:45-51`, `apps/web/src/app/actions/collections.ts:64-70`, `apps/web/src/app/actions/collections.ts:95-99`, `apps/web/src/app/actions/collections.ts:112-123`. Current restore tests cover state primitives/upload cleanup, not cross-action write fencing, at `apps/web/src/__tests__/restore-maintenance.test.ts:31-66`. Deferred ledger: `.context/plans/cycle-95-2026-07-01-deferred.md:55-60`.
- **Concrete failure scenario:** Restore begins after an action’s entry precheck but before its transaction; the action writes application rows into a DB being restored.
- **Suggested fix:** TDD first: write representative tests proving each admin-write family aborts after restore begins mid-flight; then introduce a shared restore/admin-write barrier and use it around final write sections.

### C96-TE-06 — Embedding model-version tests lock overwrite behavior, not multi-version retention

- **Severity:** Medium
- **Confidence:** High
- **Problem:** `image_embeddings` is keyed by `image_id`, so stub/production versions overwrite each other instead of retaining one row per `(image_id, model_version)`.
- **Evidence:** Schema primary key at `apps/web/src/db/schema.ts:284-290`; queue upsert overwrites on duplicate image id at `apps/web/src/lib/image-queue.ts:379-390`; backfill explicitly documents replacement at `apps/web/scripts/backfill-clip-embeddings.ts:27-42` and upserts at `apps/web/scripts/backfill-clip-embeddings.ts:212-222`; tests assert model-version-aware selection but not multi-version retention at `apps/web/src/__tests__/backfill-clip-embeddings-reembed.test.ts:4-9`. Deferred ledger: `.context/plans/cycle-95-2026-07-01-deferred.md:62-67`.
- **Concrete failure scenario:** Operators cannot stage a new model version beside the active one; backfill replaces current vectors, making rollback/comparison harder.
- **Suggested fix:** TDD migration first: tests for composite `(image_id, model_version)` storage, route filtering, backfill preserving inactive rows, and reconcile/migration journal coverage; then migrate schema and upsert logic.

## Manual-validation risks

### MV-01 — Real CLIP semantic behavior is intentionally skipped by default

- **Severity:** Low
- **Confidence:** High
- **Problem:** Real model integration and offline-load tests skip unless explicit env/model weights are present.
- **Evidence:** `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-10`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:30-32`, `apps/web/src/__tests__/clip-offline-load.test.ts:15-21`, `apps/web/src/__tests__/clip-offline-load.test.ts:41`; production activation requires operator steps at `CLAUDE.md:548-557`.
- **Scenario:** Default CI stays green while production CLIP weights/path/model runtime is broken.
- **Suggested fix:** Keep default skip, but require periodic/manual evidence before production activation and record it in release notes.

### MV-02 — Browser E2E matrix is Chromium desktop only

- **Severity:** Low
- **Confidence:** High
- **Problem:** Playwright config defines only Desktop Chrome.
- **Evidence:** `apps/web/playwright.config.ts:72-77`.
- **Scenario:** WebKit/Safari, Firefox, or mobile viewport regressions pass CI.
- **Suggested fix:** Add periodic or opt-in mobile/WebKit smoke coverage for public gallery, lightbox, admin login, and upload-critical flows.

## Flaky-test risk sweep

No confirmed active flaky-test defect found. Existing Playwright config deliberately serializes E2E to avoid admin login rate-limit races at `apps/web/playwright.config.ts:50-58`.

## Final missed-issue sweep and coverage statement

- Compared all 8 API routes against route-level/source-contract coverage; only LR upload remains confirmed as source-contract-only for critical behavior.
- Compared all 10 `AdminNav` destinations against Playwright navigation assertions; SEO, Tokens, and Analytics remain unvisited by browser E2E.
- Scanned skip/todo surfaces; skips are env-gated E2E/CLIP paths, not hidden `it.skip` unit debt.
- Checked lint/privacy/migration tripwires; no new confirmed gap beyond findings above.
- No confirmed new app-source defect from the latest docs-only commit; the new confirmed issue is release-evidence drift for current `HEAD`.