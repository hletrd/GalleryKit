# Document-Specialist Review - Review-Plan-Fix Cycle 6

**Date:** 2026-06-29
**HEAD reviewed:** `5443009e411113bf97fe2d8fcb166b2ac78625fb`
**Role:** documentation/code consistency reviewer.
**Boundary:** Reviewed current `HEAD` only. This artifact is the only intended write. Existing unrelated modified review files were not touched.

## Inventory Coverage

Read `AGENTS.md` first, then `CLAUDE.md`, before broader inspection.

Built the review inventory from `git ls-tree -r --name-only HEAD` before findings:

- Total tracked files inventoried: 2,504.
- Governing docs: `AGENTS.md`, `CLAUDE.md`, root `README.md`, `apps/web/README.md`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`, `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`.
- Planning/review context: `.context/plans/README.md`, active cycle/deferred plans, top-level `.context/reviews/*.md`, and targeted `.context/plans/done/*` / archive references when current docs pointed there.
- Deploy/config surfaces: root/app `package.json`, `.env.deploy.example`, `apps/web/.env.local.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `.dockerignore`, `apps/web/.dockerignore`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, `apps/web/scripts/ensure-site-config.mjs`.
- Schema/migration/runbook surfaces: `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`, restore/migration source-contract tests.
- Contract-bearing implementation/tests: app routes/actions, CLIP modules/scripts/tests, upload/original-path modules, privacy/select-field guards, service worker template/generated file/tests, storage quarantine, deploy-script contract, public freshness routes, backup/restore code, lint/security scanners, and package scripts.

## Findings

### DOC-C6-01 - Backup/restore docs name the wrong original-upload directory

**Status:** Confirmed issue
**Severity:** Low
**Confidence:** High
**Classification:** confirmed documentation/code mismatch
**Validation:** Source inspection and full Vitest run.

**Mismatched regions:**

- `CLAUDE.md:209` says DB backup/restore does not snapshot or roll back host files in `data/originals`, `public/uploads`, or `public/resources`.
- The authoritative original-upload path is `data/uploads/original/`:
  - `CLAUDE.md:176` and `CLAUDE.md:249` both describe originals as stored under `data/uploads/original/`.
  - `apps/web/src/lib/upload-paths.ts:27-40` resolves the default private original root to `apps/web/data/uploads/original` or `data/uploads/original`.
  - `apps/web/Dockerfile:85` sets `UPLOAD_ORIGINAL_ROOT="/app/data/uploads/original"` and `apps/web/Dockerfile:122` creates `/app/data/uploads/original`.
  - `apps/web/scripts/migrate.js:46-50` defaults legacy-original migration to `data/uploads/original`.

**Why this is a problem:** This is an operational/runbook sentence for backup and restore scope. It tells operators which host files are outside SQL restore coverage, but names a directory that the current app does not use.

**Concrete failure scenario:** An operator preparing a full rollback reads this sentence, snapshots `data/originals`, `public/uploads`, and `public/resources`, then restores an SQL dump after deleting or corrupting originals under `data/uploads/original`. The DB rows come back, processed derivatives may still exist, but the private originals needed for reprocessing/backfill are missing because the documented host path was wrong.

**Suggested fix:** Change `CLAUDE.md:209` from `data/originals` to `data/uploads/original`, or phrase it as the `./data` bind mount with the current private-original subpath called out explicitly.

## Likely Issues

None found.

## Risks Needing Manual Validation

None found.

## Verified Non-Findings

- The prior cycle document-specialist CLIP comment findings are fixed: `semantic-search-route.test.ts` now documents stub as the default test mode while both stub and operator-gated production serve requests, and `app/actions/embeddings.ts` now describes active-model-version selection.
- Deploy docs match implementation: remote deploy config is root `.env.deploy` by default with an external fallback, Docker deploy prunes only after `up -d`, automatic volume prune omits `-a`, immutable public assets are packaged into the image, and mutable `public/uploads` / `public/resources` are narrow bind mounts.
- Migration/restore docs match current code except for the original-path typo above: restore now holds the DB restore lock, upload-processing contract lock, and color-pipeline backfill lock, then runs `scripts/migrate.js` after successful import before revalidation/success.
- CLIP production docs match current code: production mode is env-gated, offline loader and downloader share `resolveClipModelsRoot`, the revision-subdir cache layout is tested, production scans only `PRODUCTION_MODEL_VERSION`, and stub rows remain segregated.
- Service-worker docs match template/generated behavior: HTML offline fallback excludes admin-rendered pages and revocable `/s/<key>` / `/g/<key>` pages, with the 24 h TTL and 50-entry cap present in both `sw.template.js` and generated `sw.js`.
- Privacy docs match guards: `publicSelectFields`, timeline fields, search enrichment fields, `_PrivacySensitiveKeys`, and `SENSITIVE_KEYS` agree on admin-only fields including color/HDR diagnostics and `uploaded_by`.
- Version and test-count claims are current: package manifests/Dockerfile align with Node 24+, Next 16.2.x, React 19, TypeScript 6, and the full Vitest suite reports 2,279 passed / 4 skipped tests.

## Final Missed-Issues Sweep

Final targeted sweeps covered stale path names (`data/originals`, original upload roots), deploy helper docs, bind mounts, Docker ignore rules, CLIP/stub/production wording, migration journal/reconcile coverage, restore maintenance, service-worker offline caching, public route freshness, storage-backend quarantine, paid-download removal, Lightroom token scopes, env/default claims, and source comments containing `MUST`/contract language.

Intentionally not inspected line-by-line: binary/image assets, generated screenshots under `.context/reviews/archive/`, the full historical `.context/reviews/archive/` corpus, and old archived implementation plans that were not referenced by current authoritative docs. They were inventoried and searched only where current docs/contracts pointed at them.

Verification run:

- `npm run test --workspace=apps/web -- --run --reporter=default` — passed, 248 files, 2 skipped files, 2,279 passed tests, 4 skipped tests.

**Disposition:** 1 confirmed finding, 0 likely findings, 0 manual-validation-only risks. No application-code fixes, commits, pushes, or deploys performed.
