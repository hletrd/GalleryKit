# Cycle 25 Critic Review

Reviewer: cycle-25 critic
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `4cb1258ba0b2cca689846a85423264edc2d96b90` on `master`
Source edits: none. This review artifact is the only file intentionally written by this critic pass.
Commit/push: not performed, per user instruction.

## Inventory First

I read `AGENTS.md` and `CLAUDE.md` first, then built a fresh inventory before inspecting source. The raw workspace contains 45,379 files, dominated by generated/vendor/history surfaces: `node_modules` 34,134 files, `apps/web` 5,410 files, `.context` 2,343 files, `.claude` 2,291 files, `.omc` 609 files, `.omx` 392 files, and `plan` 180 files.

Review-relevant live surfaces inspected:

- Manifests and runtime config: root `package.json`, `apps/web/package.json`, `.nvmrc`, `next.config.ts`, Dockerfile, compose, nginx, entrypoint, deploy helpers.
- App code: public/admin routes, API routes, server actions, auth/session/origin gates, rate limits, analytics, search/semantic search, sharing, data selectors, SEO/settings, migrations, image processing/queue, CLIP inference/model loading.
- UI/product surfaces: public layouts/pages, search UI, similar photos, photo viewer, topic/share pages, metadata/OG routes.
- Tests/scripts: auth/action-origin/API-auth/public-route-rate-limit guardrails, public actions, semantic/similar routes, rate-limit DB tests, migration reconcile tests, deploy contracts, touch/nav-related source-contract tests.
- Docs/current assumptions: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `AGENTS.md`, and current `.context` review/plan inventory only as history, not as source-of-truth.

Worktree note: `git status --short --branch` showed an unrelated modified `.context/reviews/verifier.md` before this report write. I did not modify it.

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Full lint/typecheck/build/Vitest/Playwright were not rerun because this was a critique pass with no product-code edits.

## Confirmed Findings

### C25-01 - Public analytics writes have only a per-process limiter and no global write ceiling

Severity: Medium
Confidence: High
Perspectives: product correctness, operational risk, hidden assumptions, testing adequacy

Evidence:

- `apps/web/src/app/actions/public.ts:329-348` implements `VIEW_RECORD_MAX_REQUESTS = 120` with a `createResetAtBoundedMap` in memory only.
- The public recorders then do durable DB work: `recordPhotoView` validates and inserts at `apps/web/src/app/actions/public.ts:370-389`, `recordTopicView` at `apps/web/src/app/actions/public.ts:397-420`, and `recordSharedGroupView` at `apps/web/src/app/actions/public.ts:428-455`.
- The repo already has a durable shared rate-limit bucket table in `apps/web/src/db/schema.ts:212-219`.
- Comparable public search/load-more paths use DB-backed rate-limit checks: `apps/web/src/app/actions/public.ts:83-118` and `apps/web/src/app/actions/public.ts:276-295`.
- `apps/web/src/lib/view-retention.ts:5-14` explicitly documents that these anonymous public endpoints have no global write ceiling and can grow analytics tables until the retention sweep catches up.
- Existing analytics tests only prove the in-memory 120-request budget (`apps/web/src/__tests__/public-actions.test.ts:307-317`); DB-backed rollback coverage exists for search instead (`apps/web/src/__tests__/public-actions.test.ts:345-354`).

Failure scenario:

A scripted client or rotating-IP scraper repeatedly calls pages that trigger the server actions. Each accepted view performs a target lookup and then appends to `image_views`, `topic_views`, or `shared_group_views`. The limiter resets on process restart and multiplies if a second web process is ever started. Even on the documented single-writer deployment, a botnet can create sustained MySQL write/index pressure and pollute photographer-facing analytics for up to the 395-day default retention window.

Suggested fix:

Move view-recording to the shared `rate_limit_buckets` path with a dedicated bucket type such as `view_record`, using the same pre-increment/check/rollback pattern as search and load-more. Consider adding a coarser global bucket and/or per-target/IP/day dedupe so one client cannot inflate a single photo/topic/share indefinitely. Add tests proving the analytics recorders consult the DB bucket before any SELECT/INSERT and fall back deliberately if the DB limiter is unavailable.

### C25-02 - Semantic search docs imply parity while the expensive CLIP endpoints remain process-local

Severity: Low-Medium
Confidence: High
Perspectives: docs, operational risk, maintainability

Evidence:

