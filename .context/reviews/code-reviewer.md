# Cycle 14 Code-Reviewer + Debugger Review

Date: 2026-07-07

Mode: read-only repository review. The only file written by this prompt is this report.

## Scope And Inventory

Inventory basis:

- `git ls-files` returned 3,443 tracked paths.
- The live review-relevant set was 703 tracked paths: app code, server actions, route handlers, components, data/db modules, scripts, migrations, tests, e2e tests, nginx config, GitHub workflows, package files, and TypeScript/Next/Vitest/Playwright config.
- Category counts reviewed:
  - `apps/web/src/app`: 81 route/action/layout/page files
  - `apps/web/src/components`: 61 component files
  - `apps/web/src/lib`: 111 library/runtime files
  - `apps/web/src/db`: 3 DB entry/schema files
  - `apps/web/src/__tests__`: 353 unit/source-contract tests
  - `apps/web/scripts`: 29 operational/check/build scripts
  - `apps/web/e2e`: 12 Playwright files
  - `apps/web/drizzle`: 33 migrations/meta files
  - `apps/web/messages`: 2 locale message files
  - `apps/web/nginx`: 1 nginx template
  - `scripts`: 2 root scripts
  - `.github`: 4 workflow/dependabot files
- Historical `.context/reviews` and `.context/plans` material was treated as context/history rather than live runtime behavior. Binary/static assets and generated artifacts were not treated as code behavior.

Review focus:

- Admin auth, token auth, same-origin guards, public-route rate limits, upload/delete/bulk-edit paths, Lightroom upload API, public analytics actions, semantic/similar search, OG routes, image processing queue, DB backup/restore, migrations and reconcile baselining, schema privacy guards, nginx/deploy topology, CI quality gates, and the test/source-contract suite.

## Validation Evidence

Executed read-only/security-lint validation:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.

Not run in this prompt:

- Full `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, and Playwright e2e. Those commands can create/update `.next`, typegen, coverage/cache, browser artifacts, or DB state, and the prompt constrained this pass to read-only except this report.

Note:

- A direct raw `node apps/web/scripts/check-*.ts` experiment is not a finding. The package scripts intentionally run those TypeScript checkers through `tsx` (`apps/web/package.json:25-27`), and the npm lint-gate executions above passed.

## Findings Summary

- Confirmed issues: 0
- Likely issues: 0
- Risks needing manual validation: 2

## Confirmed Issues

None found in this pass.

## Likely Issues

None found in this pass.

## Risks Needing Manual Validation

### C14-CR-RISK-01: Reverse-proxy topology can collapse all app and nginx per-IP limits into one shared bucket

- Severity: High
- Confidence: Medium
- Location: `apps/web/nginx/default.conf:20-29`, `apps/web/nginx/default.conf:59-71`, `apps/web/src/lib/rate-limit.ts:175-205`, `CLAUDE.md:97-98`
- Problem: The app only trusts forwarded client IP headers when `TRUST_PROXY=true`; otherwise `getClientIp()` returns `unknown` and all users share one bucket. The nginx template also overwrites `X-Forwarded-For` with `$remote_addr` and warns this is correct only when nginx's TCP peer is the real client. If an upstream load balancer or TLS terminator connects from its own IP and the host topology has not been adjusted, every client is treated as the LB or as `unknown`.
- Concrete failure scenario: Production sits behind a TLS-terminating LB. Nginx receives every request from the LB IP, writes that IP into `X-Forwarded-For`, and the app either does not trust headers or trusts the wrong hop count. Five failed logins from one visitor can lock out all visitors for the login window; public page/image/search/share limits can false-positive under normal aggregate traffic; audit/rate-limit attribution becomes unreliable.
- Suggested fix: Validate the live host topology before relying on per-IP controls: `TRUST_PROXY=true`, `TRUSTED_PROXY_HOPS` matches the actual proxy chain, nginx either receives the real client IP or appends/preserves the true `X-Forwarded-For`, and nginx `real_ip`/PROXY protocol is configured when `$binary_remote_addr` would otherwise be the LB. Use the existing `scripts/check-proxy-topology.mjs` as an operational check and keep the host nginx config aligned with the template.

### C14-CR-RISK-02: CLIP production search availability depends on live host state outside the normal quality gate

- Severity: Medium
- Confidence: Medium
- Location: `CLAUDE.md:168-169`, `.github/workflows/clip-preflight.yml:1-46`, `apps/web/src/lib/clip-model.ts:200-229`, `apps/web/src/app/api/search/semantic/route.ts:173-190`
- Problem: Production semantic search requires the DB setting, `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, seeded offline model weights under `CLIP_MODELS_ROOT`, and production embeddings. The code correctly fails closed/offline-loads (`env.allowRemoteModels=false`), and the repository has a scheduled/manual CLIP preflight workflow, but this is not part of the normal `quality.yml` gate.
- Concrete failure scenario: An operator enables `semantic_search_mode=production` in the DB but the deployed host lacks the seeded `jina-clip-v2-d512-q8` weights or has stale/missing embeddings. Public semantic/similar search requests are admitted to the route and then return degraded/503-style failures instead of working search, even though regular CI passed.
- Suggested fix: Treat production semantic search activation as an operational runbook step: run the CLIP preflight against the same model root used by the host, verify the DB mode/env pair, and confirm production `image_embeddings` row coverage before advertising or relying on the feature. Consider adding a non-mutating deploy preflight/status check if this feature becomes always-on.

