# Cycle 92 Code Reviewer

Review date: 2026-07-01
Current HEAD reviewed: `508d355` (`docs(review): 📝 close cycle 91 release evidence`)
Lane: code-reviewer — code quality, logic, SOLID/maintainability, and cross-file correctness.

## Inventory First

I built the repo inventory before issue analysis. Tracked-file inventory from `git ls-files`:

- Total tracked files: 3172.
- Main app source: 559 files under `apps/web/src/`.
- Route/action surface: 77 files under `apps/web/src/app/`, including public pages, admin pages, API routes, upload serving routes, and server actions.
- Components: 59 files under `apps/web/src/components/`.
- Library/data/security/processing helpers: 106 files under `apps/web/src/lib/`.
- DB/schema: `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, seed/init support.
- Scripts: 30 files under `apps/web/scripts/`, including migrations, restore recovery, backfills, lint scanners, seed/e2e helpers, and deployment support.
- Migrations: 29 SQL migrations plus Drizzle metadata under `apps/web/drizzle/`.
- Tests: 309 unit/source-contract tests under `apps/web/src/__tests__/`, 8 e2e files/fixtures under `apps/web/e2e/`.
- Runtime/deploy/config: root/app `package*.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, `apps/web/playwright.config.ts`, `apps/web/vitest.config.ts`, `apps/web/tsconfig*.json`, `.github/workflows/quality.yml`.
- i18n/config assets: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, ignored local `apps/web/src/site-config.json`, tracked `apps/web/src/site-config.example.json`.
- Prior review context read for active carry-forward issues and stale-finding avoidance: `.context/reviews/cycle-91-2026-07-01/code-reviewer.md`, `.context/reviews/cycle-91-2026-07-01/architect.md`, `.context/reviews/_aggregate.md`, `.context/plans/cycle-91-2026-07-01-deferred.md`.

High-risk files inspected with line evidence included:

