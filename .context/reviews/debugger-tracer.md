# Debugger + Tracer Review

Scope: `/Users/hletrd/flash-shared/gallery`
Mode: read-only review only; no code changes made.

## Method / inventory
I built the review inventory from the tracked repository files and then walked the code by subsystem, excluding `node_modules`, `.git`, and generated artifacts.

Reviewed areas:
- Root docs and scripts: `README.md`, `AGENTS.md`, `package.json`, deploy helpers under `scripts/`
- Web app build/runtime config: `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/tsconfig.typecheck.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/scripts/*`
- Auth / origin / rate limit flow: `apps/web/src/lib/{request-origin,action-guards,api-auth,session,rate-limit,auth-rate-limit}.ts`, `apps/web/src/app/actions/auth.ts`
- Public data / queue / storage flow: `apps/web/src/lib/{data,serve-upload,upload-paths,validation,gallery-config,content-security-policy,seo-og-url,image-url,photo-title,tag-slugs,tag-records,base56,csv-escape,safe-json-ld,sanitize,revalidation,restore-maintenance,upload-limits,process-image,process-topic-image,image-queue,upload-tracker,upload-tracker-state,upload-processing-contract-lock,queue-shutdown}.ts`, `apps/web/src/db/{index,schema}.ts`
- Routes / actions / UI: `apps/web/src/app/**`, `apps/web/src/components/**`
- Tests: `apps/web/src/__tests__/**`

I checked the request/origin/auth/data/UI/test chain end-to-end and used the tests as supporting evidence where they existed.

## Findings

### 1) Image processing claim retries can get permanently stuck behind the queue’s own dedupe gate
- **Severity:** High
- **Confidence:** Confirmed
- **Category:** confirmed
- **Files / lines:**
  - `apps/web/src/lib/image-queue.ts:193-206` — jobs are deduped by `state.enqueued.has(job.id)` before any enqueue attempt
  - `apps/web/src/lib/image-queue.ts:217-237` — claim acquisition failure schedules `setTimeout(() => enqueueImageProcessing(job), delay)` and marks `claimRetryScheduled = true`
  - `apps/web/src/lib/image-queue.ts:336-341` — `state.enqueued.delete(job.id)` is skipped whenever `claimRetryScheduled` is true
- **Problem:**
  - On a claim-lock miss, the code schedules a retry but leaves the job in `state.enqueued`. When the timer fires, `enqueueImageProcessing(job)` returns immediately at line 203, so the retry never actually re-enters the queue.
- **Concrete failure scenario / reproduction:**
  1. Two workers or processes compete for the same image-processing claim lock.
  2. One instance schedules a claim retry after `acquireImageProcessingClaim(job.id)` returns null.
  3. Because the job remains marked as enqueued, the scheduled retry is discarded by the early return.
  4. The image remains unprocessed until something else restarts the queue path.
- **Minimal fix:**
  - Clear `state.enqueued` before scheduling the claim retry, or route the scheduled retry through a path that bypasses the dedupe guard for already-scheduled claim retries. Keep `claimRetryCounts` cleanup aligned with that change.
- **Why this is root-cause, not symptom:**
  - The queue is attempting to recover from lock contention, but the recovery path is blocked by its own idempotency guard. The retry timer is not the problem; the stale `enqueued` state is.

### 2) Rate limiting collapses to a shared `unknown` bucket when proxy trust is not configured
- **Severity:** Medium
- **Confidence:** Likely
- **Category:** likely / manual-validation recommended
- **Files / lines:**
  - `apps/web/src/lib/rate-limit.ts:82-112` — `getClientIp()` returns `'unknown'` unless `TRUST_PROXY === 'true'` and a trusted forwarded address is available
  - Call sites that feed the shared helper:
    - `apps/web/src/app/actions/auth.ts:91-104` and `apps/web/src/app/actions/auth.ts:318`
    - `apps/web/src/app/actions/public.ts:78-120`
    - `apps/web/src/app/actions/sharing.ts:101-130` and `apps/web/src/app/actions/sharing.ts:199-201`
    - `apps/web/src/app/api/og/route.tsx:39-47`
- **Problem:**
  - If the app is deployed without `TRUST_PROXY=true` or without forwarded headers, all rate-limited paths share the same `'unknown'` key. That means one noisy client can consume the same budget for every user.
  - The warning only fires when proxy headers are present, so a direct-exposure or misconfigured deployment can fail silently.
- **Concrete failure scenario / reproduction:**
  1. Run the app in production with `TRUST_PROXY` unset, or behind a proxy that does not supply the expected headers.
  2. Hit login/search/share/OG endpoints from any client.
  3. Every request is bucketed as `'unknown'`, so throttling becomes effectively global across unrelated users.
- **Minimal fix:**
  - Fail closed or emit a loud startup/runtime warning when production is using the `'unknown'` fallback, and consider deriving a safer per-connection identifier when proxy trust is absent.
- **Why this matters across the request flow:**
  - Auth, search, sharing, and OG all depend on the same helper, so a single proxy misconfiguration affects both mutating and read-only public paths.

### 3) Build safety now depends on the wrapper script; direct `next build` bypasses type validation
- **Severity:** Medium
- **Confidence:** Likely
- **Category:** manual-validation
- **Files / lines:**
  - `apps/web/next.config.ts:36-44` — `typescript.ignoreBuildErrors: true`
  - `apps/web/package.json:8-15` — `build` runs `npm run typecheck && next build`, but `typecheck` is now external to Next’s build-time TS pass
- **Problem:**
  - Next’s own type-check gate is disabled. The repo is safe only when callers remember to invoke the package script. Any direct `next build` invocation, or any future CI/deploy path that skips the wrapper script, can ship code with type errors.
- **Concrete failure scenario / reproduction:**
  1. Introduce a TypeScript error in `apps/web/src/**`.
  2. Run `npx next build` (or any automation that shells `next build` directly instead of `npm run build`).
  3. The build proceeds because Next’s internal TS check is disabled.
- **Minimal fix:**
  - Keep a build-time type gate that cannot be bypassed by calling `next build` directly, or make the supported build entrypoint enforce the check in a way the deployment chain cannot skip.
- **Operational note:**
  - The current Docker build path does call `npm run build`, so this is primarily a guardrail regression for contributors and any alternate automation path, not the main container build.

## Final sweep / coverage confirmation
I reviewed the full tracked surface relevant to the app: root scripts/docs, web build/runtime configuration, auth/origin/rate-limit helpers, public-data/queue/storage helpers, routes/actions/components, database schema helpers, and the test suite under `apps/web/src/__tests__`.

No relevant tracked source/config/test file in those areas was skipped in the review pass. Generated/vendor directories were excluded by instruction.

## Notes
- This review is read-only. No implementation changes were made.
- The report intentionally separates confirmed issues from likely/manual-validation risks so the next pass can prioritize fixes in order of evidence strength.
