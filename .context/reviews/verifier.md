# Verifier Review

## Coverage / inventory

I reviewed the repository at the doc/build/runtime boundaries that actually determine correctness:

- **Docs and top-level contract:** `README.md`, `CLAUDE.md`, `apps/web/README.md`, `AGENTS.md`
- **Build/deploy entrypoints:** `package.json`, `apps/web/package.json`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `scripts/deploy-remote.sh`
- **Core runtime surfaces:** `apps/web/src/lib/*` (config, auth, rate limiting, session handling, upload/image processing, storage, restore safety, SEO/CSP, validation, revalidation, queue shutdown, tag/topic helpers, etc.)
- **Routes/pages/actions:** `apps/web/src/app/**`, `apps/web/src/components/**`, `apps/web/src/proxy.ts`, `apps/web/src/i18n/request.ts`
- **Tests:** `apps/web/src/__tests__/*.test.ts` plus the checked Playwright E2E specs

I also verified the repository with fresh commands:

- `npm run typecheck --workspace=apps/web` ✅
- `npm test --workspace=apps/web` ✅ (`71 passed`, `474 passed`)
- `npm run lint --workspace=apps/web` ✅
- `npm run lint:api-auth --workspace=apps/web` ✅
- `npm run lint:action-origin --workspace=apps/web` ✅
- `npm run build --workspace=apps/web` ✅

## Findings

### 1) Production build guard does not actually protect the normal build path

- **Severity:** Medium
- **Confidence:** High
- **Category:** Confirmed

**Where**

- `apps/web/scripts/ensure-site-config.mjs:13-28` — the placeholder/base-URL rejection only runs when `process.env.NODE_ENV === 'production'`
- `apps/web/package.json:10-11` — `npm run build` invokes the prebuild check without setting `NODE_ENV`
- `apps/web/Dockerfile:44-48` — the Docker build stage runs `node scripts/ensure-site-config.mjs` before any production-only `NODE_ENV` is established
- Docs that claim the guard exists: `README.md:41-56` and `apps/web/README.md:34-39`

**Problem**

The docs say production builds reject placeholder public URLs, but the actual guard is gated on `NODE_ENV === 'production'`. The normal build entrypoints in this repo do not set that variable before invoking the check, so placeholder URLs such as `http://localhost:3000` are accepted during `npm run build` and Docker image builds.

**Concrete failure scenario**

If a deployment keeps the checked-in placeholder `src/site-config.json.url` (`http://localhost:3000`) or another placeholder host, the build still succeeds. That means the app can ship with bad canonical URLs / sitemap URLs / metadata origins even though the docs say the build should fail fast.

This was confirmed directly:

- `npm run prebuild --workspace=apps/web` exited `0`
- `npm run build --workspace=apps/web` completed successfully with the placeholder config
- `NODE_ENV=production node scripts/ensure-site-config.mjs` correctly fails, which proves the guard exists but is not wired to the repo's normal build path

**Suggested fix**

Make the validation unconditional for the build entrypoints, or explicitly set `NODE_ENV=production` before running the check in both the npm build path and the Docker build stage. A dedicated build flag would be even clearer than relying on `NODE_ENV`.

## Final sweep

I did not find additional evidence-backed correctness issues after reviewing the full doc/config/build path, the auth/rate-limit/same-origin guards, the upload/image pipeline, the data layer, the public/admin routes, and the test surface. The repository passes typecheck, lint, unit tests, the auth/origin guard scripts, and a production build; the only confirmed problem I found is the build-guard wiring described above.
