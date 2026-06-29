# Test Engineer Review - Cycle 9

Date: 2026-06-29
HEAD inspected: `2506c5f7`
Role: test-engineer lane
Scope: whole-repository test coverage, flaky-test, quality-gate, and TDD-opportunity review. No source code or plans edited. Existing unrelated review-file changes were left untouched.

## Inventory

Required instructions read first: `AGENTS.md`, then `CLAUDE.md`.

Review-relevant inventory:

- Gates and config: `AGENTS.md`, `CLAUDE.md`, root `package.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `.github/workflows/quality.yml`, lint scanner scripts.
- Tests: 254 Vitest files under `apps/web/src/__tests__/` and 5 Playwright specs under `apps/web/e2e/`.
- Source/review surface inventoried: 554 TypeScript/TSX/JS/MJS/SQL/JSON files under `apps/web/src`, `apps/web/e2e`, `apps/web/scripts`, and `apps/web/drizzle`.
- Areas traced: admin auth/origin/rate-limit scanners, privacy guards, migrations/reconcile, audit logging, CLIP semantic search and embedding backfills, image-processing queue settings, public/admin UI e2e, generated screenshots, prior review findings.

This was a static coverage review. I did not run the full Vitest or Playwright suites because the request was to identify coverage gaps rather than validate a changed implementation.

## Confirmed Issues

### TE9-C01 - Semantic text-search route does not regression-test skipping malformed scanned embedding rows

Severity: Medium
Confidence: High
Classification: confirmed coverage gap

Exact region:

- `apps/web/src/app/api/search/semantic/route.ts:264-281` documents and implements malformed scanned rows decoding to `null` and being skipped.
- `apps/web/src/__tests__/semantic-search-route.test.ts:263-326` covers empty results and all-valid enriched results.
- `apps/web/src/__tests__/semantic-search-route.test.ts:328-352` covers DB scan failure and a source-string model-version filter.
- `apps/web/src/__tests__/clip-embedding-column-roundtrip.test.ts:38-92` covers `decodeEmbeddingColumn` itself.
- `apps/web/src/__tests__/similar-route.test.ts:230-241` covers a corrupt target embedding for the similar route, not a corrupt scanned row in semantic text search.

Failure scenario:

A production or legacy database has one malformed `image_embeddings.embedding` value and one valid row. A future refactor removes the `.filter((m) => m !== null)` branch, lets `null` reach `topK`, or changes the route to return 500 on malformed scanned rows. The decoder unit tests and the route's all-valid/empty tests still pass, but live semantic search either fails the whole request or drops valid neighbors after encountering a corrupt row.

Suggested fix:

Add a route-level Vitest case to `semantic-search-route.test.ts` with mixed scanned rows: one corrupt/wrong-length embedding, one valid embedding above threshold, and corresponding image-enrichment rows. Assert status 200, the valid result is returned, the corrupt row is absent, and the semantic rate-limit budget is not rolled back.

### TE9-C02 - `logAuditEvent` serialization/truncation writer path is not behavior-tested

Severity: Medium
Confidence: High
Classification: confirmed coverage gap

Exact region:

- `apps/web/src/lib/audit.ts:47-91` serializes metadata, catches serialization failure, truncates metadata above 4096 chars, preserves code points, and writes `db.insert(auditLog).values(...)`.
- `apps/web/src/__tests__/audit-prioritize-security-fields.test.ts:1-66` tests only the ordering helper used by truncation.
- `apps/web/src/__tests__/audit-retention.test.ts:52-95` tests purge-retention validation, not audit event writes.

Failure scenario:

A future edit reverts code-point slicing to UTF-16 `.slice()`, removes the oversize wrapper, or changes the serialization-failure fallback. Audit metadata can then split surrogate pairs, exceed the DB column budget, or lose the forensic fallback note. Existing audit tests stay green because they never call `logAuditEvent` and inspect the inserted `metadata` value.

Suggested fix:

Add a mocked-DB unit test for `logAuditEvent` that asserts `db.insert(auditLog).values(...)` receives the expected columns for: normal metadata, circular metadata, and oversized metadata containing priority security keys plus an emoji near the truncation boundary. Assert the fallback note, `{ truncated: true, preview: ... }`, priority-key ordering, and no thrown error.

### TE9-C03 - Playwright "visual" screenshots are generated artifacts, not visual assertions

Severity: Medium
Confidence: High
Classification: confirmed generated-artifact blind spot

Exact region:

- `apps/web/e2e/nav-visual-check.spec.ts:6-38` asserts touch target size and overlap only.
- `apps/web/e2e/nav-visual-check.spec.ts:40-79` captures three screenshots to `test-results/*.png`.
- `apps/web/playwright.config.ts:63-67` already enables failure artifacts, but there is no `toHaveScreenshot`/snapshot assertion anywhere under `apps/web/e2e` or `apps/web/src/__tests__`.

Failure scenario:

The nav loses expected spacing, color, expanded-menu placement, or breakpoint composition while still keeping every visible target at least 44 px and non-overlapping. The spec writes new PNGs and passes; CI does not compare them to a baseline, so the generated artifacts create manual-review confidence rather than an automated regression gate.

Suggested fix:

Convert the three raw `page.screenshot({ path })` calls to Playwright `expect(page or nav).toHaveScreenshot(...)` baselines, or replace them with explicit DOM/pixel invariants for the intended nav states. If these files are intentionally manual artifacts, rename the spec or move the screenshots out of pass/fail tests so they are not mistaken for visual regression coverage.

### TE9-C04 - No coverage reporting or threshold gate exists for the critical test surface

Severity: Low
Confidence: High
Classification: confirmed quality-gate blind spot

Exact region:

- Root `package.json:11-22` exposes `test` and `test:e2e`, but no coverage script.
- `apps/web/package.json:8-26` runs `vitest run` and has no `test:coverage` script.
- `apps/web/vitest.config.ts:16-39` configures include/exclude/timeouts only; there is no `coverage` block or threshold.
- `.github/workflows/quality.yml:76-80` runs e2e then build, but no coverage reporting step.

Failure scenario:

A broad change removes branch coverage from a server action, route handler, scanner, or migration helper while keeping the existing 254 test files passing. Reviewers see a large test count but get no signal that touched critical files lost coverage, and CI has no coverage trend or minimum for security/privacy/migration/image-processing code.

Suggested fix:

Add a scoped coverage script first, not necessarily a repo-wide hard threshold on day one. Start with `src/lib`, `src/app/actions`, `src/app/api`, `scripts`, and migration helpers, publish CI coverage artifacts, and set conservative per-file or changed-file thresholds for security/privacy/migration/image-processing modules.

## Likely Issues and TDD Opportunities

### TE9-L01 - `backfillClipEmbeddings` server action is mostly source-contract tested, not behavior-tested

Severity: Low
Confidence: Medium
Classification: likely TDD opportunity

Exact region:

- `apps/web/src/app/actions/embeddings.ts:55-68` performs maintenance/admin/origin/rate-limit gates.
- `apps/web/src/app/actions/embeddings.ts:83-124` chooses semantic mode and filters candidates by active `modelVersion`.
- `apps/web/src/app/actions/embeddings.ts:136-172` processes batches, skips missing production originals, upserts embeddings, and returns processed/skipped counts.
- `apps/web/src/__tests__/backfill-clip-embeddings-reembed.test.ts:19-35` locks only source-string ordering/model-version shape for this action.
- `apps/web/src/__tests__/image-queue-embed-wiring.test.ts:46-50` source-checks upload enqueue semantic-mode snapshot wiring, not this action's runtime behavior.

Failure scenario:

The action remains unwired today, but if it is surfaced later a refactor could preserve the source-string checks while changing behavior: querying before origin validation, rate-limiting the wrong key, writing stub rows in production, failing to skip missing originals, or returning inaccurate processed/skipped counts. Current tests would still pass because they do not execute the action against mocked auth/config/db/encoder paths.

Suggested fix:

Before wiring this action to UI or admin tooling, add a behavior suite with mocked `isAdmin`, `requireSameOriginAdmin`, `getCurrentUser`, `getGalleryConfig`, `db`, `resolveOriginalUploadPath`, and encoders. Cover disabled no-op, unauthorized/origin/rate-limited exits, stub upsert, production missing-original skip, production real-encoder upsert, and per-item failure counted as skipped.

### TE9-L02 - Local blocking-gate documentation omits Playwright e2e even though the formal/CI surface includes it

Severity: Low
Confidence: High
Classification: likely process gap, not a CI omission

Exact region:

- `AGENTS.md:29-37` lists "Quality gates (all blocking)" but omits `npm run test:e2e --workspace=apps/web`.
- `CLAUDE.md:571-578` includes `npm run test:e2e --workspace=apps/web` in the formal test surface.
- Root `package.json:17-18` exposes both `test` and `test:e2e`.
- `.github/workflows/quality.yml:76-80` does run e2e before build, so this is not a missing CI job.

Failure scenario:

An agent or contributor following only the short-form `AGENTS.md` blocking gate list after a route/UI/admin-flow change runs lint, typecheck, build, and Vitest, then reports complete. Playwright would still catch the regression in CI, but the local per-iteration standard is ambiguous and can delay feedback until after push.

Suggested fix:

Add `npm run test:e2e --workspace=apps/web` to `AGENTS.md` or explicitly label it as CI-only/required-for-UI-and-route-changes. A root `npm run test:all` script that chains Vitest plus Playwright would reduce drift between docs and actual CI.

## Risks Needing Manual Validation

### TE9-R01 - Playwright project coverage is Chromium-only

Severity: Low
Confidence: High
Classification: risk needing manual validation

Exact region:

- `apps/web/playwright.config.ts:72-77` defines a single `chromium` project using `Desktop Chrome`.

Failure scenario:

A Safari/WebKit or Firefox-specific issue in CSS layout, dialog focus, image rendering, color handling, or mobile viewport behavior ships because all e2e coverage runs in one browser engine. The repo has extensive unit/source guards, but browser-engine differences remain manual unless CI adds another project.

Suggested fix:

Either document Chromium-only e2e as intentional and schedule manual WebKit/mobile smoke coverage for visual/color-heavy releases, or add a small second Playwright project for the highest-value public smoke flows in WebKit. Keep the full admin suite serial/Chromium if login-rate-limit cost makes multi-browser admin coverage too expensive.

## False Positives / Already Fixed

### TE9-FP01 - Prior tag-filter canonicalization gap is already fixed and source-locked

Status: already fixed
Confidence: High

Evidence:

- `apps/web/src/components/tag-filter.tsx:10-21` accepts `currentTags` and canonicalizes that prop.
- `apps/web/src/components/tag-filter.tsx:29-40` mutates URLs from `canonicalTags`, not raw query params.
- `apps/web/src/components/tag-filter.tsx:66-97` drives active variants and `aria-pressed` from `canonicalTags`.
- `apps/web/src/components/home-client.tsx:255-273` passes canonical `currentTags` into `TagFilter`.

Do not re-file the old finding as a current bug. A browser-level chip-click regression test would still be useful, but the implementation defect from the previous report is no longer present.

### TE9-FP02 - Browser-upload processing-settings forwarding is already behavior-tested

Status: already fixed
Confidence: High

Evidence:

- `apps/web/src/app/actions/images.ts:480-512` forwards upload-time processing settings and semantic mode into `enqueueImageProcessing`.
- `apps/web/src/__tests__/images-actions.test.ts:239-276` behavior-tests the queue payload for quality, sizes, color/chroma/effort, auto-alt, and semantic-search mode.

Do not re-file this as an image-processing coverage gap.

### TE9-FP03 - Migration journal/reconcile coverage is already strong enough for the known silent-skip class

Status: already covered for the reviewed class
Confidence: High

Evidence:

- `apps/web/src/__tests__/migration-journal-monotonicity.test.ts:56-120` checks journal order, strict `when` advancement, and the loud-fail missing-hash predicate.
- `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:76-104` checks that `migrate.js` creates every table and mentions every schema column outside comments.

There is always residual value in live DB integration tests, but the specific Drizzle journal silent-skip and reconcile-drift regressions are not currently untested.

### TE9-FP04 - Public GET rate-limit scanner omission is documented; specific expensive GET routes have targeted tests

Status: documented limitation, not an accidental blind spot
Confidence: High

Evidence:

- `apps/web/scripts/check-public-route-rate-limit.ts:1-12` explicitly says GET handlers are not scanned by the mutating-route gate.
- `apps/web/scripts/check-public-route-rate-limit.ts:36-45` limits the scanner to POST/PUT/PATCH/DELETE and documents the exemption tag.
- `CLAUDE.md:595-599` repeats the same GET limitation and manual-audit requirement.
- `apps/web/src/__tests__/og-rate-limit.test.ts:16-45` and `apps/web/src/__tests__/og-rate-limit.test.ts:63-112` cover OG rate-limit helpers and rollback behavior.
- `apps/web/src/__tests__/similar-route.test.ts:219-228` covers semantic similar-route 429 behavior.

Do not report "GET routes are not scanned" as a new scanner bug without naming a specific unmetered expensive GET route.

## Final Missed-Issue Sweep

Final sweep commands and checks covered:

- `rg` for visual assertions and screenshot artifact usage across `apps/web/e2e` and `apps/web/src/__tests__`.
- `rg` for `logAuditEvent`, audit helper tests, and audit retention tests.
- `rg` for `decodeEmbeddingColumn`, malformed/corrupt embedding cases, semantic route tests, similar route tests, and embedding round-trip tests.
- `rg` for coverage scripts/configuration and threshold terminology in package scripts, Vitest config, CI workflow, `AGENTS.md`, and `CLAUDE.md`.
- Source traces for `backfillClipEmbeddings`, upload enqueue processing snapshots, tag-filter canonical state, migration journal/reconcile coverage, public route scanner scope, OG rate limits, and similar-route rate limits.

No source files or plans were edited. The only intended write from this lane is this report.

## Finding Summary

- TE9-C01: Medium / High - semantic text-search route lacks mixed malformed-row regression coverage.
- TE9-C02: Medium / High - `logAuditEvent` metadata serialization/truncation writer path lacks behavior tests.
- TE9-C03: Medium / High - nav "visual" screenshots are generated artifacts, not visual assertions.
- TE9-C04: Low / High - no coverage script/report/threshold gate for critical surfaces.
- TE9-L01: Low / Medium - `backfillClipEmbeddings` server action needs behavior tests before being surfaced.
- TE9-L02: Low / High - local blocking-gate docs omit e2e despite formal/CI coverage.
- TE9-R01: Low / High - Playwright e2e is Chromium-only; WebKit/Firefox/mobile-engine risks remain manual.
