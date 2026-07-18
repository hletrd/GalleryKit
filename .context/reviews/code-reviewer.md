# Code reviewer — cycle 2 provenance

Review target: `ba4bc60acd4bc41b29ec02f509c3455d115ba083` (`master`), 2026-07-18 KST. Review only; no application code was changed.

## Relevant-file inventory

I enumerated all 939 tracked/workspace files with `rg --files`, then reviewed the code-facing inventory: 81 files under `apps/web/src/app/`, 115 under `apps/web/src/lib/`, 61 under `apps/web/src/components/`, the 3 DB files, `instrumentation.ts`, `proxy.ts`, 369 unit-test files, 9 Playwright specs, all 31 migration SQL files plus `_journal.json` and `scripts/migrate.js`, all app scripts, `Dockerfile`, Compose/nginx/Next/TypeScript/ESLint/Vitest/Playwright configs, both deploy scripts, root/app package manifests, and the governing `AGENTS.md`, `CLAUDE.md`, and READMEs. I traced recent changes in auth limiting, GeoIP initialization, navigation/search, masonry priority, and deploy-file ownership through their tests and consumers.

## Findings

### CR-2-01 — A DB-less production build caches the incomplete sitemap for the first hour

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed** by source and generated build artifact
- Region: `apps/web/src/app/sitemap.ts:4-12,36-43,52-82`; generated `.next/prerender-manifest.json` entry for `/sitemap.xml`
- Cross-file interaction: `apps/web/Dockerfile` builds without DB access; `sitemap()` catches that failure and returns the fallback; Next records `initialRevalidateSeconds: 3600` for the generated route.

Failure scenario: every deploy builds while MySQL is intentionally unreachable. The generated sitemap contains only fallback rows, yet the prerender manifest marks that result fresh for 3,600 seconds. A crawler arriving just after deploy receives no topic/photo URLs (and may receive discovery defaults that do not match DB settings). The comment at `sitemap.ts:40` says the first runtime hit replaces it, but the compiled manifest proves the initial artifact remains valid until revalidation is due.

Suggested fix: avoid prerendering the DB-dependent result. Make the route dynamic while caching the successful DB result with an explicit one-hour data cache, or make DB data available during build. Add a built-artifact test that asserts the first runtime request cannot serve the build fallback as a fresh one-hour sitemap.

### CR-2-02 — Repository ownership is treated as secret-file trust without an explicit trust decision

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed** local privilege-boundary regression
- Region: `scripts/deploy-remote.sh:61-75,94-105`; `apps/web/deploy.sh:24-38,63-67`
- Cross-file interaction: both scripts derive `repo_owner_uid` from filesystem metadata, then accept a mode-0600 env file owned by either the executing UID or that derived UID; the root helper sources the accepted file and executes its `DEPLOY_CMD` through `bash -lc`.

Failure scenario: root/sudo or a privileged automation account runs the helper from a checkout owned by a less-privileged workspace user. That user owns both the repository and `.env.deploy`, so the new `repo_owner_uid` exception passes. The file can set `DEPLOY_CMD` or contain shell syntax and gains code execution as the privileged deploy account. This reopens the exact scenario the previous owner check intended to close; “repository owner” is inferred, not explicitly configured as trusted.

Suggested fix: require current-user ownership by default. If shared mounts are required, accept a separately configured trusted UID/root-owned policy and verify the repository path and env file against that explicit principal. Add a real cross-UID behavioral test rather than only source-text assertions.

### CR-2-03 — Failed new-container health leaves the failed release live

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed; revalidated carry-forward**
- Region: `apps/web/deploy.sh:63-89`; `apps/web/docker-compose.yml:3-17`

Failure scenario: `docker compose up -d --build` replaces the previously healthy fixed-name container. If the new image cannot boot or never becomes healthy, the script prints logs and exits, but it neither restores the prior image/container nor stops the restart-looping release. The health gate reports failure after availability has already been lost; it is not a release gate.

Suggested fix: retain the prior image ID, deploy the candidate under a temporary name/port, switch traffic only after health, then remove the old container. A smaller interim fix is an explicit rollback to the captured prior image on health failure, followed by verification that the rollback is healthy.

## Verified defenses / non-findings

- ESLint, app/script typecheck, all three auth/origin/rate-limit scanners, 3,408 unit tests, production build, and production dependency audit passed.
- The recent login change advances both local fallback buckets before either durable increment; its targeted failure test and source ordering agree.
- GeoIP initialization now emits one diagnostic and retains `XX` fail-degrade behavior.
- The recent masonry eager-load split keeps high fetch priority limited to the measured above-fold set; no correctness regression was confirmed.
- Admin API wrappers, mutation barriers, public route limiter declarations, privacy projection guards, migration postconditions, and advisory-lock release helpers were swept with no new code defect confirmed.

## Final missed-issues sweep

I re-searched error swallowing, unsafe casts/suppressions, TODO/deferred markers, raw advisory-lock release, public route exports, server-action exports, schema/reconcile parity, filesystem path construction, runtime/build config imports, generated PWA assets, and recent commit diffs. That sweep reinforced the three findings above and did not confirm another new critical/high correctness issue.
