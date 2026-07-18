# Verifier — cycle 2 provenance

Target: `ba4bc60acd4bc41b29ec02f509c3455d115ba083`, 2026-07-18 KST. Review only.

## Relevant-file inventory

Verification inventory included 369 Vitest files, 9 Playwright specs (48 listed tests), all quality/security scanner scripts, package scripts, CI workflows, TypeScript/ESLint/Vitest/Playwright configs, build hooks and generated SW/PWA assets, migrations/reconcile tests, deploy contract tests, route/action/component source those tests claim to cover, and governing docs. Repository-wide source/config inventory was 939 files.

## Executed evidence

- PASS: `npm run lint --workspace=apps/web`
- PASS: `npm run typecheck --workspace=apps/web`
- PASS: `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`
- PASS: Vitest — 361 files passed, 2 skipped; 3,408 tests passed, 4 skipped
- PASS: production build (Next 16.2.10)
- PASS: `npm run audit:prod` — 0 vulnerabilities
- PASS: Playwright discovery — 48 tests in 9 files
- Manual-validation limitation: browser E2E was not executed because local MySQL was unavailable; real CLIP preflight lacked seeded weights; proxy-topology probe lacked a target `--url`.

## Findings

### VER-2-01 — The build gate passes while sealing a known-incomplete sitemap for 3,600 seconds

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed** by build log and artifact
- Region: `apps/web/src/app/sitemap.ts:36-82`; `.next/prerender-manifest.json` `/sitemap.xml`; `.next/server/app/sitemap.xml.body`

Failure scenario: the build logged `ECONNREFUSED 127.0.0.1:3306`, emitted fallback sitemap content, returned exit 0, and wrote `initialRevalidateSeconds: 3600`. The gate therefore certifies compilation, not the first-hour production sitemap contract.

Suggested fix: add a post-build assertion or integration test that fails if a DB-less fallback is persisted as a fresh ISR artifact; preferably change the route ownership so the first runtime request generates authoritative content.

### VER-2-02 — Deploy ownership verification asserts syntax, not the rejected privilege scenario

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed test-evidence gap**
- Region: `apps/web/src/__tests__/deploy-script-contract.test.ts:94-108,127-175`; `scripts/deploy-remote.sh:61-75`

Failure scenario: tests assert the repository-owner exception text exists, so they pass while privileged execution still trusts a less-privileged checkout owner. Existing subprocess tests vary mode, not UID ownership.

Suggested fix: run the helper in a container/user-namespace fixture with distinct current, repository-owner, and env-owner UIDs and assert only an explicit allowlist can cross ownership.

## Final sweep

I reconciled command results against documented blocking gates, skipped/env-gated suites, generated artifacts, source-contract tests, and recent targeted tests. No additional failing gate or contradicted pass claim was found. E2E/CLIP/proxy results remain manual validation, not inferred passes.
