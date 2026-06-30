# Cycle 33 Document Specialist Review

Reviewer: document-specialist
Repo: `/Users/hletrd/flash-shared/gallery`
Date: 2026-06-30 KST
Scope: documentation, source comments, runbooks, package scripts, deployment notes, migration/schema guidance, `.context` planning/review artifacts, `docs/superpowers` CLIP records, and current source behavior. Product source and sibling review files were not edited.

## Inventory

Authoritative docs read first:

- `AGENTS.md`
- `CLAUDE.md`

Documentation and runbook surfaces inspected:

- Root/app docs: `README.md`, `apps/web/README.md`, `apps/web/__test_fixtures__/color/README.md`
- Package/script metadata: `package.json`, `apps/web/package.json`
- Deploy/runtime docs and sources: `.env.deploy.example`, `scripts/deploy-remote.sh`, `apps/web/.env.local.example`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `apps/web/scripts/entrypoint.sh`
- Schema/migration docs and sources: `apps/web/src/db/schema.ts`, `apps/web/drizzle/meta/_journal.json`, migration SQL files, `apps/web/scripts/migrate.js`
- Feature/runbook sources cited by docs: semantic search routes/scripts/libs, LR upload route, upload limits, rate limit helpers, SEO/site config, storage quarantine, auto-alt-text helpers, public image title/alt helpers, privacy-field guards
- Context artifacts: `.context/plans/README.md`, active `.context/plans/**`, recent `.context/reviews/**`, archived cycle-33 aggregate/review files, `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`

## Findings

### C33-DOC-01 - Schema comment still says description participates in public alt-text precedence

Severity: Low
Confidence: High
Consequence: source-comment/accessibility contract drift

Exact regions:

- `apps/web/src/db/schema.ts:82-86`
- `apps/web/src/lib/photo-title.ts:85-127`
- `apps/web/src/__tests__/alt-text-fallback.test.ts:1-90`
- `CLAUDE.md:561-563`
- `apps/web/README.md:83-85`

Mismatch:

The current user-facing docs now describe the implemented auto-alt-text behavior correctly: generated suggestions are stored as `alt_text_suggested`, existing rows are not rewritten, and operators may copy suggestions into empty title/description fields. The current helper and tests define the actual public `<img alt>` fallback as `title > tag-derived > alt_text_suggested > generic fallback`.

`schema.ts` still documents `alt_text_suggested` as "used as `<img alt>` fallback when `image.title` is empty" and says "Admin-set alt (title/description) always takes precedence." That is not the implemented contract: `getConcisePhotoAltText()` does not accept or inspect `description`, and there is no distinct admin-set alt-text column.

Concrete failure scenario:

A future developer reads the schema comment while changing image metadata or accessibility behavior and assumes `description` already overrides generated alt text. They may skip adding a description path to `getConcisePhotoAltText()` or write tests against the wrong precedence. Public gallery/lightbox alt text would continue to ignore `description` even though the schema comment implies otherwise.

Suggested fix:

Update the schema comment to match the implemented contract, e.g. "Used as public `<img alt>` fallback when no meaningful title or tags exist. GalleryKit has no separate public alt-text column; title/tags take precedence, while description is visible metadata and is not part of this helper's fallback chain." If description should intentionally become alt text, change `getConcisePhotoAltText()` and its tests instead.

### C33-DOC-02 - `.context/plans/README.md` remains a stale and partially broken plan index

Severity: Low
Confidence: High
Consequence: agent navigation/planning drift

Exact regions:

- `.context/plans/README.md:3-29`
- `.context/plans/README.md:51-80`
- Existing current files: `.context/plans/cycle-30-2026-06-30-plan.md`, `.context/plans/cycle-30-2026-06-30-deferred.md`, `.context/plans/cycle-31-2026-06-30-plan.md`, `.context/plans/cycle-32-2026-06-30-plan.md`, `.context/plans/cycle-32-2026-06-30-deferred.md`
- Missing linked paths verified absent: `.context/plan/plan-377-cycle19-deferred.md`, `.context/plan/plan-375-cycle18-deferred.md`, `.context/plan/plan-376-cycle19-fixes.md`, `.context/plan/plan-374-cycle18-fixes.md`

