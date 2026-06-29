# Security Reviewer — review-plan-fix cycle 2

Role: `security-reviewer`
HEAD reviewed: `3d138704` (`build(sw): 🔨 update post-build service worker stamp`)
Date: 2026-06-29

## Inventory Coverage

- Read the control docs: `AGENTS.md`, `CLAUDE.md`.
- Inspected current HEAD, recent commit history, root/workspace package metadata, lockfile, source tree, tests, scripts, migrations, nginx/Docker/deploy config, and relevant current `.context/reviews/` / `.context/plans/` docs.
- Inventory snapshot: 2,489 tracked files; 480 `apps/web/src` files; 258 tracked tests/e2e files; 28 scripts; 28 migration/meta files; 1,663 tracked review docs; 59 tracked plan docs.
- Secrets sweep covered tracked secret-like paths plus local env-file presence. Tracked env-like files are examples only (`.env.deploy.example`, `apps/web/.env.local.example`). Live ignored files exist (`.env.deploy`, `apps/web/.env.local`) and were intentionally not opened to avoid exposing local secrets.
- Final missed-issues sweep included auth/authz, session/cookie handling, CSRF/origin, admin API wrappers, PAT token path, upload/file serving, DB export/restore, SQL scanning, semantic search, OG generation, public/privacy field separation, deployment edge controls, scripts, and tests.

## Validation Evidence

- `npm audit --workspace=apps/web --audit-level=low --json`: 0 vulnerabilities.
- `npm run lint:api-auth --workspace=apps/web`: pass; all admin API routes wrapped by `withAdminAuth`.
- `npm run lint:action-origin --workspace=apps/web`: pass; all mutating server actions enforce same-origin provenance or documented exemption.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: pass; public mutating API scan passes and semantic route uses rate-limit helper.
- `npm test --workspace=apps/web -- privacy-fields check-api-auth check-action-origin check-public-route-rate-limit sql-restore-scan semantic-route-production og-photo-fallback backup-download-route request-origin`: 9 files / 120 tests passed.

## Confirmed Findings

No confirmed current security defects found in this pass.

The previous cycle's per-photo OG fallback host issue is fixed: internal fetches are pinned to `siteConfig.url` and fail closed on invalid canonical configuration (`apps/web/src/app/api/og/photo/[id]/route.tsx:101-119`), while fallback redirects derive from `canonicalBaseUrl` and validate same-origin configured OG URLs (`apps/web/src/app/api/og/photo/[id]/route.tsx:252-298`). The source contract test pins this (`apps/web/src/__tests__/og-photo-fallback.test.ts:77-86`).

## Residual Risks / Non-Defects

### SEC-RISK-01 — Unsupported horizontal scaling weakens process-local security controls

Status: Risk, not a confirmed defect under the documented deployment topology.
Severity: Medium
Confidence: High

Evidence:
- `CLAUDE.md:224-227` explicitly documents a single web-instance / single-writer topology and says restore maintenance flags, upload quota tracking, queue state, admin-backfill status, and non-login rate-limit fast paths are process-local.
- OG/share/search/semantic limiter maps are in-process (`apps/web/src/lib/rate-limit.ts:68-89`, `apps/web/src/lib/rate-limit.ts:103-108`, `apps/web/src/lib/rate-limit.ts:314-318`).
- Restore maintenance state is a `globalThis` symbol (`apps/web/src/lib/restore-maintenance.ts:1-55`).
- Upload quota tracking is a `globalThis` map (`apps/web/src/lib/upload-tracker-state.ts:7-20`).

Failure scenario:
If an operator runs multiple web instances without moving these states to a shared store, public rate limits become per-instance, restore maintenance may not fence uploads in another process, and upload quota claims can be split across instances. That weakens DoS controls and can create restore/upload race exposure.

Suggested fix:
Keep the documented single-instance topology enforced operationally, or migrate these states to a shared store / DB-backed contract before scaling horizontally. A startup guard that fails when multiple replicas are configured without an explicit shared-state mode would reduce accidental drift.

### SEC-RISK-02 — Direct exposure of the standalone container bypasses edge controls

Status: Risk, not a confirmed defect in the shipped compose/nginx deployment.
Severity: Medium
Confidence: Medium

Evidence:
- The shipped compose deployment binds the app to localhost and documents nginx as the security/rate-limit edge (`apps/web/docker-compose.yml:14-21`).
- The Docker image default still sets `HOSTNAME="0.0.0.0"` (`apps/web/Dockerfile:83-85`), relying on compose/environment override in production.
- Nginx carries the narrow default body limit, admin/login body caps, admin API throttles, and upload exceptions (`apps/web/nginx/default.conf:25-31`, `apps/web/nginx/default.conf:56-60`, `apps/web/nginx/default.conf:72-76`, `apps/web/nginx/default.conf:89-93`, `apps/web/nginx/default.conf:131-150`).

Failure scenario:
If the production image is launched outside the documented compose/nginx envelope and exposed directly, the app remains authenticated/origin-guarded, but the edge body-size and request-rate controls are absent. This primarily increases pre-auth/admin DoS surface and can bypass nginx's trusted-forwarded-header normalization.

Suggested fix:
Add a production startup assertion that requires `HOSTNAME=127.0.0.1` or an explicit `ALLOW_DIRECT_EXPOSURE=true`, and document/directly enforce equivalent body/rate limits when nginx is not in front.

## Security Posture Notes

- Auth/session handling is fail-closed for production secrets and uses HMAC/timing-safe session verification.
- Admin API routes are wrapper-gated; token-scoped Lightroom upload is explicit and source-scanned.
- Mutating server actions are origin-gated by policy lint.
- SQL restore now scans both comment-stripped and comment-as-spaces forms (`apps/web/src/lib/sql-restore-scan.ts:135-155`) and regression-tests comment-split dangerous statements (`apps/web/src/__tests__/sql-restore-scan.test.ts:53-69`).
- Privacy field separation is protected by symmetric tests for public/timeline selectors (`apps/web/src/__tests__/privacy-fields.test.ts:6-42`, `apps/web/src/__tests__/privacy-fields.test.ts:83-114`).
