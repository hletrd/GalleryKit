# Verifier Review - Cycle 7 Lane D

Date: 2026-07-07
HEAD reviewed: `cae5fbd9` (`fix(app): 🐛 fence restore and photo viewer races`)
Mode: read-only verifier review; source was not modified. This artifact is the intended write.

## Inventory

I built the review inventory before assessing claims:
- Commands/gates: root and web `package.json`, ESLint, typecheck, Vitest, admin API auth lint, server-action origin lint, public route rate-limit lint, Playwright config, e2e seed/server scripts.
- Source categories: `apps/web/src/app` pages/routes/actions, `apps/web/src/lib`, `apps/web/src/db/schema.ts`, migrations and `migrate.js`, deploy scripts, CLIP scripts/tests, upload/queue/backfill paths, privacy selectors, admin token paths.
- Test categories: 340 unit/source-contract test files, 9 Playwright specs, lint-gate tests, source-contract scans, opt-in CLIP integration tests, e2e helpers/seed.
- Docs/contracts: `AGENTS.md`, `CLAUDE.md`, `apps/web/README.md`, committed plan/review history where relevant.

Fresh local evidence:
- `npm run lint:api-auth --workspace=apps/web`: pass; both admin API routes OK.
- `npm run lint:action-origin --workspace=apps/web`: pass; all mutating actions enforce same-origin provenance or approved public/exempt shape.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: pass; 10 public routes checked.
- `npm run lint --workspace=apps/web`: pass.
- `npm run typecheck --workspace=apps/web`: pass; Next route types generated and app/scripts `tsc` passed.
- `npm test --workspace=apps/web`: pass; 338 files passed, 2 skipped; 3132 tests passed, 4 skipped.
- `git status --short`: clean before artifact writes.

Not run:
- `npm run test:e2e --workspace=apps/web`: not run because local Playwright setup starts `scripts/run-e2e-server.mjs`, which runs `npm run init` and `npm run e2e:seed`; `seed-e2e.ts` intentionally deletes/replaces rows/files for disposable test DBs.
- `npm run build --workspace=apps/web`: not run because `prebuild` generates PWA/service-worker artifacts and this lane is source-read-only.
- `npm run deploy`: not run because it is external/production side-effecting.

## Verified Claims

- Admin API auth wrapper coverage is enforced by `check-api-auth`; fresh output listed `src/app/api/admin/db/download/route.ts` and `src/app/api/admin/lr/upload/route.ts` OK.
- Server-action same-origin coverage is enforced by `check-action-origin`; fresh output ended with all mutating server actions enforcing provenance.
- Public mutating/expensive route rate limiting is enforced by `check-public-route-rate-limit`; fresh output listed feed, upload exemptions, OG, semantic/similar, health/live routes with OK classifications.
- The prior run-9 cycle-7 LR settings defect is closed at current HEAD. The LR route forwards processing settings and semantic mode from the persisted snapshot into `enqueueImageProcessing` (`apps/web/src/app/api/admin/lr/upload/route.ts:528-565`), and tests pin both source and behavior (`apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:421-432`, `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:74-88`).
- Unit/type/lint gates are green at this HEAD. No tracked files were dirtied by the verification commands.

## Findings And Residual Risks

### VER-C7-01 - Runtime e2e proof is conditional and was not established in this read-only lane

Severity: Medium
Confidence: High
Status: manual-validation risk
File/region: `apps/web/playwright.config.ts:48-87`, `apps/web/scripts/run-e2e-server.mjs:49-62`, `apps/web/scripts/seed-e2e.ts:181-215`, `apps/web/e2e/admin.spec.ts:6-12`, `apps/web/e2e/origin-guard.spec.ts:27-73`

Evidence: Playwright defaults to a local server (`playwright.config.ts:48-87`). That server command runs `npm run init`, `npm run e2e:seed`, and `npm run build` before serving (`run-e2e-server.mjs:49-62`). The seed deletes existing seeded topic image rows/files before recreating fixtures (`seed-e2e.ts:181-215`). Admin e2e is also conditional on credentials (`admin.spec.ts:6-12`), and authenticated origin-guard proof is skipped when admin e2e is not enabled (`origin-guard.spec.ts:55-73`).

Concrete failure scenario: framework/runtime behavior around authenticated admin requests, origin headers, hydration, upload UI, or browser-only navigation breaks while lint/type/unit gates stay green. The existing e2e suite may catch it, but only when run against a configured disposable environment with admin credentials.

Suggested fix: make a disposable e2e environment part of release verification, or split a non-destructive smoke project from the destructive seed/build project so verifier lanes can run basic runtime proof without DB/file mutation.