## Cross-File Review Notes

- Admin API exports are wrapped by `withAdminAuth(...)`; the lint gate passed and the manually inspected token/session paths fail closed.
- Mutating non-auth server actions consistently run same-origin checks and restore-maintenance fencing where relevant; the action-origin lint gate passed.
- Public mutating/expensive route rate limits are present per the repo lint gate; route-level rate-limit rollback policies are documented in `apps/web/src/lib/rate-limit.ts` and match inspected OG/search/share/load-more behavior.
- Public data selectors omit admin-only fields, and the compile-time privacy guards in `apps/web/src/lib/data.ts` cover the public select surfaces.
- Drizzle migrations, journal metadata, and `apps/web/scripts/migrate.js` reconcile/post-condition logic were checked together; no journal ordering, baseline hash, or reconcile drift issue was found.
- Upload, delete, batch delete, retry, Lightroom upload, and background queue paths were checked for race handling, filename validation, cleanup, restore fencing, and failure-state visibility. No confirmed defect found.
- JSON-LD `dangerouslySetInnerHTML` call sites route through `safeJsonLd`; static grep did not reveal a raw unsafe JSON-LD injection path.
- Static sweeps for `TODO/FIXME/HACK/BUG`, TypeScript suppressions, unsafe DOM sinks, storage/cookie usage, child-process use, filesystem writes/deletes, and external fetches did not reveal a confirmed live defect beyond the manual-validation risks above.

## Final Sweep

Commonly missed areas checked:

- Auth/session/PAT token verification and rate limits.
- Proxy/IP trust behavior.
- Public route body-size/rate-limit admission.
- DB restore, backup, migration journal, and legacy schema reconciliation.
- Upload processing queue, retry maps, advisory locks, failed-image retry, and delete-during-processing cleanup.
- Semantic search mode gates and CLIP offline model loading.
- OG image generation and bounded photo fetch fallback.
- Admin-only metadata privacy and public selector boundaries.
- Nginx body caps, public/image/admin limit zones, and host-application caveats.
- CI quality workflow and package script wiring.

Skipped as live-code findings:

- Prior `.context` review/plan artifacts.
- Static/binary assets and generated build output.
- The direct raw-Node invocation of TypeScript checker scripts, because the supported package scripts use `tsx` and passed.
