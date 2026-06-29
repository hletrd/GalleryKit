# Critic Review — review-plan-fix cycle 2

Role: `critic`
HEAD reviewed: `3d138704` (`build(sw): 🔨 update post-build service worker stamp`)
Date: 2026-06-29

## Inventory Coverage

- Read `AGENTS.md` and `CLAUDE.md`.
- Inspected current HEAD/history, package metadata, lockfile, source tree, tests, scripts, migrations, nginx/Docker/deploy config, and relevant `.context` review/plan material.
- Coverage snapshot: 2,489 tracked files; 480 source files; 258 tests/e2e files; 28 scripts; 28 migration/meta files; 1,663 tracked review docs; 59 tracked plan docs.
- Live ignored env files were detected but not opened: `.env.deploy`, `apps/web/.env.local`.
- Working tree already contained unrelated review-lane edits in `.context/reviews/*`; this lane left those untouched and only wrote this file plus `security-reviewer.md`.

## Validation Evidence

- `npm audit --workspace=apps/web --audit-level=low --json`: 0 vulnerabilities.
- `npm run lint:api-auth --workspace=apps/web`: pass.
- `npm run lint:action-origin --workspace=apps/web`: pass.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: pass.
- `npm test --workspace=apps/web -- privacy-fields check-api-auth check-action-origin check-public-route-rate-limit sql-restore-scan semantic-route-production og-photo-fallback backup-download-route request-origin`: 9 files / 120 tests passed.

## Confirmed Findings

No confirmed current critic defects found in this pass.

## Cycle-2 Adjudication Of Relevant Change Surface

- SQL restore comment-split bypass: fixed. The scanner now evaluates both comment-removed and comment-spaced sanitized forms (`apps/web/src/lib/sql-restore-scan.ts:135-155`), with malicious comment-split regression cases pinned (`apps/web/src/__tests__/sql-restore-scan.test.ts:53-69`).
- Semantic route abuse budget/body materialization: fixed. The route rejects unsupported/chunked/oversize bodies before parsing and charges the semantic limiter before `request.text()` (`apps/web/src/app/api/search/semantic/route.ts:129-164`), then applies a post-read byte cap (`apps/web/src/app/api/search/semantic/route.ts:171-182`).
- Production semantic empty-index behavior: fixed. Production mode now returns 503 when no production embeddings exist (`apps/web/src/app/api/search/semantic/route.ts:255-260`), covered by `apps/web/src/__tests__/semantic-route-production.test.ts:25-30`.
- Lightroom semantic enqueue parity: fixed. LR upload forwards `semanticSearchMode` with the rest of the processing snapshot (`apps/web/src/app/api/admin/lr/upload/route.ts:449-455`).
- Per-photo OG fallback host trust: fixed. Fetch origin is canonical-site-pinned and invalid config fails closed (`apps/web/src/app/api/og/photo/[id]/route.tsx:101-119`); fallback redirects use canonical origin and validate configured OG URL origin (`apps/web/src/app/api/og/photo/[id]/route.tsx:252-298`), covered by `apps/web/src/__tests__/og-photo-fallback.test.ts:77-86`.
- Nginx upload derivative host-path conflict: fixed. The upload derivative location proxies to Next instead of rooting at the container path (`apps/web/nginx/default.conf:167-183`), covered by `apps/web/src/__tests__/nginx-config.test.ts:32-36`.
- Prior focus-visible scanner blind spot: fixed. The scanner covers the whole `app/` tree (`apps/web/src/__tests__/focus-visible-links-scan.test.ts:45-56`, `apps/web/src/__tests__/focus-visible-links-scan.test.ts:214-240`), and `global-error.tsx` has a focus-visible ring on the retry button (`apps/web/src/app/global-error.tsx:78-82`).
- Prior semantic env fractional-floor edge: fixed. The floored value is guarded and upper-clamped (`apps/web/src/lib/clip-embeddings.ts:27-38`), with regression coverage (`apps/web/src/__tests__/clip-semantic-limits-env.test.ts:64-80`).

## Residual Critique / Risks

### CRIT-RISK-01 — Operational correctness depends on the documented single-instance envelope

Status: Risk, not a confirmed implementation defect.
Severity: Medium
Confidence: High

Evidence:
- The runtime topology warning is explicit (`CLAUDE.md:224-227`).
- Restore maintenance, upload tracking, and several public rate-limit fast paths are process-local (`apps/web/src/lib/restore-maintenance.ts:1-55`, `apps/web/src/lib/upload-tracker-state.ts:7-20`, `apps/web/src/lib/rate-limit.ts:68-89`, `apps/web/src/lib/rate-limit.ts:314-318`).

Failure scenario:
A future deployer treats the app as horizontally scalable because Docker/Next normally allow it. Reviewers then get green tests but production behavior diverges: restore fencing, upload quota, and public abuse throttling are split by process.

Suggested fix:
Either keep single-instance deployment as a hard runtime invariant or introduce shared coordination before advertising scale-out. A startup/deploy check would make this less dependent on humans reading CLAUDE.md.

### CRIT-RISK-02 — Edge/security envelope is split between app and nginx

Status: Risk, not a confirmed implementation defect.
Severity: Medium
Confidence: Medium

Evidence:
- Compose states nginx handles rate limiting and security headers while binding the app to localhost (`apps/web/docker-compose.yml:14-21`).
- The Dockerfile's image default is broadly bound (`apps/web/Dockerfile:83-85`).
- Nginx supplies the narrow body limits and route-specific throttles (`apps/web/nginx/default.conf:25-31`, `apps/web/nginx/default.conf:56-60`, `apps/web/nginx/default.conf:72-76`, `apps/web/nginx/default.conf:131-150`).

Failure scenario:
A future operator or CI preview runs the production image directly. Core auth still works, but the expected edge body caps, throttles, and proxy-header normalization disappear. That is an operations/documentation boundary rather than an app-code bug.

Suggested fix:
Add a production startup guard or deploy-time smoke check that fails when the app is not localhost-bound behind the expected proxy unless an explicit direct-exposure mode is configured.

## Missed-Issues Sweep

I rechecked for stale carryforward findings from the active review docs and recent commits. The current HEAD contains targeted fixes and tests for the prior SQL scanner, semantic search, LR enqueue, OG fallback, nginx upload proxy, focus-visible scanner, and semantic env parsing issues. I did not find a fresh confirmed defect to escalate from the critic lane.
