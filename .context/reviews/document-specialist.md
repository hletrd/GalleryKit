# Document Specialist Review - Cycle 23

Date: 2026-06-30 KST
HEAD reviewed: `45208b2181add5db64395e4dac30134cfd1fcf35`
Scope: documentation/code contract drift across authoritative repo docs, active docs, doc-referenced implementation files, package/deploy/env/schema/test surfaces, and relevant current `.context` review/plan state. Review-only pass; intended source change is this report file only.

## Inventory

- Required first reads: `AGENTS.md`, `CLAUDE.md`.
- Primary docs line-reviewed: `README.md`, `apps/web/README.md`, `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`, `.context/plans/README.md`, current top-level `.context/reviews/*.md` where relevant.
- Full document inventory: 4,048 Markdown/MDX files found outside `node_modules`, `.git`, and `.next`; 2,339 `.context` files inventoried. Historical archive files were treated as provenance unless current top-level docs/reviews still reference them as active carry-forward.
- Implementation/deploy/env/schema/test surfaces checked: root/app `package.json`, `.env.deploy.example`, `apps/web/.env.local.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/scripts/*`, `apps/web/drizzle/**`, `apps/web/src/db/schema.ts`, CLIP/search/backfill code, advisory locks/restore code, PAT upload code, lint scanners, and relevant tests.
- Automated sweeps: Markdown path-reference sweep, current-doc keyword sweeps for deploy/env/migration/CLIP/Lightroom/storage/Stripe, migration journal monotonicity/file count check, package-script comparison, and final missed-issues grep.
- External reference used only for DOC23-06: current Next.js Route Handlers docs, last updated March 3, 2026, which document the convention as `route.js|ts` inside `app/`: https://nextjs.org/docs/app/getting-started/route-handlers

## Findings

### DOC23-01 - CLIP backfill script header can mask the real model-weight volume

- Severity: Medium
- Confidence: High
- Status: confirmed
- Region: `apps/web/scripts/backfill-clip-embeddings.ts:14-21`, `CLAUDE.md:498-533`, `apps/web/docker-compose.yml:24-28`, `apps/web/Dockerfile:93-97`, `apps/web/src/lib/clip-paths.ts:48-65`
- Documentation claim: the script header's sidecar example mounts both `.../apps/web/data:/app/data` and `.../data/models/clip:/app/data/models/clip:ro`.
- Authoritative behavior: production persistence is `apps/web/data` mounted to `/app/data`, with `CLIP_MODELS_ROOT=/app/data/models/clip`. `CLAUDE.md`'s seed/backfill commands mount only `<deploy-root>/apps/web/data:/app/data` and set the absolute CLIP root.
- Failure scenario: an operator copies the script-header command. Docker creates or uses `<deploy-root>/data/models/clip` instead of `<deploy-root>/apps/web/data/models/clip`, then the nested mount hides the seeded weights under `/app/data/models/clip`. The production backfill sees no offline model artifacts and fails or returns 503-like model-load errors despite the correct `apps/web/data` mount being present.
- Concrete fix: make the script-header command match `CLAUDE.md`: remove the extra nested model mount, or change it to the exact persisted path `<deploy-root>/apps/web/data/models/clip:/app/data/models/clip:ro` and keep `-e CLIP_MODELS_ROOT=/app/data/models/clip` explicit.

### DOC23-02 - `CLAUDE.md` advisory-lock inventory omits the semantic embedding backfill lock

