# Architect Review — Deep Review Slice

Repo: `/Users/hletrd/flash-shared/gallery`  
Date: 2026-04-28  
Mode: fan-out subagent B, review-only; no fixes implemented.

## Inventory and coverage

Inventory was built first from `git ls-files` plus `git status --short`, excluding `node_modules`, `.next`/build output, generated tsbuildinfo, uploaded derivative/original files, and binary artifacts unless directly relevant to architecture/deployment boundaries.

- Reviewed 930 text-ish tracked files by category and then deep-inspected the architecture-relevant surface: `apps/web/src/app/**`, `components/**`, `lib/**`, `db/**`, migrations, server actions, API routes, auth/origin gates, i18n/layout, storage/upload subsystems, queue/restore coordination, tests, CI, Docker, compose, nginx, and docs.
- Cross-file interactions reviewed: build-time vs runtime environment, public/private upload boundaries, process-local state, server-action lint topology, image serving paths, config ownership, test gate structure, and deployment assumptions.
- Test architecture inventoried: 70 unit/integration test files and 6 Playwright specs. Admin E2E skips were cross-checked against CI credentials and helper auto-enable logic.

Uncommitted files present at review start and included where relevant:

```text
 M .context/reviews/_aggregate.md
 M .context/reviews/architect.md
 M .context/reviews/code-reviewer.md
 M .context/reviews/critic.md
 M .context/reviews/designer.md
 M .context/reviews/perf-reviewer.md
M  .context/reviews/security-reviewer.md
 M .context/reviews/test-engineer.md
 M .context/reviews/tracer.md
 M .context/reviews/verifier.md
 M .gitignore
 M apps/web/playwright.config.ts
 M apps/web/src/__tests__/touch-target-audit.test.ts
 M apps/web/src/components/lightbox.tsx
 M apps/web/vitest.config.ts
```

This report intentionally replaces only `.context/reviews/architect.md`.

## Findings

### A1 — `IMAGE_BASE_URL` is split between build-time optimizer policy and runtime URL generation

- **Classification:** Confirmed architecture risk
- **Severity:** Medium
- **Confidence:** High
- **Location:** `apps/web/next.config.ts:28`, `apps/web/next.config.ts:64-75`, `apps/web/src/lib/constants.ts:6-7`, `apps/web/src/lib/image-url.ts:4-9`, `apps/web/Dockerfile:35-38`, `apps/web/docker-compose.yml:7-20`, `README.md:142-144`, `apps/web/README.md:36-39`
- **Problem:** Next's image optimizer allow-list is computed from `IMAGE_BASE_URL` at build/config evaluation time, while rendered image URLs read `IMAGE_BASE_URL` at runtime through `constants.ts`/`image-url.ts`. Docker forwards the value as a build arg, but runtime env is separate via `.env.local`. The docs warn users to set it before build, which confirms the split contract.
- **Failure scenario:** An operator changes `.env.local` or CDN origin and restarts without rebuilding. The rendered `<img>/<picture>` URLs can point at the new origin while Next's configured remote patterns still allow the old origin, causing optimizer failures or inconsistent image behavior. The reverse mismatch is also possible after rebuilding with one value and running with another.
- **Suggested fix:** Make the image asset origin a single-source contract. Options: bake it into the client/server bundle as a public build-time constant and fail startup if runtime differs; store a build manifest value and compare at boot; or avoid Next optimization for CDN-hosted uploads so runtime asset origin changes are intentionally supported.

### A2 — The nginx static-upload config assumes a container filesystem path while deployment docs describe a host-side proxy

- **Classification:** Likely deployment risk
- **Severity:** Medium
- **Confidence:** High
- **Location:** `apps/web/nginx/default.conf:96-105`, `apps/web/docker-compose.yml:13-25`, `README.md:176`, `apps/web/README.md:42`
- **Problem:** The checked-in nginx config serves derivatives with `root /app/apps/web/public`, but the documented compose topology uses `network_mode: host`, a host-side reverse proxy, and a bind mount from `./public` into the container. If an operator copies the nginx config to the host unchanged, `/app/apps/web/public` may not exist on the host.
- **Failure scenario:** Processed uploads are correctly written under the project `public/uploads`, but nginx attempts to serve them from `/app/apps/web/public` on the host and returns 404. Depending on location precedence, requests may not fall through to the Node upload route, so the gallery appears broken while the app itself is healthy.
- **Suggested fix:** Provide separate container-nginx and host-nginx templates, parameterize the upload root, or document the exact host path replacement. Add a deploy smoke test that requests one known derivative through the public origin after upload processing.