- Restore/mutation barrier: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/actions/settings.ts`, plus action inventory across `apps/web/src/app/actions/*.ts`.
- Semantic embedding schema/query/write path: `apps/web/src/db/schema.ts`, `apps/web/drizzle/0012_image_embeddings.sql`, `apps/web/drizzle/0022_image_embeddings_model_version_idx.sql`, `apps/web/src/lib/image-queue.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`.
- Runtime/static config contract: `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/scripts/ensure-site-config.mjs`, `apps/web/src/lib/data.ts`, `apps/web/src/components/nav-client.tsx`, `apps/web/src/app/[locale]/layout.tsx`, README/CLAUDE deployment language.
- Recent code-bearing changes since cycle 88/91: `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/src/__tests__/cycle-89-source-contracts.test.ts`, `apps/web/src/__tests__/a11y-us-p15.test.ts`, `apps/web/src/components/lightbox.tsx`.

## Summary

- CRITICAL: 0
- HIGH: 1 confirmed
- MEDIUM: 1 confirmed, 1 likely/manual-validation risk
- LOW: 0 confirmed

Recommendation: **REQUEST CHANGES for the two confirmed cross-file correctness issues when their deferred scope is opened.** No new narrow code-quality defect was found in the latest test/docs-only delta, but the current repo still contains the two already-active architecture defects below.

## Confirmed Issues

### C92-CODE-01 — Restore maintenance does not fence already-in-flight non-upload admin mutations

Severity: **High**
Confidence: **High**
Category: cross-file correctness / race condition / maintainability of mutation invariants

Evidence:

- `restoreDatabase` obtains a DB restore advisory lock at `apps/web/src/app/[locale]/admin/db-actions.ts:390`-`398`.
- It also acquires the upload-processing contract lock because uploads can otherwise pass their checks and then insert/enqueue during restore (`apps/web/src/app/[locale]/admin/db-actions.ts:400`-`410`).
- It fences color and semantic backfills at `apps/web/src/app/[locale]/admin/db-actions.ts:413`-`447`.
- It enters durable restore maintenance only later at `apps/web/src/app/[locale]/admin/db-actions.ts:449`-`452`, then flushes/quiesces before running the import at `apps/web/src/app/[locale]/admin/db-actions.ts:492`-`503`.
- The maintenance check primitive is process-local and returns only the current flag value (`apps/web/src/lib/restore-maintenance.ts:21`-`31`); it is not a held write lock.
- Representative non-upload admin mutation `updateTopic` checks maintenance once at entry (`apps/web/src/app/actions/topics.ts:182`-`185`), then can await topic image processing at `apps/web/src/app/actions/topics.ts:240`-`243`, and only afterward enters the route lock/DB transaction at `apps/web/src/app/actions/topics.ts:249`-`256`.
- Inside that transaction, `updateTopic` performs multiple application-table writes: insert new topic at `apps/web/src/app/actions/topics.ts:285`-`291`, update images and aliases at `apps/web/src/app/actions/topics.ts:292`-`293`, update `topic_views` at `apps/web/src/app/actions/topics.ts:301`, rewrite smart-collection JSON at `apps/web/src/app/actions/topics.ts:331`-`334`, and delete the old topic at `apps/web/src/app/actions/topics.ts:338`-`339`.
- Representative settings mutation has the same one-time-check shape: `updateGallerySettings` checks maintenance at `apps/web/src/app/actions/settings.ts:41`-`44`, performs awaited DB reads at `apps/web/src/app/actions/settings.ts:93`-`116` and `apps/web/src/app/actions/settings.ts:137`-`154`, then writes `admin_settings` in a later transaction at `apps/web/src/app/actions/settings.ts:163`-`175`.

Why this is a defect:

A foreground admin mutation can pass its entry check, then restore can start and set durable/process maintenance, and the original mutation can still write after the restore window begins. Uploads have an explicit lock/late-check path, but broad non-upload admin writers do not participate in a shared foreground mutation barrier. That can produce lost updates, writes into a database being imported, stale revalidation/audit claims, or DB/filesystem split-brain depending on timing.

Recommended fix:

Add a shared foreground admin mutation barrier, e.g. `withRestoreWriteBarrier(actionName, fn)`, and use it around the final DB-write window for every application-table writer (`topics`, `tags`, `images`, `settings`, `sharing`, `collections`, `admin-users`, `lr-tokens`, `seo`, in-app backfill trigger). The barrier should either acquire a dedicated advisory lock that restore also holds, or extend the restore lock protocol explicitly; it should recheck durable/process maintenance immediately before writing. Add regression tests where restore begins after a representative action entry precheck but before its transaction.

### C92-CODE-02 — `image_embeddings` model-version filtering is undermined by one-row-per-image storage

Severity: **Medium**
Confidence: **High**
Category: schema/query cross-file correctness / rollback and model-upgrade maintainability

Evidence:

- Drizzle schema defines `imageEmbeddings.imageId` as the primary key (`apps/web/src/db/schema.ts:284`-`285`) and stores `modelVersion` as a non-key column (`apps/web/src/db/schema.ts:289`-`290`).
- The physical migration matches that: `image_embeddings` has `image_id`, `embedding`, `model_version`, and `PRIMARY KEY (image_id)` at `apps/web/drizzle/0012_image_embeddings.sql:5`-`10`.
- A later migration adds only a serving index on `(model_version, updated_at)`, not a uniqueness/key shape that allows multiple versions per image (`apps/web/drizzle/0022_image_embeddings_model_version_idx.sql:1`-`9`).
- Semantic search dynamically selects an active model version (`apps/web/src/app/api/search/semantic/route.ts:188`-`204`) and filters rows by that active version when scanning (`apps/web/src/app/api/search/semantic/route.ts:270`-`279`).
- Similar-photo search is production-only and filters the target and scan by `PRODUCTION_MODEL_VERSION` (`apps/web/src/app/api/search/similar/[id]/route.ts:135`-`143`, `apps/web/src/app/api/search/similar/[id]/route.ts:168`-`177`).
- The live queue writer upserts by primary key only, so writing a stub row and writing a production row for the same image replace each other (`apps/web/src/lib/image-queue.ts:379`-`390`).
- The sidecar backfill tries to select rows missing the target model version (`apps/web/scripts/backfill-clip-embeddings.ts:161`-`180`), but the insert uses `onDuplicateKeyUpdate` and overwrites the single row's `modelVersion` (`apps/web/scripts/backfill-clip-embeddings.ts:212`-`223`).

Why this is a defect:

The routes and indexes are designed around `model_version`, but the table can persist only one version per image. Switching from stub to production, rolling back, or introducing a future production model version destructively replaces the previous embedding row. During a model migration, active-version queries can return partial/empty results until every image is re-embedded, and rollback requires another destructive re-embedding pass rather than a simple mode/version switch.

Recommended fix:

Migrate `image_embeddings` to one row per `(image_id, model_version)` (composite primary key or equivalent unique key) while retaining the serving index on `(model_version, updated_at)`. Update Drizzle schema, `reconcileLegacySchema` in `scripts/migrate.js`, queue writes, sidecar backfill, and route queries. Add a regression test that stores two model versions for one image and proves active-version scans select one without deleting the other.

## Likely Issues / Manual-Validation Risks

### C92-RISK-01 — Runtime `site-config.json` bind mount may be inert or split-brain because consumers statically import JSON

Severity: **Medium**
Confidence: **Medium**
Status: **Likely/manual-validation risk, not fully confirmed without inspecting a built standalone bundle or Docker smoke**

Evidence:

- Compose bind-mounts host `./src/site-config.json` into the running container at `apps/web/docker-compose.yml:24`-`28`.
- Docker validates the source JSON before `next build` (`apps/web/Dockerfile:96`-`100`) and then copies the standalone build/public/drizzle/scripts into the runtime image (`apps/web/Dockerfile:130`-`145`).
- Runtime consumers use static JSON imports, including server layout analytics (`apps/web/src/app/[locale]/layout.tsx:11`, `apps/web/src/app/[locale]/layout.tsx:147`-`155`), client nav home-link code (`apps/web/src/components/nav-client.tsx:14`, `apps/web/src/components/nav-client.tsx:72`-`74`), and SEO defaults (`apps/web/src/lib/data.ts:1793`-`1800`).
- Deploy docs and comments present `src/site-config.json` as a runtime bind-mounted persistence item: `apps/web/deploy.sh:84`-`90`, `AGENTS.md:19`, `CLAUDE.md:477`, while CLAUDE also says some values are static build-time fallback values at `CLAUDE.md:663`-`673`.
- The local `apps/web/src/site-config.json` is ignored by `apps/web/.gitignore` but present in the working tree; it is not tracked (`git check-ignore` reports `/src/site-config.json`).

Risk:

If an operator edits the mounted host JSON and restarts without rebuilding, some or all static-import consumers may continue using values bundled at build time. That is especially likely for client code (`home_link`) and GA script inclusion, but should be verified against the generated standalone output. This is a deployment/operator-contract risk rather than a proven runtime bug from source alone.

Recommended validation/fix:

Choose and document one contract: rebuild-only, or true runtime-loaded config. For true runtime config, replace static JSON imports for runtime-editable fields with a validated server-side loader and pass client-safe values through props/HTML data. Add a Docker/standalone smoke that changes the mounted JSON after build and asserts the documented behavior.

## No New Confirmed Findings In Recent Narrow Changes

Recent code-bearing change review:

- `baefb42` backfill pixel-cap change is correctly wired in both backfill paths: in-app detection uses `MAX_INPUT_PIXELS` at `apps/web/src/lib/admin-backfill-runner.ts:591`-`597`; sidecar detection uses `MAX_INPUT_PIXELS` at `apps/web/scripts/backfill-color-pipeline.ts:272`-`281`. The source-contract test asserts both at `apps/web/src/__tests__/cycle-89-source-contracts.test.ts:9`-`30`.
- The lightbox accessibility source-contract update matches current code: test now expects the status-region contract at `apps/web/src/__tests__/a11y-us-p15.test.ts:57`-`64`; lightbox has `role="status"`, `aria-live="polite"`, and `aria-label={t('aria.photoPosition', { current: currentIndex + 1, total: totalCount })}` at `apps/web/src/components/lightbox.tsx:676`-`683`, while the image keeps descriptive alt text at `apps/web/src/components/lightbox.tsx:501`.

## Validation Evidence

Static scanners run successfully from `apps/web`:

- `NODE_OPTIONS='--import tsx' node scripts/check-api-auth.ts` — passed for both admin API routes.
- `NODE_OPTIONS='--import tsx' node scripts/check-action-origin.ts` — passed; mutating server actions enforce same-origin provenance or carry approved read-only/public exemptions.
- `NODE_OPTIONS='--import tsx' node scripts/check-public-route-rate-limit.ts` — passed; public mutating/expensive routes are rate-limited or explicitly exempted.

Review-only validation not run:

- Full `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, and Playwright e2e were not run in this lane to avoid cache/build/test-output side effects. The last commit message records those gates for the narrow a11y change, but this report does not claim fresh full-gate evidence.
- Production CLIP inference and Docker `site-config.json` runtime behavior were not manually exercised; those remain source-review/manual-validation risks.

## Final Missed-Issue Sweep

Additional sweeps performed after forming findings:

- `rg` inventory over app routes/actions, components, lib, db, scripts, migrations, tests, config, and deployment files.
- Exported route-handler inventory checked against auth/rate-limit scanners.
- Exported server-action inventory checked against origin scanner output and maintenance-guard locations.
- Grep sweeps for `TODO`, `FIXME`, `HACK`, `@ts-ignore`, `@ts-expect-error`, lint suppressions, `dangerouslySetInnerHTML`, raw SQL, direct `fetch`, timers, `Promise.all`, file operations, `JSON.parse`, `parseInt`, and non-null assertions.
- JSON parse sites reviewed: processing-settings snapshot (`image-queue.ts:173`-`180`), smart-collection AST (`smart-collections.ts:316`-`327`), admin-token scopes (`admin-tokens.ts:121`-`128`), semantic request body (`api/search/semantic/route.ts:220`-`235`), and wide-gamut localStorage (`wide-gamut-hint.tsx:36`-`55`) are guarded.
- `parseInt` production use is confined to HMAC-verified session timestamp parsing (`apps/web/src/lib/session.ts:121`-`132`); other production hits are comments about prior bugs. Test-only `parseInt` calls are not product defects.
- File-serving/path operations were sampled around `serve-upload.ts`, backup download route, upload paths, local storage abstraction, restore marker, and migration scripts; no new path traversal or symlink issue was identified beyond the confirmed restore barrier issue.

No additional confirmed issues were found in this final sweep.