### VER-C7-02 - LR PAT upload behavior is well unit-tested internally but not proven end-to-end through real token auth

Severity: Medium
Confidence: High
Status: confirmed integration-proof gap
File/region: `apps/web/src/app/api/admin/lr/upload/route.ts:84-92`, `apps/web/src/lib/api-auth.ts:72-90`, `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:44-47`, `apps/web/src/__tests__/api-auth-response-headers.test.ts:50-149`, `apps/web/src/__tests__/admin-tokens.test.ts:181-323`

Evidence: production LR upload uses `withAdminAuth(..., { allowTokenScope: 'lr:upload' })` and reads wrapper-supplied token context (`route.ts:84-92`). The route behavior test mocks `withAdminAuth` to identity (`lr-upload-route-behavior.test.ts:44-47`). The wrapper and token functions are tested separately with mocks (`api-auth-response-headers.test.ts:50-149`, `admin-tokens.test.ts:181-323`). No current gate proves a real PAT header flows through verify/scope/mark-used into multipart upload, DB insert, and queue enqueue.

Concrete failure scenario: a real Lightroom publish fails due to header, scope, token-context, last-used, or multipart integration drift while the route-internal and wrapper-unit tests continue passing.

Suggested fix: add one disposable integration request that creates an `lr:upload` token, POSTs a JPEG multipart request with `X-GalleryKit-Token`, asserts success plus `uploaded_by`/`last_used_at`/enqueue, and verifies an `lr:read` token cannot run handler work.

### VER-C7-03 - Public route runtime breadth is incomplete for map/timeline/year/smart-collection pages

Severity: Medium
Confidence: High
Status: likely verification gap
File/region: `apps/web/e2e/public.spec.ts:4-153`, `apps/web/e2e/not-found-status.spec.ts:35-42`, `apps/web/src/app/[locale]/(public)/map/page.tsx:34-109`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:61-225`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:84-164`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:76-225`

Evidence: current positive e2e covers home/search/photo/share/group flows (`public.spec.ts:4-153`) and negative smart-collection/year status cases (`not-found-status.spec.ts:35-42`). It does not positively visit `/map`, `/timeline`, `/year/{year}`, or `/c/{slug}`. Those pages have real data and rendering behavior: GPS marker filtering and `MapLoader`; grouped timelines and JSON-LD; smart-collection parse/compile/query; year archive grids and JSON-LD.

Concrete failure scenario: a page-level runtime regression in one of these routes ships despite green unit/lint/type gates because only lower-level or negative-path tests exercise the area.

Suggested fix: extend e2e seed with one GPS image and one public smart collection, then add positive route smokes for these four public pages.

### VER-C7-04 - Build and deploy remain unverified by this lane

Severity: Medium
Confidence: High
Status: manual-validation risk
File/region: `apps/web/package.json:10-11`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`

Evidence: `npm run build` invokes `prebuild`, which writes generated assets (`apps/web/package.json:10-11`), so I did not run it in a source-read-only lane. The deploy path is intentionally production/external side-effecting and was not run. Lint/type/unit gates passing do not prove Next standalone build output, service-worker generation, Docker image build, remote SSH config, health check, or post-up prune behavior for this HEAD.

Concrete failure scenario: a build-time-only Next.js/static generation failure, generated service-worker issue, Docker/runtime health failure, missing deploy env, or host-only problem occurs after all local non-build gates pass.

Suggested fix: run build/deploy in the normal iteration lane after review artifacts are committed/pushed, then record build/deploy exit code and a public `/api/live` or homepage smoke.

## Final Sweep

Checked categories:
- Quality gates and script implementations, including lint scanners and their pass output.
- Route/action guard coverage for admin API, mutating server actions, and public expensive/mutating routes.
- Privacy and schema safety surfaces: data selectors, migration journal/reconcile tests, DML-baseline guards.
- Upload and processing flows: browser upload, LR upload, queue snapshots, retry/bootstrap, backfill, restore-maintenance fences.
- Public runtime pages: home/photo/share plus map/timeline/year/smart-collection gaps.
- Admin runtime pages/actions: login, settings/topics upload e2e, token-management UI/action gaps.
- CLIP semantic-search activation tests and default skips.
- Docs claims against current scripts and code paths.

Verifier verdict: no confirmed source behavior defect was found in this lane, and local lint/type/unit gates are green. The remaining risk is runtime/integration evidence: e2e, build, deploy, real PAT upload, and less-traveled public pages are not fully proven by the local non-destructive gates.
