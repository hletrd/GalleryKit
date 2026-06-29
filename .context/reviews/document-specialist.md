# Document-Specialist Review - Review-Plan-Fix Cycle 2

**Date:** 2026-06-29
**HEAD:** `3d1387045e0d7f1e06fb48756e412228bbdaf08d` (`build(sw): 🔨 update post-build service worker stamp`)
**Role:** documentation-code mismatch review against authoritative repo docs, scripts, config, and current code.
**Edit boundary:** Review artifact only; no application code edited.

## Inventory Coverage

Review-relevant inventory was built before reviewing:

- Authoritative docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Package/config/deploy docs and metadata: `package.json`, `apps/web/package.json`, `.env.deploy.example`, `apps/web/.env.local.example`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`.
- Code behind documented claims: `apps/web/scripts/ensure-site-config.mjs`, `apps/web/scripts/migrate.js`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/scripts/download-clip-models.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/db/schema.ts`.
- Current review/plan context: recent run-9 cycle-8 aggregate/tracer/document-specialist reports and current run-10 cycle-2 plans.

## Findings

### DOC-C2-01 - CLIP production backfill examples omit required `--force` for the documented pre-enable flow

**Status:** Confirmed issue
**Severity:** High
**Confidence:** High

**Mismatched docs/code regions:**

- `apps/web/README.md:35-37` lists `npx tsx scripts/backfill-clip-embeddings.ts --production` for regenerating CLIP embeddings.
- `apps/web/scripts/backfill-clip-embeddings.ts:4-22` gives production and sidecar examples without `--force`.
- `apps/web/scripts/backfill-clip-embeddings.ts:90-95` exits successfully without processing if semantic search mode is disabled/unset and `--force` is absent.
- Correct current guidance appears elsewhere: `apps/web/README.md:68-70` and `CLAUDE.md:506-527` use `--production --force` for pre-enable production backfill.

**Failure scenario:** An operator follows the script table or script header before enabling the DB mode. The command exits `0` after logging that semantic search is disabled, creates no embeddings, and the operator proceeds to enable production. `apps/web/src/app/api/search/semantic/route.ts:255-259` then returns 503 because production mode has no production embeddings.

**Suggested fix:** Change the app README script table and the script header sidecar examples to `npx tsx scripts/backfill-clip-embeddings.ts --production --force` for the pre-enable workflow. Add one sentence that plain `--production` is only suitable after the DB mode is already `production`.

## Verified Matches / Non-Findings

- `CLAUDE.md:506-527` now matches the required CLIP pre-enable `--production --force` flow; the mismatch is limited to the app README script table and script header examples.
- `apps/web/.env.local.example:45-47` matches the current `NEXT_UPLOAD_BODY_MAX_BYTES` default from `apps/web/src/lib/upload-limits.ts`.
- `CLAUDE.md:212` and the OG route behavior now agree on build-time base-URL validation and request-time per-photo fallback behavior; the stale "runtime 404 only" mismatch is not present.
- `CLAUDE.md:152`, `apps/web/src/db/schema.ts`, `apps/web/scripts/migrate.js`, and smart-collection code agree on `smart_collections.query_json`.
- `apps/web/src/lib/gallery-config.ts:83`, `apps/web/src/lib/gallery-config-shared.ts`, and the settings UI/messages agree that `avifEffort` supports `0-9`.
- `AGENTS.md`, `CLAUDE.md`, `apps/web/deploy.sh`, and `apps/web/nginx/default.conf` agree on deploy pruning after `up -d`, bind-mounted persistence, and no `volume prune -a`.
- Upload/body-size docs are consistent with `apps/web/src/lib/upload-limits.ts`, Next server-action body sizing, and nginx per-route caps.

## Documentation Risk

### DOC-C2-RISK-01 - Semantic-search bounded-scan limitation is documented but operationally easy to miss

**Status:** Risk, not a confirmed mismatch
**Severity:** Low
**Confidence:** High

**Evidence:**

- `apps/web/README.md:61` documents newest-first bounded scanning and older-photo omission risk.
- `apps/web/src/app/api/search/semantic/route.ts:240-249` and `apps/web/src/app/api/search/similar/[id]/route.ts:141-150` implement that newest-first bounded scan.
- `apps/web/src/lib/clip-embeddings.ts:18-40` exposes the configurable scan cap.

**Risk scenario:** The limitation is accurate but lives in the app README only. An operator may treat production CLIP enablement as complete after successful backfill even after the corpus exceeds the cap, while older relevant images silently stop being candidates.

**Suggested fix:** Add the scan-cap caveat to `CLAUDE.md` near the CLIP production section or add an admin/health warning when embedding count exceeds `SEMANTIC_SCAN_LIMIT`.

## Final Missed-Issues Sweep

I searched for mismatch classes that previously produced defects: stale env defaults, CLI flags, build-time validation claims, OG fallback comments, schema-column terminology, admin-only/privacy guard docs, nginx cap claims, deploy-prune guarantees, upload-size limits, semantic-search activation gates, and config option ranges. Current authoritative docs and code align except for the CLIP backfill examples above and the bounded-scan visibility risk.

**Disposition:** 1 confirmed documentation-code mismatch, 1 documentation risk, no application-code edits.
