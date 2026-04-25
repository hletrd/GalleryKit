# Code Review Report — Cycle 5 Deep Repository Review

## Scope and method
- Reviewed the repository as a full-repo audit because `git diff` was empty.
- Built an inventory of runtime/config/test/script/docs files; skipped generated or non-reviewable artifacts (`node_modules`, `.git`, `.next`, build/dist/coverage outputs, test-results, `.omx` / `.omc` state files, screenshots, and historical review artifacts under `.context/reviews`).
- Deep-read the high-risk runtime paths (auth, rate limiting, uploads, queueing, restore, sharing, public routes, admin actions, DB/config helpers), spot-checked lower-risk UI/config files, and cross-checked relevant tests.
- Validation run results:
  - `npm run typecheck` ✅
  - `npm run lint` ✅
  - `npm test` ✅ (58 files / 341 tests)
- Note: the `omx_code_intel` MCP diagnostics/AST tools were unavailable (`Transport closed`), so I used repo-wide shell inventory/grep plus full typecheck/lint/test runs as the diagnostics fallback.

## Inventory of review-relevant files

### Root / docs / repo config
- `AGENTS.md`
- `README.md`
- `package.json`
- `package-lock.json`
- `scripts/deploy-remote.sh`
- `.github/workflows/quality.yml`
- `.github/dependabot.yml`
- `.vscode/*`
- `plan/*` and `plan/user-injected/*` (triaged for relevance; no active implementation logic)

### App config / deploy / scripts
- `apps/web/README.md`
- `apps/web/package.json`
- `apps/web/next.config.ts`
- `apps/web/playwright.config.ts`
- `apps/web/eslint.config.mjs`
- `apps/web/vitest.config.ts`
- `apps/web/tailwind.config.ts`
- `apps/web/drizzle.config.ts`
- `apps/web/Dockerfile`
- `apps/web/docker-compose.yml`
- `apps/web/deploy.sh`
- `apps/web/scripts/*`
- `apps/web/drizzle/*.sql`

### Runtime entry points / routes / pages
- `apps/web/src/instrumentation.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/app/**` public routes/pages, admin routes/pages, API routes, and server actions

### Core libraries / data / DB
- `apps/web/src/db/index.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/lib/*` (auth/session, rate limiting, request origin, uploads, image processing, queueing, restore, sharing helpers, config, validation, revalidation, CSP, JSON-LD, storage, etc.)

### Client components reviewed directly / spot-checked
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/admin-header.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
- lower-risk UI primitives under `apps/web/src/components/ui/*` were inventoried/spot-checked as wrapper components only

### Tests / e2e reviewed directly
- `apps/web/src/__tests__/rate-limit.test.ts`
- `apps/web/src/__tests__/admin-users.test.ts`
- `apps/web/src/__tests__/admin-user-create-ordering.test.ts`
- `apps/web/src/__tests__/image-queue-bootstrap.test.ts`
- `apps/web/src/__tests__/data-pagination.test.ts`
- Full suite executed: all 58 unit-test files
- E2E inventory scanned: `apps/web/e2e/*.spec.ts`, `apps/web/e2e/helpers.ts`

## Findings

### 1) [HIGH] `TRUST_PROXY=true` currently picks the wrong client IP behind chained proxies
- **Files:**
  - `apps/web/src/lib/rate-limit.ts:61-78`
  - `README.md:145-147`
- **Confidence:** High
- **Status:** Confirmed
- **Issue:** `getClientIp()` reverses `X-Forwarded-For` and returns the right-most valid hop. That only matches the real user for a single trusted edge proxy. In common chained deployments (for example Cloudflare -> nginx -> app, or load balancer -> nginx -> app), the right-most hop is the last proxy, not the visitor.
- **Concrete failure scenario:** With `X-Forwarded-For: 198.51.100.23, 172.68.12.34`, the code returns `172.68.12.34`. That collapses many real users onto a shared rate-limit bucket, so login/search/share throttles can trip for unrelated visitors behind the same upstream proxy. The README explicitly tells operators this path should work behind “Cloudflare, load balancers, etc.”, so the documented deployment contract and the implementation disagree.
- **Suggested fix:** Replace the boolean `TRUST_PROXY` heuristic with real trusted-proxy parsing (trusted proxy list / hop count). If the app wants the simple single-proxy contract only, the docs must say so explicitly; otherwise extract the original client from the left side after stripping trusted proxy hops.

### 2) [MEDIUM] Failed image-processing jobs are abandoned until a process restart
- **Files:**
  - `apps/web/src/lib/image-queue.ts:181-327`
  - `apps/web/src/lib/image-queue.ts:378-455`
  - `apps/web/src/app/actions/images.ts:217-232`
  - `apps/web/src/app/actions/images.ts:297-312`
  - `apps/web/src/lib/data.ts:295-303`
- **Confidence:** High
- **Status:** Confirmed
- **Issue:** Uploads are inserted with `processed: false`, then handed to the in-process queue. If processing fails three times, the queue logs “giving up” and drops the job from in-memory retry state. After bootstrap finishes, `state.bootstrapped` flips to `true`, and there is no later periodic rescan of `processed = false` rows.
- **Concrete failure scenario:** A transient disk-full / Sharp failure / missing-original-file incident hits during upload. The job exhausts its 3 retries, remains `processed = false`, and stops being retried. Public queries filter to `processed = true`, so the image never appears publicly again until the app process restarts (or restore flow resets bootstrap state).
- **Suggested fix:** Persist a recoverable failed state plus an admin/manual requeue action, or schedule a periodic background rescan of pending `processed = false` rows after backoff instead of treating bootstrap as one-and-done.

