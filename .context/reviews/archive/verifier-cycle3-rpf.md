# Verifier Review — Prompt 1 / Cycle 3 RPF

## Verdict

**PARTIAL**

The repo’s core verification gates are currently green, but I found two correctness gaps:

1. `npm run build` can silently ship a homepage-only sitemap when the DB is unavailable.
2. The production guard that blocks legacy public original uploads is wired into startup, but it has no dedicated regression test coverage.

## Evidence

### Gates that passed

- `npm test --workspace=apps/web -- src/__tests__/request-origin.test.ts src/__tests__/rate-limit.test.ts src/__tests__/auth-rate-limit.test.ts src/__tests__/health-route.test.ts src/__tests__/live-route.test.ts src/__tests__/next-config.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/seo-actions.test.ts src/__tests__/content-security-policy.test.ts`
  - Result: **10 files passed, 75 tests passed**
- `npm run typecheck --workspace=apps/web`
  - Result: **passed**
- `npm run lint --workspace=apps/web`
  - Result: **passed**
- `npm run build --workspace=apps/web`
  - Result: **passed**, but emitted a runtime warning during sitemap generation:
    - `[sitemap] falling back to homepage-only sitemap: Error: Failed query ... Access denied for user ''@'192.168.65.1'`

### Relevant docs

- `README.md:142-149`
  - Documents production build URL requirements, but does **not** mention that sitemap generation can fall back to a reduced homepage-only artifact when DB access is missing.
- `apps/web/README.md:36-43`
  - Same omission at app-doc level.

### Relevant code

- `apps/web/src/app/sitemap.ts:24-46`
  - Wraps the DB-backed sitemap query in a blanket `try/catch`, logs a warning, and returns a minimal homepage-only sitemap.
- `apps/web/src/instrumentation.ts:1-35`
  - Calls `assertNoLegacyPublicOriginalUploads({ failInProduction: true })` on Node startup.
- `apps/web/src/lib/upload-paths.ts:82-103`
  - Implements the fail-closed legacy-original check.

## Findings

| Severity | Confidence | Finding | Failure scenario | Fix |
|---|---|---|---|---|
| Medium | High | **`/sitemap.xml` can silently degrade to homepage-only output during `next build` or on a DB outage.** The sitemap route catches all DB failures, logs a warning, and returns a minimal sitemap instead of failing the build or surfacing an explicit error. This happened in the current build run when the DB was unreachable. | A production image built without DB credentials, or a build-time DB outage, ships successfully but loses topic/image URLs from the sitemap until a later runtime revalidation succeeds. That is an SEO regression that the current build gate does not catch. | Either fail the build on sitemap DB failure, or document the fallback explicitly and add a dedicated test/alert so the degraded artifact is intentional and visible. |
| Low–Medium | High | **The production guard against legacy public-original uploads has no dedicated regression test.** Startup wiring exists, but there is no matching coverage under `apps/web/src/__tests__/` for `assertNoLegacyPublicOriginalUploads` / `instrumentation.register()`. | A future refactor could stop invoking the guard or weaken the check, and production would again start with public originals present, without any test failure catching the regression. | Add a unit test for `assertNoLegacyPublicOriginalUploads` covering the fail-closed production path and a small integration test that proves `register()` invokes it before queue bootstrap. |

## Gaps

- I did **not** find a regression in the verified auth, rate-limit, backup-download, privacy, request-origin, health/live, CSP, SEO, lint, typecheck, or build gates.
- I did **not** edit implementation code.

## Risks

- The build currently succeeds even when the DB is unavailable, which can mask an incomplete sitemap artifact.
- The startup-only legacy-original guard is security-sensitive, so the lack of direct test coverage is a nontrivial blind spot.
