# Test engineer — cycle 2 provenance

Target: `ba4bc60acd4bc41b29ec02f509c3455d115ba083`, 2026-07-18 KST. Review only.

## Relevant-file inventory

Test inventory: 369 `src/__tests__` files; 9 Playwright specs / 48 discovered browser tests; three custom security scanners and their fixtures; typecheck/build hooks; CI workflows; CLIP env-gated suites; migration/reconcile fixtures; deploy-script tests; generated service-worker contracts; touch-target/i18n/privacy/source-contract suites. I traced tests to all changed production files and inspected uncovered deploy/build-runtime branches across the 939-file repository inventory.

## Findings

### TEST-2-01 — Deploy ownership tests lock in the vulnerable expression instead of testing trust behavior

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed**
- Region: `apps/web/src/__tests__/deploy-script-contract.test.ts:94-108,127-175`; deploy scripts’ owner checks

Failure scenario: the suite passes because the exact `repo_owner_uid` exception string exists. Subprocess tests cover unsafe mode only, so current UID root + repository UID unprivileged + env UID repository-owner is never exercised.

Suggested fix: containerized/user-namespace cross-UID matrix with sentinels for source, `bash -lc`, git, and Docker execution.

### TEST-2-02 — Sitemap tests bypass the cache layer where the defect exists

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed**
- Region: `apps/web/src/__tests__/sitemap-robots.test.ts:28-107`; `apps/web/src/app/sitemap.ts:4-12`

Failure scenario: direct mocked calls prove fallback content and successful DB content separately, but never build the route or inspect initial ISR freshness. All 3,408 tests pass while the built fallback is cached for 3,600 seconds.

Suggested fix: post-build manifest/body assertion plus a server integration test: build without DB, start with DB, request sitemap immediately, and require authoritative topic/photo rows.

### TEST-2-03 — Deploy health tests verify ordering but not recovery

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed; revalidated carry-forward gap**
- Region: `apps/web/src/__tests__/deploy-script-contract.test.ts:27-56`; `apps/web/deploy.sh:63-89`

Failure scenario: the test only requires health failure before prune. It does not require rollback, candidate cleanup, or continued availability, so the broken release is correctly detected but left serving/restarting.

Suggested fix: fake Docker state machine test asserting the previous image/container is restored and healthy after candidate failure, or test blue/green promotion semantics.

## Execution and final sweep

Vitest, lint, typecheck, build, security scanners, and audit passed; Playwright discovery listed 48 tests. Browser E2E, real CLIP, and live proxy topology remain manual-validation because this workspace lacked MySQL/model weights/target URL. I swept skipped tests, source-only assertions, false-positive/negative scanner fixtures, race/concurrency tests, generated artifacts, and recent-change coverage; no additional high-confidence test gap was confirmed.