### 3) [MEDIUM] `createAdminUser()` can bypass its own hourly rate limit by resetting the whole bucket
- **File:** `apps/web/src/app/actions/admin-users.ts:106-189`
- **Confidence:** High
- **Status:** Confirmed
- **Issue:** The function pre-increments the `user_create` bucket, but on success, duplicate-username, and generic error paths it calls `resetRateLimit(...)` and clears the in-memory map entirely. That wipes the entire hour window instead of rolling back only the current attempt.
- **Concrete failure scenario:** An attacker (or buggy admin automation) can stay below the 10/hour threshold by alternating a few expensive Argon2-backed create attempts with one successful creation or one duplicate-username submission. Each reset clears prior pressure, so the supposed CPU/abuse limiter no longer bounds total work per hour.
- **Suggested fix:** Decrement only the current attempt on success / duplicate-user validation failures, or explicitly redefine the limiter as failure-only and move the increment after the expensive path. Do not clear the entire hourly bucket unless that behavior is intentionally desired and documented.

## Cross-file interaction notes
- The queue failure issue is a true cross-file correctness problem: `uploadImages()` inserts pending rows, `image-queue.ts` can permanently stop retrying them, and `data.ts` excludes them from public queries.
- The proxy issue is also cross-file: implementation in `rate-limit.ts` conflicts with the deployment guidance in `README.md`.
- The user-create limiter is internally inconsistent: its comments describe a CPU/abuse guard, but the success/duplicate reset semantics effectively turn it into a mostly non-binding limiter.

## Missed-issues sweep
- Searched repo-wide for review red flags (`TODO|FIXME|XXX|HACK|BUG`, control-flow catches, logging/error-handling hotspots, secret-ish patterns, dangerous HTML/eval patterns).
- Rechecked tests around the flagged areas (`rate-limit`, `admin-users`, `image-queue`, `data-pagination`).
- No additional high-confidence logic/security issues stood out beyond the three findings above.

## Files reviewed (grouped)
- Root/docs/config: `README.md`, `package.json`, `scripts/deploy-remote.sh`, `.github/workflows/quality.yml`, repo-level config files.
- App config/deploy: `apps/web/{README.md,package.json,next.config.ts,playwright.config.ts,eslint.config.mjs,vitest.config.ts,tailwind.config.ts,drizzle.config.ts,Dockerfile,docker-compose.yml,deploy.sh}`.
- Runtime/server: `apps/web/src/instrumentation.ts`, `apps/web/src/proxy.ts`, `apps/web/src/db/{index.ts,schema.ts}`.
- Server actions: `apps/web/src/app/actions/{auth.ts,admin-users.ts,images.ts,public.ts,seo.ts,settings.ts,sharing.ts,tags.ts,topics.ts}`.
- API/admin routes: `apps/web/src/app/api/{health/route.ts,live/route.ts,og/route.tsx,admin/db/download/route.ts}`, `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Public pages/routes: `apps/web/src/app/[locale]/(public)/**`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`, `apps/web/src/app/{sitemap.ts,robots.ts}`.
- Core libs: `apps/web/src/lib/{action-guards.ts,api-auth.ts,audit.ts,auth-rate-limit.ts,backup-filename.ts,base56.ts,content-security-policy.ts,csp-nonce.ts,csv-escape.ts,data.ts,db-restore.ts,error-shell.ts,exif-datetime.ts,gallery-config.ts,gallery-config-shared.ts,image-queue.ts,image-types.ts,image-url.ts,locale-path.ts,mysql-cli-ssl.ts,photo-title.ts,process-image.ts,process-topic-image.ts,queue-shutdown.ts,rate-limit.ts,request-origin.ts,restore-maintenance.ts,revalidation.ts,safe-json-ld.ts,sanitize.ts,seo-og-url.ts,serve-upload.ts,session.ts,sql-restore-scan.ts,storage/*,tag-records.ts,tag-slugs.ts,upload-limits.ts,upload-paths.ts,upload-tracker.ts,upload-tracker-state.ts,utils.ts,validation.ts}`.
- Client components directly reviewed / spot-checked: `apps/web/src/components/{admin-header.tsx,home-client.tsx,load-more.tsx,photo-viewer.tsx,lightbox.tsx,upload-dropzone.tsx,...}` plus lower-risk UI wrappers under `components/ui/*`.
- Scripts scanned: `apps/web/scripts/{check-action-origin.ts,check-api-auth.ts,ensure-site-config.mjs,entrypoint.sh,init-db.ts,migrate*.{ts,js},mysql-connection-options.js,seed-admin.ts,seed-e2e.ts}`.
- Tests read directly: `apps/web/src/__tests__/{rate-limit.test.ts,admin-users.test.ts,admin-user-create-ordering.test.ts,image-queue-bootstrap.test.ts,data-pagination.test.ts}`; full test suite executed across all 58 unit-test files.
