# Document Specialist Review — Cycle 3 (2026-04-24)

No commits made.

## Inventory and method

Reviewed the repo surfaces most likely to drift out of sync with documentation:

- Top-level docs and operating instructions: `README.md`, `CLAUDE.md`, `AGENTS.md`
- App docs and examples: `apps/web/README.md`, `apps/web/.env.local.example`, `apps/web/src/site-config.example.json`, `.env.deploy.example`
- Deployment/runtime config: `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`
- Runtime implementation behind the docs: `apps/web/src/lib/{session,image-queue,process-image,gallery-config,gallery-config-shared,request-origin,mysql-cli-ssl,upload-paths,db-restore,upload-limits}.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/{health,live}/route.ts`
- Setup and E2E helpers: `apps/web/scripts/{init-db,migrate,ensure-site-config}.ts/mjs/js`, `apps/web/e2e/helpers.ts`
- Current context artifacts: `plan/**`, `.context/reviews/**`

Final sweep re-ran targeted searches for `image_sizes`, `SESSION_SECRET`, `QUEUE_CONCURRENCY`, `DB_SSL`, `site-config.json`, `/api/live`, `/api/health`, and deployment/setup commands, then checked the matching code paths before recording findings.

## Findings summary

| ID | Severity | Confidence | Status | Summary |
|---|---|---|---|---|
| WDS-01 | LOW | High | Confirmed | `CLAUDE.md` still describes image processing as “4 sizes each,” but the pipeline now uses admin-configurable sizes |
| WDS-02 | LOW | High | Confirmed | Root quick-start overstates the secrets required for `npm run init`; `SESSION_SECRET` is runtime-only |

## Detailed findings

### WDS-01 — `CLAUDE.md` still describes image processing as “4 sizes each,” but the pipeline now uses admin-configurable sizes

- **Status:** Confirmed
- **Severity:** LOW
- **Confidence:** High
- **Files/regions:** `CLAUDE.md:167-173`, `apps/web/src/lib/image-queue.ts:115-117`, `apps/web/src/lib/process-image.ts:362-417`, `apps/web/src/lib/gallery-config-shared.ts:38-105`
- **Why this is a problem:** The doc says Sharp processes AVIF/WebP/JPEG “at 4 sizes each,” but the live code passes `imageSizes` from `getGalleryConfig()` into the queue and processing pipeline. `gallery-config-shared.ts` also allows the configured list to vary and caps it at 8 sizes, so the number of derivatives is no longer fixed.
- **Concrete failure scenario:** An operator changes `image_sizes` to `800,1600,3200` and later consults `CLAUDE.md` while debugging derivative URLs. The doc makes them expect a fixed four-derivative pipeline, so they look for the wrong filenames and misdiagnose the issue when the new images correctly contain only the configured sizes.
- **Suggested fix:** Change the wording to “at configurable sizes each (default: 4 sizes: 640, 1536, 2048, 4096)” and, if you want the doc to stay precise, add a short note that the queue consumes the admin-configured list from `getGalleryConfig()`.

### WDS-02 — Root quick-start overstates the secrets required for `npm run init`; `SESSION_SECRET` is runtime-only

- **Status:** Confirmed
- **Severity:** LOW
- **Confidence:** High
- **Files/regions:** `README.md:116-118`, `apps/web/scripts/init-db.ts:24-30`, `apps/web/scripts/migrate.js:511-521`, `apps/web/src/lib/session.ts:19-45`
- **Why this is a problem:** The root README says the init script needs “DB credentials and admin/session secrets,” but `init-db.ts` only runs `migrate.js`, and `migrate.js` only requires `DB_NAME` plus `ADMIN_PASSWORD` to seed the admin user. `SESSION_SECRET` is used later by `session.ts`; in dev/test it can fall back to a DB-stored secret, and in production it is runtime-required, not init-required.
- **Concrete failure scenario:** A fresh local setup user believes `SESSION_SECRET` must be generated before they can initialize the database, so they spend time wiring a runtime secret that `npm run init` does not actually need. The setup path becomes noisier and harder to follow than the code requires.
- **Suggested fix:** Split the setup note into “init-time” and “runtime” requirements. For example: “`npm run init` needs DB credentials plus `ADMIN_PASSWORD`; `SESSION_SECRET` is required for production runtime, not for init.”

## Final sweep

After drafting the two findings, I rechecked the most likely drift points in `apps/web/README.md`, the env examples, Docker/nginx config, deploy helpers, and the active `.context` plan/review artifacts. I did not find any additional documentation/code mismatches that were strong enough to report.
