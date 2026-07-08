# Cycle 38 Document-Specialist Review

Date: 2026-07-08 KST
Workspace: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `5c6a45a5` on `master`
Write scope: this file only. Existing dirty review files from other lanes were not touched.

## Provenance

I read `AGENTS.md` and `CLAUDE.md` first, then inventoried tracked repository documentation and doc-like contracts with `git ls-files` and domain-specific `rg` sweeps across `AGENTS.md`, `CLAUDE.md`, root/app READMEs, `docs/`, `.context/`, deploy/config files, comments, scripts, source-contract tests, and runtime source. The tracked inventory at review time was 3,641 files, including 2,751 markdown files and 380 test files; 1,679 tracked files matched the requested domains (`auth`, deploy, migrations, privacy/GPS, image processing/HDR/color, CLIP/semantic search, UI/admin settings, service worker/PWA).

Live authority used for mismatch decisions:

- Auth: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/proxy.ts`, auth lint scripts/tests, admin API routes.
- Deploy/config: root/app READMEs, `.env.deploy.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, GitHub workflows, site-config guard.
- Migrations/privacy/data: `apps/web/drizzle/**`, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, privacy/source-contract tests.
- Image/CLIP/settings: `gallery-config*`, `settings-client.tsx`, `process-image.ts`, CLIP scripts/libs/routes, CLIP preflight tests, historical CLIP docs with their own historical-status banners.
- Service worker: `apps/web/public/sw.template.js`, generated `sw.js`, `apps/web/src/lib/sw-cache.ts`, `apps/web/scripts/build-sw.ts`, `sw-template-contract.test.ts`.

Historical `.context/plans/**` and `.context/reviews/**` files were inventoried and searched as provenance. I did not treat every archived cycle note as a current operator runbook when `CLAUDE.md`, README, tests, and source gave newer authority.

## Confirmed Issues

### DOC-C38-01 - Privacy docs say GPS is excluded from public API responses, but the public map intentionally returns GPS

Severity: Medium
Confidence: High
Classification: Confirmed documentation mismatch

Evidence:

