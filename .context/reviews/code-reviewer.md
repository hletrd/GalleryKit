# Code Reviewer — review-plan-fix cycle 4

**Date:** 2026-06-29  
**HEAD:** `0fa5beb107ff232ce6a004887ad7c574dd0e2963` (`0fa5beb1`)  
**Role:** code-reviewer  
**Scope:** current HEAD only; repository-wide code quality, logic, SOLID/maintainability, correctness, edge cases, error handling, cross-file interactions, and test gaps. No application code changes made.

## Inventory Coverage

I built the review inventory from `AGENTS.md`, full `CLAUDE.md`, current cycle-3 plan/deferred files, current `.context/reviews/code-reviewer.md`, latest aggregate history, `git log -12`, `git diff 3f24038b04f48c73f5dac079cd3276fecbd48282..HEAD`, route/action inventories, and full source enumeration.

Relevant files examined:

- Instructions and history: `AGENTS.md`, `CLAUDE.md`, `.context/plans/cycle-3-2026-06-29-plan.md`, `.context/plans/cycle-3-2026-06-29-deferred.md`, current `.context/reviews/code-reviewer.md`.
- Current delta from the previous code-review base: 48 files, including restore-maintenance fixes, public analytics actions, route-rate-limit lint, CLIP constant split, map loader, nav aria labels, upload picker contract, docker-compose public mount, i18n strings, tests, docs, and review/plan records.
- Full code inventory: 477 source files under `apps/web/src`, 27 scripts under `apps/web/scripts`, 8 e2e files, 28 Drizzle migration/meta files, plus package/config/deploy files.
- Line-level reads on touched implementation regions: `apps/web/src/app/actions/images.ts:928-1127`, `apps/web/src/app/actions/lr-tokens.ts:28-140`, `apps/web/src/app/actions/public.ts:113-411`, `apps/web/scripts/check-public-route-rate-limit.ts:107-153`, `apps/web/src/components/map/map-loader.tsx:24-39`, `apps/web/src/app/[locale]/(public)/map/page.tsx:11-68`, `apps/web/src/components/nav-client.tsx:41-46` and `:161-165`, `apps/web/src/components/search.tsx:1-21`, `apps/web/src/components/upload-dropzone.tsx:175-177`, `apps/web/src/lib/clip-embedding-constants.ts:1-13`, `apps/web/src/lib/clip-embeddings.ts:9-44`, `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/app/[locale]/admin/db-actions.ts:266-360`, `apps/web/docker-compose.yml:23-26`, and `apps/web/src/lib/data-timeline.ts:88-97`.
- Repo-wide sweeps: public/admin route handlers, server-action origin gates, restore-maintenance coverage, raw DB mutations, client imports of server-oriented CLIP helpers, privacy-sensitive selectors, map GPS exposure, Drizzle/schema comments, generated static asset behavior, and stale prior findings.

Skipped as not review-relevant code: `node_modules`, `test-results`, screenshots/images under `.context`, binary fixtures/icons/fonts, and generated build output. No relevant source/config/script/test/migration file category was skipped.

## Validation Evidence