### A3 — Several correctness boundaries are process-local despite being deployment-critical

- **Classification:** Confirmed topology/scalability risk
- **Severity:** Medium
- **Confidence:** High
- **Location:** `README.md:146`, `apps/web/src/lib/data.ts:11-23`, `apps/web/src/lib/restore-maintenance.ts:1-55`, `apps/web/src/lib/upload-tracker-state.ts:7-20`, `apps/web/src/app/actions/images.ts:171-244`, `apps/web/src/lib/image-queue.ts:121-140`, `apps/web/src/lib/image-queue.ts:469-498`
- **Problem:** The app uses process-local state for shared-group view-count buffering, restore maintenance mode, upload tracker quota state, and image queue/enqueued/retry state. The README explicitly says the deployment is single web-instance/single-writer, but the code does not enforce that topology at runtime.
- **Failure scenario:** A future deployment uses PM2 cluster mode, multiple Node workers, or horizontal scaling. One process can accept uploads while another is in restore maintenance; upload quotas split by process; view increments flush independently or are lost on process death; queue state and retry bookkeeping diverge.
- **Suggested fix:** Enforce the topology with a startup invariant and docs (`WEB_CONCURRENCY=1`, no cluster mode), or move coordination to shared storage: DB/Redis counters, DB-backed job claims, and DB-backed maintenance state. Keep the existing MySQL advisory locks, but do not rely on process globals for cross-process correctness.

### A4 — The experimental storage abstraction conflicts with the current private-original/public-derivative boundary

- **Classification:** Confirmed design drift
- **Severity:** Medium
- **Confidence:** High
- **Location:** `apps/web/src/lib/storage/index.ts:1-12`, `apps/web/src/lib/storage/types.ts:11-14`, `apps/web/src/lib/storage/local.ts:20`, `apps/web/src/lib/storage/local.ts:123-126`, `apps/web/src/lib/upload-paths.ts:24-40`, `apps/web/src/lib/upload-paths.ts:82-102`
- **Problem:** The live pipeline keeps originals under private `UPLOAD_ORIGINAL_ROOT`, and production startup fails closed if legacy public originals exist. The storage abstraction, although marked not live, documents keys like `original/abc.jpg`, maps all keys to public `UPLOAD_ROOT`, creates an `original` directory under that public root, and returns `/uploads/${key}` for every key.
- **Failure scenario:** A future migration wires uploads through `getStorage()` and writes originals to `original/...`. Those originals become public-route-shaped, conflict with the legacy-original startup guard, and violate the privacy boundary the rest of the upload subsystem enforces.
- **Suggested fix:** Split the storage interface into private originals and public derivatives, or encode visibility in the key/API. The local backend should map originals to `UPLOAD_ORIGINAL_ROOT` and refuse public URLs for private keys. Until migration starts, consider removing `original` from `REQUIRED_DIRS` and updating examples.

### A5 — Analytics configuration is split between file-backed site config and env-backed CSP

- **Classification:** Confirmed cross-file config bug
- **Severity:** Low
- **Confidence:** High
- **Location:** `README.md:45-56`, `apps/web/src/site-config.example.json:1-10`, `apps/web/src/app/[locale]/layout.tsx:118-128`, `apps/web/src/lib/content-security-policy.ts:58-69`
- **Problem:** Documentation and `site-config.example.json` expose `google_analytics_id`, and the layout renders Google Tag Manager/Analytics scripts from that value. Production CSP allows those hosts only when `NEXT_PUBLIC_GA_ID` is set. The two configuration sources are not tied together.
- **Failure scenario:** An operator follows the documented `site-config.json` flow, sets `google_analytics_id`, and deploys. The app renders GA scripts, but CSP blocks them because `NEXT_PUBLIC_GA_ID` was never set, leading to a silent analytics failure and console noise.
- **Suggested fix:** Drive CSP from the same resolved analytics config as the layout, or make analytics env-only and remove the file-backed key. Add a test covering `google_analytics_id` without `NEXT_PUBLIC_GA_ID`.

### A6 — Next image local patterns are broader than the public upload-serving contract

