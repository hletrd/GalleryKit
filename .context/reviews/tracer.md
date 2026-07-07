# Cycle 13 Tracer Review

Role: `tracer`
Scope: read-only causal tracing of suspicious flows and competing hypotheses: request auth/origin, upload processing, sharing/public routes, DB migration, deploy/build env, and client UI data flow.
Allowed write: this report file only.
Source edits, plan edits, commits, pushes: none.
Validation evidence: static causal tracing plus these gates passed:
- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`

## Inventory

Trace-relevant files examined:
- Instructions/context: `AGENTS.md` from the prompt, `CLAUDE.md`, and `code-review` skill instructions.
- Request auth/origin flow: `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/proxy.ts`, admin action/API lint scripts.
- Upload processing flow: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, upload tracker/contract-lock helpers, processing settings snapshot callers.
- Sharing/public route flow: `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/actions/public.ts`, `apps/web/src/lib/data.ts`, public search/OG routes, public route-rate-limit scanner.
- DB migration flow: `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, `apps/web/src/db/schema.ts`, migration startup path in the Docker image.
- Deploy/build env flow: root `package.json`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/scripts/entrypoint.sh`, `apps/web/next.config.ts`.
- Client UI data flow: `apps/web/src/components/load-more.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/similar-photos.tsx`.

Skipped as non-trace-relevant for this lane: style-only components, locale copy, unrelated tests/fixtures, generated artifacts, and unchanged planning documents. Existing dirty file `.context/reviews/critic.md` was left untouched.

## Findings

No confirmed causal/race/flow findings in the requested scope.

Severity: None
Confidence: High for the reviewed paths above
Concrete failure scenario: not applicable because no high-confidence defect was confirmed
Suggested fix: none

## Hypotheses Traced

### Request Auth/Origin Flow

Hypothesis: hostile origin or proxy header confusion can reach admin mutations or admin APIs before authentication.

Result: rejected.

Evidence:
- Origin calculation prefers configured `BASE_URL` before request-derived host/proto, then fails closed when no expected origin exists (`apps/web/src/lib/request-origin.ts:60-80`, `apps/web/src/lib/request-origin.ts:99-118`).
- Cookie-backed admin APIs run same-origin verification before `isAdmin()`, while PAT-backed API calls deliberately bypass same-origin only after token scope/rate-limit verification (`apps/web/src/lib/api-auth.ts:68-112`, `apps/web/src/lib/api-auth.ts:114-142`).
- `logout` now checks same-origin, skips DB mutation during restore maintenance, and acquires the admin mutation slot before session verification/deletion (`apps/web/src/app/actions/auth.ts:268-294`). This closes the prior tracer finding. `updatePassword` follows the same same-origin plus restore-fence pattern (`apps/web/src/app/actions/auth.ts:297-318`).
- Scanner evidence: `lint:api-auth` and `lint:action-origin` passed.

### Upload Processing Flow

Hypothesis: browser or Lightroom upload can preclaim quota, parse/save files, insert rows, or enqueue processing while restore/settings changes race the flow.

Result: rejected.

Evidence:
- Browser uploads check restore maintenance, same-origin, and the admin mutation slot before parsing upload payload data (`apps/web/src/app/actions/images.ts:129-147`).
- Browser upload quota claims are settled on early exits and per-file failures, and the upload-processing contract lock spans topic verification, original save, DB insert, and enqueue (`apps/web/src/app/actions/images.ts:212-292`, `apps/web/src/app/actions/images.ts:377-623`, `apps/web/src/app/actions/images.ts:650-652`).
- Lightroom upload rejects chunked/oversized bodies before parsing, preclaims quota before `formData()`, always releases the multipart parse slot, re-checks restore maintenance after parsing, and acquires the upload-processing contract lock before topic DB work (`apps/web/src/app/api/admin/lr/upload/route.ts:94-186`, `apps/web/src/app/api/admin/lr/upload/route.ts:252-306`).
- Lightroom post-commit bookkeeping is isolated so a committed insert still returns success if enqueue/audit/revalidation later fail; bootstrap queue recovery covers missed enqueue (`apps/web/src/app/api/admin/lr/upload/route.ts:500-610`).
- Queue workers claim rows conditionally, process from the original file, update only matching pending rows, and clean variants on delete races (`apps/web/src/lib/image-queue.ts:720-889`).

### Sharing/Public Route Flow

Hypothesis: metadata generation, shared-grid prefetch, or selected-photo navigation can bypass share lookup rate limits or double-count view metrics.

Result: rejected.

Evidence:
- Shared-photo metadata intentionally avoids rate-limit increments and DB lookups; the page validates the key, checks restore maintenance, rate-limits the lookup, then fetches the shared image (`apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:44-52`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:87-117`).
- Shared-group metadata follows the same no-lookup rule; the page rate-limits once before `getSharedGroupCached()` (`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:49-56`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:92-117`).
- Shared group denormalized view increments and durable view recording use the same selected-photo decision: valid selected photos do not count as new group views, invalid/missing `photoId` does (`apps/web/src/lib/data.ts:1392-1407`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:137-142`).
- Shared-grid links disable RSC prefetch so viewport entry cannot burn the per-IP share lookup budget (`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:198-209`).
- Public shared selects use public field sets and compile/test privacy guards rather than admin image fields (`apps/web/src/lib/data.ts:1240-1315`, `apps/web/src/lib/data.ts:1318-1362`).