- `apps/web/README.md:61-69` describes semantic search as CPU-backed and says it has the "same posture as other public routes" with same-origin plus bounded per-IP rate limiting.
- The route-level comment is more precise: `apps/web/src/app/api/search/semantic/route.ts:6-8` says the limiter is in-memory.
- The implementation charges `preIncrementSemanticAttempt` at `apps/web/src/app/api/search/semantic/route.ts:173-184`.
- `preIncrementSemanticAttempt` is backed only by a module-local bounded map in `apps/web/src/lib/rate-limit.ts:350-372`; it does not use `rateLimitBuckets`.
- `CLAUDE.md:234-235` documents the single-web-instance assumption and says OG/share/search/semantic fast-path buckets weaken under scale-out, but that sentence is now too coarse because regular keyword search has a DB-backed bucket while semantic still does not.

Failure scenario:

An operator reads the app README and assumes semantic search has the same durable protection as the DB-backed public search action. In production mode, a scripted same-origin-looking client can repeatedly hit the CLIP text encoder and bounded embedding scan until the per-process bucket fills; a restart clears the budget, and any accidental scale-out multiplies it. The product keeps serving correctly, but CPU/RSS protection and operator expectations diverge.

Suggested fix:

Either make semantic/similar search use a DB-backed `semantic` bucket before model lookup/embedding work, or update the docs to explicitly say semantic and similar search are process-local protections that require edge/container-level rate limiting for stronger abuse resistance. Split the `CLAUDE.md` topology note by bucket type so DB-backed `search` is not grouped with process-only `semantic`.

### C25-03 - Container startup recursively chowns large bind mounts on owner mismatch

Severity: Low-Medium
Confidence: Medium
Perspectives: operational risk, maintainability

Evidence:

- `apps/web/docker-compose.yml:24-28` bind-mounts persistent mutable stores: `./data`, `./public/uploads`, and `./public/resources`.
- `apps/web/scripts/entrypoint.sh:4-13` runs `chown -R node:node` over each of those mounts when the top-level directory owner is not `node`.
- The same entrypoint recursively chowns `.next` on every startup in `apps/web/scripts/entrypoint.sh:15-25`.
- `CLAUDE.md:234-237` frames the shipped deployment as a single web-instance/single-writer production topology where availability depends on one container coming up cleanly.

Failure scenario:

After a host restore, rsync, root-run sidecar, or manual maintenance, the top-level `data` or uploads directory can become root-owned even if it contains a large gallery, CLIP model tree, or many generated derivatives. The next deploy/startup walks the entire bind mount before dropping privileges. On a disk-constrained host, this can extend downtime or make the container appear wedged even though the application code is healthy.

Suggested fix:

Avoid recursive ownership repair on large persistent stores during normal startup. Prefer a deploy/preflight check that verifies writability of the specific mutable subdirectories and fails with a clear remediation command, or chown only known small directories that the container creates. For `.next`, copy/build artifacts with the intended owner and limit startup repair to `.next/cache`. Add a source-contract test so future entrypoint changes do not reintroduce broad recursive chown over bind-mounted photo/model data.

## Cleared Checks And Non-Findings

- Product correctness: public share pages avoid metadata lookup enumeration and rate-limit body lookups before DB access; current source did not show a new share-key leak.
- Auth/security: the project guardrails passed for admin API wrappers, mutating server-action origin checks, and public mutating API route rate-limit checks.
- Privacy: `publicSelectFields`/search enrichment and analytics schemas were inspected; no new full-IP storage or admin-only field exposure was found in current code.
- Migrations: Drizzle journal/schema/reconcile patterns were inspected; no current migration drift was found.
- UX: public layout, search, similar-photos, photo viewer, topic/share pages, and nav-related tests were inspected. I did not find an actionable current UX defect with source evidence in this pass.
- Docs: stack-version claims are aligned across manifests and docs for Node 24, Next 16, React 19, and TypeScript 6. The actionable docs issue found is the semantic rate-limit wording above.
- Deployment: deploy helpers, Docker pruning order, nginx body-size alignment, and host-network assumptions were inspected. I did not run deployment or modify production state.

## Final Missed-Issue Sweep

I re-swept for common missed categories before writing:

- Secrets and destructive ops: no secrets were printed; no destructive commands, commits, pushes, deploys, or container actions were run.
- Rate-limit/origin blind spots: guardrail scripts passed, but they check presence/order of limiters, not durability or global ceilings; C25-01 and C25-02 are therefore still valid.
- Scale assumptions: the single-instance topology is documented, but public analytics and semantic search still have failure modes if restarted, abused from many IPs, or accidentally scaled.
- Data retention: analytics retention exists and is chunked, but it mitigates long-term growth after writes land; it does not cap accepted public writes.
- Generated/vendor/history surfaces: `.next`, `node_modules`, runtime outputs, and historical `.context`/`plan` archives were inventoried but not treated as live product source.