- Severity: Low
- Confidence: High
- Status: confirmed
- Region: `CLAUDE.md:399-403`, `apps/web/src/lib/advisory-locks.ts:43-47`, `apps/web/scripts/backfill-clip-embeddings.ts:99-110`, `apps/web/src/app/[locale]/admin/db-actions.ts:427-445`
- Documentation claim: the advisory-lock scope note lists `gallerykit_db_restore`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete`, `gallerykit_color_pipeline_backfill`, and `gallerykit:image-processing:{jobId}`.
- Authoritative behavior: code also defines and uses `gallerykit_semantic_embedding_backfill`. The DB restore path acquires it before restore, and the CLIP backfill script/action acquire it before embedding work.
- Failure scenario: a future multi-tenant/co-located deployment review follows the `CLAUDE.md` inventory and prefixes only the listed locks. Semantic embedding backfills remain globally serialized across tenants on the same MySQL server, or restore/backfill collision analysis misses one lock.
- Concrete fix: add `gallerykit_semantic_embedding_backfill` to the `CLAUDE.md` lock-name list and change "backfill runs" to "color-pipeline and semantic embedding backfill runs" so the scope warning is complete.

### DOC23-03 - `CLAUDE.md` hardcodes the deploy host despite config-driven deploy rules

- Severity: Low
- Confidence: High
- Status: confirmed
- Region: `CLAUDE.md:463-465`, `AGENTS.md:15-19`, `.env.deploy.example:6-14`, `scripts/deploy-remote.sh:22-52`, `README.md:118-128`
- Documentation claim: `CLAUDE.md` says `npm run deploy` "ssh-deploys to `gallery.atik.kr`".
- Authoritative behavior: `AGENTS.md` says deploy host and SSH credentials are config-driven via gitignored `.env.deploy` and must not be hardcoded in docs. `scripts/deploy-remote.sh` derives SSH target from `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KEY`, and `DEPLOY_PATH`.
- Failure scenario: a future deploy-doc edit or automation change treats `gallery.atik.kr` as the deploy contract and reintroduces a concrete hostname into a reusable command path, contradicting the gitignored deploy-env boundary.
- Concrete fix: reword `CLAUDE.md:465` to "ssh-deploys to the host configured in `.env.deploy`" and leave `gallery.atik.kr` only as demo/current-production context where explicitly labeled as such.

### DOC23-04 - Lower-level PAT upload comments still imply a bundled Lightroom plugin

- Severity: Low
- Confidence: Medium
- Status: likely
- Region: `README.md:45`, `README.md:203-214`, `apps/web/README.md:82-91`, `CLAUDE.md:159`, `apps/web/src/app/api/admin/lr/upload/route.ts:1-8`, `apps/web/src/app/api/admin/lr/upload/route.ts:60-64`, `apps/web/src/app/api/admin/lr/upload/route.ts:336-353`, `apps/web/src/app/api/admin/lr/upload/route.ts:518-523`, `apps/web/src/db/schema.ts:192-196`, `apps/web/src/lib/admin-tokens.ts:1-4`, `apps/web/src/lib/api-auth.ts:50-57`
- Documentation claim: public docs correctly say GalleryKit exposes a PAT-authenticated upload API for external clients and does not bundle a Lightroom Classic plugin.
- Code/comment drift: several implementation comments still say "Lightroom plugin" or "Lightroom publish-plugin path"; one route header is accurate, but adjacent comments and token/schema comments read like the plugin is a shipped artifact.
- Failure scenario: a contributor copies the lower-level comments into public docs or admin help text and promises a bundled Lightroom plugin, creating support expectations for an artifact this repo does not ship.
- Concrete fix: normalize implementation comments to "Lightroom-compatible publish API", "external Lightroom publish client", or "PAT upload route", while preserving the body-size, runtime, and audit-surface rationale.

### DOC23-05 - Current aggregate still carries a fixed env-example documentation finding

- Severity: Low
- Confidence: High
- Status: confirmed
- Region: `.context/reviews/_aggregate.md:392-400`, `apps/web/.env.local.example:37-43`, `CLAUDE.md:107-109`
- Documentation claim: the current top-level aggregate says `DOC22-02` (`.env.local.example` omits documented operator controls) should still be planned/deferred.
- Authoritative behavior: `.env.local.example` now includes `ADMIN_BACKFILL_CONCURRENCY`, `BACKFILL_CONCURRENCY`, and `VIEW_RETENTION_DAYS`, matching the controls listed in `CLAUDE.md`.
- Failure scenario: cycle planning treats a resolved documentation item as still open and spends review/fix capacity re-investigating an already-fixed env example while missing real current drift.
- Concrete fix: update the aggregate/carry-forward status to mark `DOC22-02` resolved, or move the cycle-22 aggregate into an archive path if it is no longer meant to represent current carry-forward.

### DOC23-06 - Route scanner comments overstate Next.js route-file extension support

- Severity: Low
- Confidence: Medium
- Status: manual-validation risk
- Region: `apps/web/scripts/check-api-auth.ts:19-30`, `apps/web/scripts/check-public-route-rate-limit.ts:28-34`, `apps/web/src/__tests__/check-api-auth.test.ts:7-12`, `apps/web/src/__tests__/check-api-auth.test.ts:123-156`
- Documentation claim: comments/tests say Next.js 16 App Router accepts `route.tsx`, `route.mjs`, and `route.cjs` identically.
- External reference: current Next.js Route Handlers docs document route handlers as `route.js|ts` files inside `app/`; they do not document `.mjs` or `.cjs` route-handler filenames.
- Failure scenario: a contributor adds an admin API `route.mjs` because the scanner comment says Next resolves it. The scanner may parse it, but without build/runtime evidence the file may not be deployed the way the security comment implies.
- Concrete fix: change the scanner comments to "defensively scan these extensions if present; repo standard is `route.ts`/`route.tsx`", or add a build-level fixture proving `.mjs`/`.cjs` are actually resolved before claiming identical support.

### DOC23-07 - Historical CLIP plan status link is broken from its own directory

- Severity: Low
- Confidence: High
- Status: confirmed
- Region: `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:13-17`, `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:1-4`
- Documentation claim: line 17 links to `[spec](2026-06-14-clip-semantic-search-design.md)`.
- Authoritative path: the spec exists at `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`; no same-directory `docs/superpowers/plans/2026-06-14-clip-semantic-search-design.md` exists.
- Failure scenario: a future agent follows the status-banner link from the completed implementation plan, gets a broken link, and either misses the current activation guidance or copies stale plan snippets instead.
- Concrete fix: change the link target to `../specs/2026-06-14-clip-semantic-search-design.md`. Consider also changing the plan's `./data/models/` architecture shorthand at line 9 to `./data/models/clip/` to match current CLIP docs/code.

### DOC23-08 - `feed-sized-derivative` test comment documents the old four-size default

- Severity: Low
- Confidence: High
- Status: confirmed
- Region: `apps/web/src/__tests__/feed-sized-derivative.test.ts:1-14`, `apps/web/src/lib/gallery-config-shared.ts:86-96`, `CLAUDE.md:262`
- Documentation claim: the test header says `DEFAULT_IMAGE_SIZES = [640, 1536, 2048, 4096]`.
- Authoritative behavior: current default size ladder is `[640, 1536, 2048, 4096, 5120, 7680]`, also documented in `CLAUDE.md`.
- Failure scenario: a maintainer debugging feed derivative behavior reads the source-contract test and assumes the largest default is 4096, then writes an incorrect regression fixture or operational note for base JPEG/OG/feed sizing.
- Concrete fix: update the comment to the six-value default, or avoid hardcoding the full array in the prose and describe the old bug as "the helper defaulted to the then-current `DEFAULT_IMAGE_SIZES` and picked `1536`."

## Verified Clean Areas

- Package scripts match the quality-gate docs: root delegates to `apps/web`; app scripts include lint, typecheck, build, test, e2e, and the three custom security scanners.
- Deploy/prune docs match `apps/web/deploy.sh`: remote deploy reads env-driven SSH config, runs `docker compose --env-file apps/web/.env.local`, starts before prune, and prunes containers/images/build cache/dangling volumes without `volume prune -a`.
- Env examples now include the documented retention/backfill/upload/proxy/health/CLIP controls that were missing in the prior cycle.
- Migration docs match the custom migrator posture: 28 SQL files and 28 journal entries exist; historical non-monotonic `when` entries remain documented and guarded by hash-based reconciliation/postconditions.
- Nginx body-cap docs match `apps/web/nginx/default.conf`: 2 MiB default/admin API, 64 KiB login, 250 MiB DB restore, 216 MiB dashboard uploads, and 216 MiB `/api/admin/lr/upload`.
- CLIP activation docs match runtime gates for `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, `CLIP_MODELS_ROOT`, production model version, `SEMANTIC_SCAN_LIMIT`, and `SEMANTIC_TOP_K_MAX`; the mismatch found is limited to the sidecar example in the script header and the broken historical plan link.
- Storage backend quarantine remains aligned: `CLAUDE.md` says local filesystem only, and source imports keep the storage abstraction out of the live upload/process/serve pipeline.
- Removed Stripe/payment surface remains absent from current README/CLAUDE/package dependencies/routes; Stripe mentions in archived `.context/reviews/archive/**` are historical provenance, not current product docs.

## Final Missed-Issues Sweep

- Re-ran focused greps for deploy host/compose commands, env controls, CLIP paths/model versions, advisory locks, Lightroom/plugin wording, route extension claims, Stripe/storage mentions, image size defaults, migration/journal state, and current `.context` carry-forward.
- Rechecked prior cycle-22 document-specialist findings: `.env.local.example` omission and stale compose command are fixed; hardcoded deploy host, Lightroom wording, historical CLIP-plan drift, and route-extension overstatement remain current in narrower form.
- No tests/build/lint gates were run because this was a review artifact update with no production source change. Static validation evidence is from file reads and repo-wide searches.
- Skipped files: no document class was intentionally skipped. I did not manually line-review every line of the 4,048 Markdown/MDX files or every historical `.context` archive; those were fully inventoried and swept with path/keyword scans, while current authoritative docs and relevant implementation-linked files were line-reviewed.

## Totals

- Findings: 8
- Highest severity: Medium