- **Classification:** Boundary risk
- **Severity:** Low
- **Confidence:** High
- **Location:** `apps/web/next.config.ts:64-75`, `apps/web/src/lib/serve-upload.ts:7-17`, `apps/web/src/lib/serve-upload.ts:32-49`, `apps/web/nginx/default.conf:92-105`
- **Problem:** The Next image config allows local image optimization for `/**` and `/**?**`, while the actual upload-serving code and nginx config restrict public uploads to `/uploads/{jpeg,webp,avif}` and image extensions. The optimizer policy is therefore wider than the intended public asset boundary.
- **Failure scenario:** A future internal image-like route or accidental public file path can become optimizable/cacheable by Next even though the app's upload boundary would not explicitly allow it. This is not an immediate exploit because the route must still exist and be accessible, but it weakens defense-in-depth and makes future boundary reviews harder.
- **Suggested fix:** Replace `/**` with explicit local patterns for `/uploads/jpeg/**`, `/uploads/webp/**`, `/uploads/avif/**`, plus localized prefixes if needed. Keep the optimizer allow-list aligned with `serve-upload.ts` and nginx.

### A7 — The server-action origin lint gate depends on file topology rather than scanning all server-action-capable files

- **Classification:** Risk needing future validation
- **Severity:** Low
- **Confidence:** Medium
- **Location:** `apps/web/scripts/check-action-origin.ts:13-21`, `apps/web/scripts/check-action-origin.ts:86-97`, `apps/web/scripts/check-action-origin.ts:221-262`, `apps/web/src/proxy.ts:96-101`
- **Problem:** The origin lint gate recursively scans `app/actions/**` and hard-codes `app/[locale]/admin/db-actions.ts`, excluding some intentional files. That is a useful current gate, but it relies on developers placing every future mutating server action in those locations. Next App Router also allows colocated `'use server'` files and server actions under route segments.
- **Failure scenario:** A future admin feature adds a colocated `actions.ts` under `app/[locale]/admin/(protected)/new-feature/` and exports a mutating action. It is outside the scanner's topology, so CI can pass even if `requireSameOriginAdmin()` is omitted.
- **Suggested fix:** Scan all `apps/web/src/app/**` files containing `'use server'`, then apply explicit exemptions for public/read-only/auth surfaces. Alternatively, codify and test a stricter architectural rule that mutating server actions may only live under `app/actions/**` plus named exceptions.

### A8 — Verification architecture is drifting toward slower, less diagnostic gates

- **Classification:** Confirmed test/deployment architecture risk
- **Severity:** Low
- **Confidence:** High
- **Location:** `apps/web/playwright.config.ts:32`, `apps/web/playwright.config.ts:61-68`, `apps/web/vitest.config.ts:10-12`, `.github/workflows/quality.yml:75-79`
- **Problem:** The current worktree raises default Playwright/Vitest timeouts substantially, and CI builds once inside Playwright's web-server command and again after E2E. These choices make gates more tolerant of slow machines, but they also make failures slower and duplicate expensive build work.
- **Failure scenario:** A startup hang or slow test consumes most of the 30-minute CI job before failing. A build regression is paid for twice per run, reducing signal quality and making contributors more likely to bypass slow checks locally.
- **Suggested fix:** Keep fast default budgets with explicit env overrides for slow hosts, add targeted timeouts for known slow tests only, and restructure CI so a single build artifact is reused for E2E and build validation. If duplicate clean-build validation is intentional, document and measure it.

## Positive architecture controls observed

- Mutating admin actions generally call `requireSameOriginAdmin()` and the CI scanner has regression tests for direct exported action shapes.
- Private originals are separated from public derivatives in the live upload path, and production startup fails closed if legacy public originals remain.
- Upload processing uses MySQL advisory locks for per-image work and a global upload/settings contract, which is safer than relying only on process-local JavaScript locks.
- Public pages deliberately omit sensitive original filenames/GPS fields from public select shapes, and public search/load-more actions have rate limits.
- CI runs lint, typecheck, security lint gates, unit tests, DB init, Playwright E2E, and build in one workflow.

## Final sweep and skipped files

Final sweep rechecked deployment docs against Docker/compose/nginx, config/env ownership, image URL/CSP behavior, storage abstraction boundaries, process-local state, server-action scanner topology, upload/private-public separation, DB/query layer interfaces, route/page caching choices, and modified test configs. Generated build output, uploaded media, binary snapshots, and old review/planning markdown were excluded from detailed architecture review unless they affected active gates or provenance. No implementation changes were made.

## Count

- Total findings: 8
- High: 0
- Medium: 4
- Low: 4