- `CLAUDE.md:236-241` states under Privacy that GPS coordinates (`latitude`, `longitude`) are excluded from public API responses.
- `apps/web/src/lib/data.ts:409-415` documents `publicMapSelectFields` as the only unauthenticated select that exposes latitude/longitude.
- `apps/web/src/lib/data.ts:1777-1817` implements `getMapImages()` with `topics.map_visible = true` plus non-null latitude/longitude predicates, then returns map rows.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:42-67` calls `getMapImages()` and passes latitude/longitude into public map markers.
- `apps/web/src/__tests__/map-privacy.test.ts:1-9` and `:32-73` explicitly lock the contract that public map selects include GPS while normal public selects exclude it.

Failure scenario:

An operator or reviewer relying on `CLAUDE.md` can conclude that GPS is never publicly exposed by any API response. In reality, enabling `topics.map_visible` for a topic publishes marker coordinates for processed photos with GPS. The code is privacy-gated, but the top-level privacy doc omits the exception and therefore understates what the map-visible control does.

Concrete fix:

Update `CLAUDE.md` Privacy to say GPS is excluded from normal public listing/search/photo responses, except the public map path for `topics.map_visible=true` topics. Add the same operator-facing warning near the README/admin settings GPS/map copy: `map_visible` is a GPS-publishing control, not just a navigation/display toggle.

### DOC-C38-02 - API middleware comment recommends `isAdmin()` even though admin API routes must use `withAdminAuth(...)`

Severity: Low
Confidence: High
Classification: Confirmed code-comment mismatch

Evidence:

- `apps/web/src/proxy.ts:127-134` says API routes are excluded from the middleware matcher and that any new `/api/admin/*` route must implement its own auth check, “e.g., `isAdmin()`.”
- `apps/web/src/lib/api-auth.ts:45-65` documents the real wrapper contract: all `/api/admin/*` routes must use `withAdminAuth(...)` or equivalent auth plus origin checks.
- `apps/web/src/lib/api-auth.ts:122-152` enforces same-origin cookie provenance, `isAdmin()`, and no-store/nosniff response headers in the wrapper.
- `AGENTS.md:32` and `CLAUDE.md:691-693` make `npm run lint:api-auth --workspace=apps/web` blocking and require direct `withAdminAuth(...)` exports for admin API route handlers.
- `apps/web/scripts/check-api-auth.ts:1-21` and `apps/web/src/__tests__/check-api-auth.test.ts:1-19` encode that lint contract.

Failure scenario:

A future route author following the nearby middleware comment could add a new admin API handler guarded only by `isAdmin()`. The lint gate should reject direct exports that omit `withAdminAuth(...)`, but the comment points contributors toward a weaker, stale pattern that lacks the centralized CSRF/origin posture and response-header defaults.

Concrete fix:

Change the `proxy.ts` comment to: API routes are excluded from proxy middleware; every `/api/admin/*` HTTP export must be `withAdminAuth(...)` unless it implements the full equivalent auth, same-origin/token-scope, and no-store/nosniff contract. Remove the `isAdmin()` example.

## Manual-Validation Risks

### DOC-C38-03 - The repo still tracks Atik production site-config values that pass the production build guard

Severity: Medium
Confidence: High for source behavior, Medium for whether this repo intentionally remains deployment-branded
Classification: Manual-validation risk / confirmed source-doc tension

Evidence:

- `README.md:31-33` says the linked example deployment may include deployment-specific branding/settings, but fresh-install defaults are documented below.
- `README.md:60` and `apps/web/README.md:50-52` warn that `site-config.json` is build-time inlined and copied worktree values become production metadata.
- `README.md:121-122` still tells fresh installers to copy `apps/web/src/site-config.example.json` over `apps/web/src/site-config.json`.
- `apps/web/src/site-config.json:1-10` is tracked and contains Atik-specific production identity (`Atik Gallery`, `https://gallery.atik.kr`, author/footer values).
- `apps/web/src/site-config.example.json:1-12` contains generic `GalleryKit` example values.
- `apps/web/scripts/ensure-site-config.mjs:11-42` rejects missing/placeholder/invalid production URLs, but accepts `https://gallery.atik.kr` because it is a valid non-placeholder URL.
- Prior provenance also identifies this risk as `.context/reviews/run10-cycle34/_aggregate.md:160-167`.

Failure scenario:

A fresh clone can run a production build without setting `BASE_URL` and without replacing the tracked `apps/web/src/site-config.json`. The build guard passes and static metadata/canonical fallbacks can be baked with Atik identity into a different deployment. The README warns about copied config, but the repo state itself provides a real non-placeholder deployment config that satisfies the guard.

Concrete fix:

Pick one contract and make source/docs enforce it. Preferred: stop tracking deployment-specific `src/site-config.json` and require generated/local config from the example; update tests/scripts that need it. If the file must remain tracked for this deployment, teach `ensure-site-config.mjs` to reject known deployment-specific hosts for generic production builds unless an explicit deploy env confirms that identity, and make the README install path state the tracked file is not a fresh-install default.

## Aligned Areas Checked

No additional doc/code mismatch found in these requested areas:

- Deploy: `.env.deploy.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `docker-compose.yml`, and `nginx/default.conf` match the documented deploy-env precedence, build-time config caveats, post-up Docker pruning, health check, bind mounts, body-size caps, and no-hardcoded-host policy.
- Migrations: `apps/web/drizzle/meta/_journal.json`, migration files, and `apps/web/scripts/migrate.js` match the documented journal/hash/postcondition/reconcile behavior. The non-monotonic historical journal entry is already documented as historical context, while new-entry guidance remains correct.
- Image processing/settings: `gallery-config-shared.ts`, `gallery-config.ts`, `settings-hash.ts`, `settings-client.tsx`, and `process-image.ts` align with documented derivative-byte-impacting settings, GPS stripping lock, HDR/color controls, pipeline versioning, Sharp concurrency, and admin setting gates.
- CLIP/semantic search: README, `CLAUDE.md`, CLIP docs with historical banners, `clip-*` libs, semantic/similar routes, download/backfill scripts, and preflight tests align on disabled-by-default behavior, offline model loading, env-gated production mode, bounded newest-first scans, and sidecar backfill operation.
- Service worker/PWA: README/`CLAUDE.md` descriptions match `sw.template.js`, generated `sw.js`, `sw-cache.ts`, `build-sw.ts`, and `sw-template-contract.test.ts`: same-origin derivative cache, admin bypass, revocable public object/map bypass, 24h offline-only HTML fallback, deterministic SW version stamping, and HEAD-probe freshness behavior.
- Auth: aside from the stale `proxy.ts` comment above, auth docs/source/tests align on Argon2id password hashing, session cookie checks, trusted-origin guards, admin API wrapper linting, token-scope support for Lightroom-style upload APIs, and no-store/nosniff admin API headers.

## Final Sweep

Commonly missed issues checked before writing this file:

- Generated-vs-template drift for the service worker: checked `sw.template.js`, `sw.js`, `build-sw.ts`, and template contract tests.
- Public GPS exposure paths: checked normal public selects, map selects, map page, and privacy tests.
- Admin API route guidance: checked middleware comments, wrapper source, lint scripts, and tests.
- Build-time config claims: checked root/app README config docs, site config files, Docker compose comments, and the production guard.
- CLIP live-state claims: checked docs for historical-status banners and source for env/weight/backfill/runtime gates.
- Deploy runbook details: checked root deploy helper, app deploy script, nginx caps, compose mounts, and CI quality gates.

Relevant files skipped: no tracked live docs/source/test-contract files in the requested domains were intentionally skipped. I did not line-read every archived `.context/plans/**` and `.context/reviews/**` cycle artifact as current behavior; they were inventoried/searched as provenance, not treated as live documentation. Ignored/generated/runtime directories such as `node_modules`, `.next`, Playwright reports, OMX/OMC runtime state, local worktrees, live production DB state, deployed nginx state, seeded CLIP weights, and browser-installed PWA cache state were outside this source/documentation review.

Validation performed: read-only source/doc inspection and keyword inventory. No lint/typecheck/test suite was run because this task was a documentation/code mismatch review and the only permitted edit was this review artifact.
