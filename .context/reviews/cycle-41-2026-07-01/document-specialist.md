# Cycle 41 Document-Specialist Review

Date: 2026-07-01
HEAD reviewed: `ae71bd5a`
Lane: document/runbook/code mismatch only. No implementation performed.

## Inventory

Authoritative docs and high-entropy operational claims reviewed:

- Root/project instructions: `AGENTS.md` from prompt, `CLAUDE.md`, root `README.md`, `apps/web/README.md`.
- Current review/plan state: `.context/reviews/_aggregate.md`, `.context/reviews/cycle-40-2026-07-01/_aggregate.md`, `.context/reviews/cycle-40-2026-07-01/docs-product-drift.md`, `.context/plans/cycle-40-2026-07-01-plan.md`, `.context/plans/cycle-40-2026-07-01-deferred.md`, run9/run10 latest plan/deferred files for carry-forward filtering.
- Deploy/runbook surfaces: `.env.deploy.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/Dockerfile`, `apps/web/.env.local.example`.
- Operational script comments sampled where they function as runbooks: `scripts/download-clip-models.ts`, `scripts/backfill-clip-embeddings.ts`, `scripts/backfill-color-pipeline.ts`, `scripts/migrate.js`, `scripts/check-js-scripts.mjs`.
- Source surfaces used to verify claims: CLIP path/model helpers, semantic backfill script, upload paths, settings action, gallery-config defaults/validators, upload limits, nginx caps, Docker runner contents, migration journal.

Not re-raised: Cycle 40 already records `TV-40-03` for JS operational scripts being syntax-checked but not semantically type-checked (`.context/plans/cycle-40-2026-07-01-deferred.md:3-11`). I verified the same evidence but did not file it as new.

## Findings

### DOC-C41-01 - CLIP sidecar runbook omits the tsconfig mount required by `tsx` path aliases

Severity: High
Confidence: High

Evidence:

- The color backfill sidecar includes a `tsconfig.json` mount: `CLAUDE.md:347-360`, specifically `CLAUDE.md:356`.
- The CLIP seed/backfill sidecars do not mount `apps/web/tsconfig.json`: `CLAUDE.md:513-522` and `CLAUDE.md:528-538`.
- The runner image does not copy `tsconfig.json`; it copies standalone output, public assets, drizzle, selected JS scripts, and prod deps only: `apps/web/Dockerfile:117-130`.
- The CLIP sidecar path imports modules that need the `@/*` alias. `backfill-clip-embeddings.ts` imports `../src/lib/clip-model` at `apps/web/scripts/backfill-clip-embeddings.ts:72-74`; `clip-model.ts` then imports `@/lib/clip-embeddings`, `@/lib/clip-model-id`, `@/lib/clip-paths`, and `@/lib/env` at `apps/web/src/lib/clip-model.ts:30-33`.
- The same risk exists through original-path resolution: `apps/web/src/lib/upload-paths.ts:10` imports `@/lib/validation`.
- Local repro matching the documented CLIP sidecar mounts (`src` + `scripts`, no `tsconfig.json`) failed before any DB/model work with: `Cannot find module '@/lib/clip-embeddings'`. Adding a `tsconfig.json` mount made the same import resolve.

Failure scenario:

An operator follows the exact CLAUDE.md semantic-search activation runbook. The sidecar starts from `/app/apps/web` in `web-web:latest`, with `src`, `scripts`, and `data` mounted, but no `tsconfig.json`. `tsx` cannot resolve the `@/*` alias used by transitive CLIP imports, so the seed/backfill command aborts at module resolution. Production semantic search cannot be activated even though the docs present these commands as the authoritative procedure.

Suggested fix:

Add the same read-only mount used by the color backfill command to both CLIP sidecar command blocks:

```bash
-v <deploy-root>/apps/web/tsconfig.json:/app/apps/web/tsconfig.json:ro \
```

Also add a regression/source-contract test that scans the CLIP sidecar examples in `CLAUDE.md` for the tsconfig mount, since the production runner intentionally does not contain the file.

### DOC-C41-02 - Root README still implies GPS stripping can be changed after uploads

Severity: Medium
Confidence: High

Evidence:

- Root README says: "Review GPS stripping before first upload; changing the setting later does not rewrite already stored originals" (`README.md:40`). That wording implies a later setting change is possible but non-retroactive.
- The app README states the current stronger contract: "GPS stripping is locked once photos exist" (`apps/web/README.md:24`).
- The server enforces that stronger contract. `updateGallerySettings()` treats `strip_gps_on_upload` as upload-contract state (`apps/web/src/app/actions/settings.ts:68-79`), compares requested vs current value (`apps/web/src/app/actions/settings.ts:115-124`), checks for any existing image (`apps/web/src/app/actions/settings.ts:125-128`), and returns `uploadSettingsLocked` instead of persisting the change when an image exists (`apps/web/src/app/actions/settings.ts:130-132`).
- The admin UI also disables the switch when images exist (`apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:684-699`).

Failure scenario:

A new operator reads the root README, uploads a trial photo, then expects to enable/disable GPS stripping afterward with only non-retroactive behavior. In current code, the setting is locked after any image exists. The operator must decide before the first real image or delete all images first. The root README under-states that lock and can lead to a bad first-upload setup.

Suggested fix:

Rewrite the root README EXIF/GPS sentence to match the app README and code, e.g. "Review GPS stripping before the first upload; once any photo exists, the setting is locked because changing it later would not rewrite already stored originals."

## Non-Findings / Confirmed Aligned

- Deploy helper docs match `scripts/deploy-remote.sh`: `.env.deploy` fallback, derived SSH fields, `DEPLOY_REMOTE_SCRIPT`, and `DEPLOY_CMD` behavior are aligned.
- Docker disk-hygiene docs match `apps/web/deploy.sh`: deploy waits for health, then prunes stopped containers, unused images, builder cache, and dangling volumes after `up -d --build`.
- Nginx body caps match README/CLAUDE claims: 2 MiB default, 64 KiB login, 250 MiB DB restore, 216 MiB dashboard upload, 216 MiB `/api/admin/lr/upload`.
- Migration journal guidance matches `migrate.js` and `_journal.json`: new `when` values must exceed the current max, and `migrate.js` post-checks every journal hash.
- Semantic-search production gating claims match source: `production` is a valid stored setting, but runtime resolution heals it to `disabled` without `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`; admin UI exposes Disabled/Stub only.
