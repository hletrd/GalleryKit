# Cycle 28 Verifier Review

Role: verifier
Workspace: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `395de19b599f8a4342be89fa5c06f2a52aa2c526`
Date: 2026-06-30

## Inventory And Evidence

Instructions and canonical docs read first:

- `AGENTS.md`
- `CLAUDE.md`
- code-review skill instructions at `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Review-relevant file inventory examined:

- Repository policy and docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `.context/reviews/verifier.md` from cycle 27.
- Package, CI, and deploy gates: `package.json`, `apps/web/package.json`, `.github/workflows/quality.yml`, `.dockerignore`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/scripts/entrypoint.sh`.
- Migration/schema surfaces: all 28 `apps/web/drizzle/*.sql` files, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`, `apps/web/src/__tests__/migration-journal*.test.ts`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`.
- Security scanner surfaces: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-public-route-rate-limit.ts`, and their fixture tests.
- Restore and DB safety surfaces: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/scripts/restore-maintenance-recovery.{ts,mjs}`, `apps/web/src/instrumentation.ts`.
- Upload, queue, and mutable-storage surfaces: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-tracker*.ts`.
- Public API and rate-limit surfaces: `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/request-origin.ts`.
- Config/privacy/client-boundary surfaces: `apps/web/next.config.ts`, `apps/web/src/lib/gallery-config*.ts`, `apps/web/src/lib/settings-hash.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`, `apps/web/src/__tests__/client-server-only-boundary.test.ts`.
- Browser-flow surfaces: `apps/web/playwright.config.ts`, `apps/web/scripts/run-e2e-server.mjs`, all 5 `apps/web/e2e/*.spec.ts` files.
- Whole-tree inventory: enumerated non-`.git`, non-`node_modules` repo files with `rg --files`; counted 512 app source files, 272 unit test files, 5 E2E specs, and 28 SQL migrations. Binary fixtures/assets were inventoried by path and only inspected where relevant to build artifact inclusion.

Validation run during this review:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run lint --workspace=apps/web` passed.
- `npm run typecheck --workspace=apps/web` passed.
- `npm test --workspace=apps/web` passed: 270 files passed, 2 skipped; 2528 tests passed, 4 skipped.
- `npm run build --workspace=apps/web` passed, but emitted a Turbopack/NFT warning about tracing the whole project unintentionally. During static generation it also logged the expected sitemap DB fallback because no local MySQL server was running.
- `npm run test:e2e --workspace=apps/web` did not start because local MySQL on `127.0.0.1:3306` was unavailable. The CI workflow provisions MySQL before E2E, so this is an environment blocker for local verification, not an app failure.
- Targeted regression check for cycle-27 restore findings passed: `npm test --workspace=apps/web -- sql-restore-scan.test.ts restore-maintenance.test.ts`.

## Confirmed Issues

### V28-MED-01 - Standalone build output traces mutable uploads, tests, and source files despite the runtime-data contract

Severity: Medium
Confidence: High for local standalone output; Medium for production-image bloat/leak risk because Docker context ignores some mutable data before build.
Status: Confirmed

Evidence:

- `npm run build --workspace=apps/web` completed successfully but printed Turbopack's warning: "Encountered unexpected file in NFT list" and "the whole project was traced unintentionally". The import trace named `apps/web/next.config.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, and `apps/web/src/instrumentation.ts`.
- `apps/web/src/instrumentation.ts:1-4` imports `@/lib/restore-maintenance-durable` at Node startup.
- `apps/web/src/lib/restore-maintenance-durable.ts:24-38` resolves the durable marker as relative `data/restore-maintenance.json` and calls `fs.existsSync()` on that relative path.
- `apps/web/Dockerfile:117-125` describes copying "necessary files" and copies the whole `.next/standalone` tree into the runner image.
- `CLAUDE.md:475` / `AGENTS.md:19` state that mutable data is protected by bind mounts and immutable public assets come from the image.
- After the build, `.next/standalone/apps/web` contained runtime-irrelevant and mutable surfaces:
  - `apps/web/.next/standalone/apps/web/data/uploads/original/6c42f581-692d-4748-a162-a0e9017c698a.jpg`
  - `apps/web/.next/standalone/apps/web/data/uploads/original/6e5582a3-ae1d-4ca5-95ac-a2d1c7fb8f88.jpg`
  - `apps/web/.next/standalone/apps/web/public/uploads/...` derivative files
  - 277 files under `apps/web/.next/standalone/apps/web/src/__tests__`
  - 8 files under `apps/web/.next/standalone/apps/web/e2e`
  - 518 files under `apps/web/.next/standalone/apps/web/src`
- `.dockerignore:16-20` excludes `apps/web/public/uploads`, `apps/web/public/resources`, and `apps/web/data` from Docker build context, which reduces production private-data exposure when building strictly through Docker. It does not explain or prevent the broad standalone trace itself, and it does not exclude `src/__tests__` or `e2e` from the traced standalone tree.

Problem:

The build gate treats the NFT trace warning as non-fatal, but the emitted standalone artifact is broader than the stated runtime contract. A standalone build produced on a machine with real originals or derivatives can package those mutable/private files into `.next/standalone`. The Docker build path has a context-level mitigation for mutable data, but the runner still copies whatever the standalone tracer includes, and the current local evidence shows source, tests, E2E fixtures, and upload trees are in scope.

Concrete failure scenario:

An operator or developer runs `npm run build` on a checkout that contains real `apps/web/data/uploads/original` files or `apps/web/public/uploads` derivatives, then archives, uploads, or deploys `.next/standalone` directly for debugging or a non-Docker smoke. Private originals and generated derivatives are included in that artifact. In Docker builds, mutable data is mostly excluded before tracing, but the same over-trace can still bloat the image with app source/test/E2E files and makes future context-ignore drift a privacy-sensitive failure.

Suggested fix:

Make restore-maintenance marker path resolution statically scoped for Next's file tracer, for example by resolving the default marker under an explicit app data root rather than a bare relative `data` path, and use a test override only in test mode. Then add a post-build or unit contract that fails if `.next/standalone/apps/web` contains `data/`, `public/uploads/`, `public/resources/`, `src/__tests__/`, or `e2e/`. Keep the Docker `.dockerignore` exclusions as defense in depth, but do not rely on them as the only privacy boundary.

## Likely Issues

None beyond V28-MED-01.

## Risks Needing Manual Validation

- Local E2E could not run without MySQL. The CI workflow does provide MySQL and the web server bootstrap path is configured for it, so this review treats E2E as not locally validated rather than failing.
- The production Docker path likely avoids embedding `apps/web/data` and `apps/web/public/uploads` because `.dockerignore` excludes them before `COPY . .`, but a Docker build artifact should still be checked after fixing V28-MED-01 to prove the standalone tree is minimal.

## Final Missed-Issues Sweep

I rechecked the prior cycle-27 verifier findings against the current tree. The restore-maintenance recovery command is now a production-runnable `.mjs` script copied into the runner image, and `CLAUDE.md` now says to restart/redeploy after clearing from a separate process. The SQL restore scanner now rejects priority-modified `INSERT`, schema-qualified identifiers, and the targeted restore tests pass.

No review-relevant file category was intentionally skipped. I inventoried the full app tree, docs, migrations, scripts, route/action surfaces, security scanners, unit tests, E2E specs, deploy/Docker files, and generated standalone output. Generated build directories were inspected only for the build-artifact finding; binary assets were inventoried by path unless their presence in the artifact was itself the evidence.