- `npm run lint --workspace=apps/web` — pass.
- `npm run lint:api-auth --workspace=apps/web` — pass; 2 admin API routes wrapped.
- `npm run lint:action-origin --workspace=apps/web` — pass; mutating server actions enforce same-origin provenance or documented read-only/public exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web` — pass; public mutating route inventory remains covered.
- `npm run typecheck --workspace=apps/web` — pass.
- Targeted tests for the touched contracts: `npm test --workspace=apps/web -- bulk-update-images.test.ts lr-tokens-action.test.ts public-actions.test.ts check-public-route-rate-limit.test.ts client-source-contracts.test.ts map-thumb-wiring.test.ts nginx-config.test.ts semantic-scan-limit-source.test.ts` — pass, 8 files / 106 tests.
- Full unit suite: `npm test --workspace=apps/web` — pass, 243 files passed / 2 skipped, 2255 tests passed / 4 skipped.
- `npm run build --workspace=apps/web` — pass. Build logged the documented local-DB-unavailable sitemap fallback (`ECONNREFUSED 127.0.0.1:3306`) and completed successfully. The build regenerated `apps/web/public/sw.js` to the current short SHA as a local side effect; I restored that review-only side effect before writing this report.

## Confirmed Issues

None.

The cycle-3 scheduled fixes are present at current HEAD and hold under source review plus tests:

- `bulkUpdateImages` now fails fast during restore maintenance before origin/auth/DB work (`apps/web/src/app/actions/images.ts:928-936`) and is covered by `bulk-update-images.test.ts`.
- Lightroom token create/revoke now fail fast during restore maintenance before credential writes (`apps/web/src/app/actions/lr-tokens.ts:28-40`, `apps/web/src/app/actions/lr-tokens.ts:108-116`) and are covered by `lr-tokens-action.test.ts`.
- Public analytics recorders skip writes during restore maintenance after input validation but before headers/DB work (`apps/web/src/app/actions/public.ts:357-409`) and are covered by `public-actions.test.ts`.
- Unsupported advertised browser-upload extensions were removed from the picker accept list (`apps/web/src/components/upload-dropzone.tsx:175-177`), matching the source contract tests.
- The public route rate-limit scanner now ignores uncalled nested helper references and requires a top-level executed limiter before mutation (`apps/web/scripts/check-public-route-rate-limit.ts:107-153`); current public API routes pass the lint gate.
- Search no longer imports the server-oriented embedding helper from the client; constants live in the client-safe module (`apps/web/src/components/search.tsx:19`, `apps/web/src/lib/clip-embedding-constants.ts:1-13`).
- The compose public mount now preserves built immutable public assets while only bind-mounting mutable uploads (`apps/web/docker-compose.yml:23-26`).

## Likely Issues

None at actionable confidence.

## Known Risks Not Refiled

The current deferred items remain real operational or architectural risks, but they are already recorded in `.context/plans/cycle-3-2026-06-29-deferred.md` and were not refiled as fresh findings:

- Timeline/year/on-this-day indexing and date-part query scalability: `apps/web/src/lib/data-timeline.ts:95-205`, deferred as `DEF-C3-02`.
- Semantic/similar search bounded brute-force scan and recall limits: `apps/web/src/app/api/search/semantic/route.ts:240-281`, `apps/web/src/app/api/search/similar/[id]/route.ts:141-170`, deferred as `DEF-C3-03`.
- Production CLIP embedding backpressure against Sharp queue work: `apps/web/src/lib/image-queue.ts:512-567`, deferred as `DEF-C3-04`.
- Process-local coordination state under unsupported scale-out: `apps/web/src/lib/restore-maintenance.ts:1-56`, deferred as `DEF-C3-05`.
- Public map marker/index scalability: `apps/web/src/lib/data.ts:1624-1660`, `apps/web/src/components/map/map-client.tsx:76-143`, deferred as `DEF-C3-08`.

## Non-Findings / Stale Claims Avoided

- The restore-maintenance gaps from cycle 3 are fixed in source and covered by targeted tests.
- The route-rate-limit scanner no longer accepts nested/unreachable helper calls as satisfying a mutating route.
- The CLIP constant split does not leak `process`/`Buffer`/server imports into `Search`; server routes still correctly import scan/top-k caps from `clip-embeddings`.
- The `sw.js` current-HEAD stamp mismatch after docs/test commits is a build-time artifact, not a production serving defect after the compose mount fix: production build regenerates `sw.js`, and `./public/uploads` no longer masks built `public/sw.js` in the container.

## Final Missed-Issues Sweep

Final sweep covered changed files since the cycle-3 review base, all public/admin API routes, all server actions, restore maintenance gates, DB mutation surfaces, public privacy selectors, map GPS exception boundaries, client/server import boundaries, generated asset serving, route metadata title templating, upload picker/runtime-format alignment, Drizzle/schema comments, lint gates, typecheck, targeted tests, full unit suite, and production build.

Verdict: **0 confirmed issues, 0 likely issues.**
