# Verifier Review - review-plan-fix Cycle 3

**Date:** 2026-06-29
**HEAD:** `3f24038b04f48c73f5dac079cd3276fecbd48282` (`master`, in sync with `origin/master`)
**Role:** verifier
**Scope:** current HEAD only; no application code edited. This file is the requested review artifact.

## Inventory

Reviewed the required repo instructions first: `AGENTS.md` and `CLAUDE.md`.

Inventory covered:

- Current HEAD and worktree: `git status --short --branch`, `git rev-parse HEAD`, `git log -1 --stat --decorate --oneline`, recent cycle-2 source commits.
- Build/deploy surface: root `package.json`, `apps/web/package.json`, `.dockerignore`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/public/sw.js`, `apps/web/public/sw.template.js`, `apps/web/scripts/build-sw.ts`, `apps/web/scripts/generate-pwa-icons.ts`.
- App source routes/components/libs/scripts/tests inventory under `apps/web/src/app`, `apps/web/src/components`, `apps/web/src/lib`, `apps/web/src/__tests__`, `apps/web/scripts`, `apps/web/e2e`.
- Cycle-relevant files from current HEAD history: Docker/operator default changes, CLIP backfill docs/script comments, admin route metadata, timeline/year metadata and labels, service-worker stamp.
- Schema/privacy surface: `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`.
- Review/plan history: `.context/reviews`, `.context/plans`, root `plan/`.

## Verification Evidence

| Gate / check | Result | Evidence |
| --- | --- | --- |
| API auth lint | PASS | `npm run lint:api-auth --workspace=apps/web`; 2 admin API routes OK |
| Action-origin lint | PASS | `npm run lint:action-origin --workspace=apps/web`; all mutating server actions enforce same-origin provenance |
| Public-route rate-limit lint | PASS | `npm run lint:public-route-rate-limit --workspace=apps/web`; public mutating routes OK |
| ESLint | PASS | `npm run lint --workspace=apps/web` exit 0 |
| Typecheck | PASS | `npm run typecheck --workspace=apps/web` exit 0; app + scripts clean |
| Vitest | PASS | `npm test --workspace=apps/web`; 243 files passed, 2 skipped; 2238 tests passed, 4 skipped |
| Production compile path | PASS with caveat | `npm --ignore-scripts run build --workspace=apps/web` exit 0; local sitemap DB fallback logged for missing MySQL and build completed |
| Worktree cleanliness | PASS | `git status --short` empty after verification commands |

Build caveat: I did not run the exact `npm run build --workspace=apps/web` lifecycle because `prebuild` rewrites `apps/web/public/sw.js`. I validated the production compile without lifecycle scripts to preserve current HEAD for review, then inspected the skipped generator/deploy path manually.

## Findings

### V-C3-01 - Runtime public bind mount can mask build-generated service-worker assets

Status: Likely / manual-validation risk
Severity: Low-Medium
Confidence: Medium

Evidence:

- Current committed service worker is stamped `2051bb87-p7` in `apps/web/public/sw.js:21-26`, while current HEAD is `3f24038b`.
- The generator says the stamp is derived from `git rev-parse --short HEAD` plus `IMAGE_PIPELINE_VERSION` in `apps/web/scripts/build-sw.ts:28-46`.
- The normal build lifecycle runs that generator via `apps/web/package.json:10-11`.
- The Docker image build also runs `npm run build` in `apps/web/Dockerfile:71-75`.
- But the runtime service bind-mounts host `./public` over `/app/apps/web/public` in `apps/web/docker-compose.yml:23-26`, after `apps/web/deploy.sh:10-31` only performs `git pull --ff-only` and `docker compose ... up -d --build`.

Failure scenario:

On deploy, Docker regenerates `sw.js` inside the image, but the running container serves the host-mounted `apps/web/public/sw.js` instead. If the committed host artifact is stale or generated from a previous source commit, the service-worker cache namespace may not reflect the image build that is actually running. For a future service-worker logic fix or image-pipeline cache-invalidation change, clients can remain on the old `gk-images-*`, `gk-html-*`, and `gk-meta-*` namespaces until a separately committed host artifact advances the stamp.

Concrete fix:

Make the runtime serve generated immutable public assets from the image and mount only mutable upload/resource persistence, for example `./public/uploads` (and any genuinely mutable resource directory) instead of all `./public`. Alternatively, add a host-side deploy step that regenerates `apps/web/public/sw.js` before `docker compose up` and make the stamp source self-consistent for committed artifacts, such as a source/template tree hash rather than the uncommittable current HEAD hash.

## Confirmed Non-Findings

- Security lint gates are green for admin API wrappers, mutating server-action origin checks, and public mutating route rate limits.
- New admin metadata helpers use existing localized nav/LR-token keys in both `en.json` and `ko.json`; typecheck/build confirmed route metadata compatibility.
- Timeline/year public pages now use localized `common`/`aria` fallbacks and include Open Graph/Twitter metadata without introducing new public data selectors.
- CLIP production backfill guidance now documents `--production --force` for pre-enable population, matching the script's semantic-mode gate.
- No schema migration was added in this HEAD. Journal tags and SQL files still correspond; privacy-sensitive fields remain omitted from `publicSelectFields` and guarded by compile-time plus Vitest checks.
- Docker deploy pruning still runs after `up -d` and keeps the documented no-`-a` `volume prune` shape; bind-mounted data remains outside Docker volume pruning.

## Final Sweep

Checked focused/skipped tests, script and root command drift, i18n key coverage, generated public assets, ignored runtime upload artifacts, migration inventory, public selector privacy guards, deployment assumptions, and current review/plan history. No confirmed critical/high correctness, security, migration, privacy, or deployment blockers were found in current HEAD. The single actionable item above is a likely deploy-artifact consistency risk that should be validated against the live deployment path before changing mount strategy.