### DB Migration Flow

Hypothesis: non-monotonic Drizzle journal timestamps can silently skip migrations, or fresh baselining can swallow DML.

Result: rejected.

Evidence:
- Journal entries are read with their SQL hash and DML classification (`apps/web/scripts/migrate.js:198-227`).
- Per-entry baselining refuses rows above the cursor and refuses unmirrored DML-bearing migrations (`apps/web/scripts/migrate.js:758-840`).
- Historical pending migration prerequisites are created idempotently without baselining the pending migration (`apps/web/scripts/migrate.js:843-856`).
- After Drizzle migrates, every committed journal hash must be present or startup fails loudly (`apps/web/scripts/migrate.js:949-974`).

### Deploy/Build Env Flow

Hypothesis: deploy/build env can drift from local config, source secrets unsafely, or boot without migrations.

Result: rejected.

Evidence:
- Root deploy resolves `.env.deploy`, `$DEPLOY_ENV_FILE`, or the user secret path, refuses group/world-readable env files, and builds the SSH command from config rather than hardcoded host/key values (`scripts/deploy-remote.sh:22-92`).
- Docker build passes public build args into the builder before `npm run build` and runs `ensure-site-config.mjs` first (`apps/web/Dockerfile:91-120`).
- Runtime image includes migrations, migration helper scripts, runtime dependencies, persistence directories, liveness healthcheck, and starts with `node apps/web/scripts/migrate.js && exec node apps/web/server.js` (`apps/web/Dockerfile:150-198`).
- Compose supplies build args/env file and runtime `TRUST_PROXY=true` while keeping data/uploads/resources/site config bind-mounted (`apps/web/docker-compose.yml:7-32`).
- Remote deploy updates the repo, builds/starts via compose, waits for health, then prunes only after the new container is healthy (`apps/web/deploy.sh:10-104`).

### Client UI Data Flow

Hypothesis: slow client requests can clobber newer data, shared-photo query sync can trigger server rerenders/rate-limit burn, or similar-photo state can leak across image changes.

Result: rejected.

Evidence:
- Load-more uses a query version, mounted guard, loading ref, cursor reset, and observer cleanup to prevent stale pagination commits (`apps/web/src/components/load-more.tsx:43-129`, `apps/web/src/components/load-more.tsx:131-159`).
- Search increments request IDs, aborts semantic fetches, rechecks IDs after `fetch()` and `resp.json()`, and aborts on query changes/unmount (`apps/web/src/components/search.tsx:163-281`, `apps/web/src/components/search.tsx:283-315`).
- Shared group photo navigation uses shallow `window.history.replaceState()` instead of App Router navigation, avoiding repeat server renders and share limiter burn (`apps/web/src/components/photo-viewer.tsx:341-356`).
- Similar photos aborts close/unmount requests, uses request IDs/open guards before committing results, is hidden outside production semantic mode, and is keyed by image id in the viewer (`apps/web/src/components/similar-photos.tsx:63-141`, `apps/web/src/components/photo-viewer.tsx:795-800`).

## Final Sweep

Final sweep checked auth/API/action scanners, public-route rate-limit scanner, route lookup ordering, upload quota settlement, post-commit upload behavior, migration hash/cursor guards, deploy env sourcing, and stale client state guards.

No missed high-confidence causal, race, or flow issue was found. No trace-relevant file from the inventory was intentionally skipped.
