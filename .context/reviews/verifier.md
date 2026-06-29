# Verifier Review - review-plan-fix Cycle 4

**Date:** 2026-06-29  
**HEAD:** `0fa5beb1` (`master`, in sync with `origin/master`)  
**Role:** verifier  
**Scope:** current HEAD only; no application code intentionally edited. This file is the requested review artifact.

## Verification Inventory

Required instructions read first:

- `AGENTS.md`
- `CLAUDE.md`
- `~/.agents/skills/code-review/SKILL.md` because this is a review/verifier task

Inventory covered:

- Gates and scripts: root/package workspace scripts, `apps/web/package.json`, lint scanners, typecheck scripts, Vitest, production build path, generated PWA/service-worker scripts.
- Deployment assumptions: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, deploy/disk-hygiene docs.
- Documentation contracts: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, recent `.context/reviews` and `.context/plans` only enough to avoid stale duplicate findings.
- Migrations/schema: `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, migration journal/reconcile tests.
- Privacy guards: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`, timeline/map public select guards.
- Critical user flows by source/gate evidence: upload/processing, Lightroom token/upload route, restore-maintenance quiescence, public analytics recorders, semantic/similar search limits, feed attribution, service-worker artifact serving, nginx upload/body-limit envelope.
- Generated artifacts: `apps/web/public/sw.js`, `apps/web/public/sw.template.js`, `apps/web/scripts/build-sw.ts`, and tests that pin template/generated behavior.

## Verification Evidence

| Gate / check | Result | Evidence |
| --- | --- | --- |
| API auth lint | PASS | `npm run lint:api-auth --workspace=apps/web`; 2 admin API routes OK |
| Action-origin lint | PASS | `npm run lint:action-origin --workspace=apps/web`; all mutating server actions enforce same-origin provenance |
| Public route rate-limit lint | PASS | `npm run lint:public-route-rate-limit --workspace=apps/web`; public routes OK |
| ESLint | PASS | `npm run lint --workspace=apps/web` exit 0 |
| Typecheck | PASS | `npm run typecheck --workspace=apps/web` exit 0; app + scripts clean |
| Vitest | PASS | `npm test --workspace=apps/web`; 243 files passed, 2 skipped; 2255 tests passed, 4 skipped |
| Production compile path | PASS with caveat | `npm --ignore-scripts run build --workspace=apps/web` exit 0; Next.js 16.2.9 compiled 38 routes. Local MySQL was unavailable, so sitemap generation logged the expected homepage-only fallback and build completed. |
| Migration journal/file inventory | PASS | 25 `drizzle/*.sql` files and 25 journal entries; no missing/extra tags. The one `0006 -> 0007` timestamp inversion is the documented grandfathered history guarded by `migration-journal.test.ts` and per-entry hash baselining in `migrate.js`. |
| Privacy field guards | PASS | `PrivacySensitiveKeys` has 20 keys; `publicSelectFields`, `timelineSelectFields`, `publicMapSelectFields`, and search enrichment compile/test guards are present and covered by passing typecheck/Vitest. |
| Worktree before report | PASS | `git status --short` clean before writing this verifier artifact. |

Build caveat: I did not run the exact `npm run build --workspace=apps/web` lifecycle myself because its `prebuild` hook rewrites generated files such as `apps/web/public/sw.js`. I first hit a transient "Another next build process is already running" from a concurrent build in the same repo, then reran the non-lifecycle production compile path successfully after that process exited.

## Findings

### V-C4-01 - Authoritative deploy docs/comments still describe the old broad `./public` bind mount

Status: Confirmed  
Severity: Low  
Confidence: High  
Validation: confirmed by source inspection and passing mount-shape test

Evidence:

- `apps/web/docker-compose.yml:23-26` now mounts only `./public/uploads:/app/apps/web/public/uploads`.
- `apps/web/src/__tests__/nginx-config.test.ts:47-49` locks this intended shape and rejects `./public:/app/apps/web/public`.
- `README.md:181` and `apps/web/README.md:49` correctly describe `./public/uploads`.
- But authoritative/local ops surfaces still say the persistence mount is `./public`:
  - `AGENTS.md:19` says in-use data is `./data` / `./public` + host MySQL.
  - `CLAUDE.md:460` says persistence bind mounts include `./public -> derivatives`.
  - `CLAUDE.md:475` repeats the incident lesson as `./data` + `./public` + host MySQL.
  - `apps/web/deploy.sh:39-42` comments list `./public -> /app/apps/web/public`.
  - `apps/web/deploy.sh:60` prints `Data is persisted under apps/web/data and apps/web/public`.

Why this is a problem:

The code/test contract was intentionally narrowed so immutable built assets, especially generated `sw.js`, come from the Docker image while only mutable derivatives persist on the host. The remaining docs/comments are the maintenance contract future agents and operators are told to preserve during deploy/prune changes, and they point back at the broad mount that caused the prior service-worker artifact risk.

Concrete failure scenario:

A future deploy change follows `AGENTS.md` or the `deploy.sh` safety comments and restores `./public:/app/apps/web/public` to "preserve derivatives." Production then serves host-side generated assets over the image's freshly built assets again; service-worker/cache fixes can be masked by stale committed `sw.js`, and the already-fixed C3 service-worker deploy-artifact class reopens.

Concrete fix:

Update `AGENTS.md`, `CLAUDE.md` disk-hygiene lines, and `apps/web/deploy.sh` comments/output to say persistence is `./data`, `./public/uploads`, and `./src/site-config.json`, while immutable public assets are served from the built image. Keep the existing `nginx-config.test.ts` mount-shape assertion.

## Confirmed Non-Findings

- The prior runtime broad-public-mount production risk is fixed in code: Compose mounts only `public/uploads`, and the test explicitly rejects mounting all of `public`.
- README upload-serving and Lightroom body-size guidance are fixed: public docs now say nginx proxies uploads to Next and include the `/api/admin/lr/upload` 216 MiB exception.
- Restore-maintenance gaps from cycle 3 are fixed: `bulkUpdateImages`, LR token create/revoke, and public analytics recorders now guard maintenance state and have targeted tests.
- Feed attribution docs/comments are fixed in active code comments: public Atom currently falls back to feed-level author until a safe display-name field exists.
- Client search no longer imports server CLIP helpers for UI constants; `SEMANTIC_TOP_K_DEFAULT` comes from `clip-embedding-constants`.
- The committed `sw.js` stamp lags HEAD, but this is not a current production-serving defect after the mount narrowing: Docker build prebuild stamps the image copy, and runtime no longer masks it with host `public/`.

## Final Missed-Issues Sweep

Swept stale review findings, deployment comments, generated artifact behavior, migration journal integrity, schema/reconcile drop coverage, privacy field symmetry, public route/auth/origin lint gates, restore-maintenance coverage, semantic search cap documentation, removed Stripe/reactions surfaces, and README/CLAUDE mismatches. No critical/high correctness, security, migration, or privacy blockers were found at current HEAD.

Coverage limits:

- I did not deploy, push, or mutate production.
- I did not run Playwright e2e or manual browser validation.
- Local MySQL was unavailable; build evidence covers the sitemap fallback path, not live DB-backed sitemap contents.
- Exact `npm run build` prebuild lifecycle was not rerun by me to preserve current HEAD artifacts; the production compile path passed without lifecycle scripts.

## Disposition

Findings: 1 confirmed low-severity documentation/ops-contract issue. Gates: lint, security lint scanners, typecheck, Vitest, and production compile path all passed.