Mismatch:

The plans index still lists cycle 32 deferred work as active and cycles 30-32 implementation/deferred files as if some were archived or "push/deploy pending", while the files are present directly under `.context/plans/`. It also links cycle 18/19 items through `../../plan/...` from inside `.context/plans/README.md`; those resolve outside the actual `.context/plan` directory and the cited target files are absent in this checkout.

Concrete failure scenario:

An agent uses `.context/plans/README.md` as the entry point for current planning state, follows a broken cycle 18/19 link, or treats completed/present cycle 30-32 files as archived/pending in the wrong location. That can lead to redundant triage or missed current deferred work.

Suggested fix:

Refresh the index against actual files, correct/remove the broken cycle 18/19 links, and either keep the index generated or mark it explicitly as non-authoritative if it is not maintained every cycle. This was also reported in cycle 32 and remains present.

## Confirmed Matches / Non-Findings

- Root/app package scripts match the documented gates: root scripts forward to `apps/web`, and app scripts define lint, typecheck, build, Vitest, Playwright, and the three custom lint gates.
- Version docs match package metadata: Node `>=24`, Next `^16.2.9`, React `^19.2.5`, TypeScript `^6`, MySQL 8.0+ docs, and current dependency stack.
- Deploy docs match sources: root `npm run deploy` uses `scripts/deploy-remote.sh`; deploy env fallback and permission checks are implemented; host deploy runs `apps/web/deploy.sh`.
- Docker disk-hygiene docs match `apps/web/deploy.sh`: prune runs after health, uses bind-mounted mutable stores, and automatic `docker volume prune` omits `-a`.
- Compose/deploy topology docs match `apps/web/docker-compose.yml`: host networking, `HOSTNAME=127.0.0.1`, `TRUST_PROXY=true`, and bind mounts for `data`, `public/uploads`, `public/resources`, and read-only `site-config.json`.
- Nginx body-cap docs match `apps/web/nginx/default.conf`: 2 MiB default/admin API, 64 KiB login, 250 MiB DB restore, 216 MiB dashboard upload, and 216 MiB `/api/admin/lr/upload`.
- Semantic search docs match current source on disabled default, production env gate, offline CLIP weight loading, `jina-clip-v2-d512-q8`, model-version filtering, `SEMANTIC_SCAN_LIMIT`, `SEMANTIC_TOP_K_MAX`, same-origin checks, and process-local semantic limiter.
- CLIP spec/plan files correctly mark themselves as historical records and point readers to `CLAUDE.md`, `apps/web/README.md`, and runtime/DB checks for current state.
- LR upload docs match the current API route: `file`, `topic`, optional `title`, optional `description`; submitted tags/camera/lens/date/exposure overrides are not consumed.
- Storage docs match current source: `@/lib/storage` remains an internal local-only abstraction and is not exposed as a supported S3/MinIO feature.
- Paid downloads/Stripe removal docs match current source; remaining references are historical migration/archive context or removal guards.
- Cycle-32 auto-alt-text runbook mismatch in `CLAUDE.md` has been corrected; the remaining drift is only the schema comment called out above.

## Final Sweep

Final sweep covered README/CLAUDE/AGENTS, package metadata, env examples, Docker/Compose/nginx/deploy scripts, migration journal and schema/reconcile guidance, privacy/public field docs, CLIP/semantic-search specs and runbooks, LR upload wording, unsupported storage, removed payment/reaction surfaces, HDR/WI-09 placeholders, auto-alt-text comments, `.context/plans`, and current cycle/recent archived review artifacts.

This was a static documentation lane. I did not run lint/typecheck/build/test because no product behavior was changed. I wrote only `.context/reviews/document-specialist.md`.
