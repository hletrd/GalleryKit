# Document Specialist Review - Cycle 20

Date: 2026-06-30 KST
HEAD reviewed: `24c82c71c0f8efb457b37498a29d9f3ecc8a7fbd`
Scope: documentation, operations policy, schema/migration docs, deployment docs, comments, tests-as-docs, and i18n user-facing copy. Implementation files were not edited. No commit or push was performed per user instruction.

Worktree note: multiple `.context/reviews/*.md` files were already modified before this pass. This report only updates `.context/reviews/document-specialist.md`.

## Documentation Inventory

- Primary project guidance:
  - `AGENTS.md` - short-form contributor/agent rules, deploy policy, schema checklist, quality gates.
  - `CLAUDE.md` - detailed architecture, security model, color/HDR pipeline, CLIP operations, migration runbook, deploy helper, lint gates.
  - `README.md` and `apps/web/README.md` - user/operator setup, deployment, environment, semantic-search activation.
- `.context`:
  - `.context/plans/README.md` - plan index and status catalog.
  - `.context/plans/**` - active, done, and archived implementation plans.
  - `.context/reviews/**` - current and historical role reviews, aggregate reports, photographer-perspective audits, screenshots/log artifacts.
- `docs/`:
  - `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md` - shipped CLIP design/status record.
  - `docs/superpowers/plans/2026-06-15-clip-semantic-search.md` - historical complete implementation plan.
- Operational/deployment docs in code:
  - `.env.deploy.example`, `apps/web/.env.local.example`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`.
- Schema/migration docs:
  - `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`.
- Authoritative comments and doc-like tests:
  - Security scanners in `apps/web/scripts/check-*.ts`.
  - Privacy field guards in `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, and `apps/web/src/__tests__/privacy-fields.test.ts`.
  - CLIP path/cache, downloader, backfill, route, and env-limit tests.
  - Touch-target audit policy in `apps/web/src/__tests__/touch-target-audit.test.ts`.

## Confirmed Issues

### C20-DOC-01 - `SEMANTIC_TOP_K_MAX` default is stale in env reference docs

- Severity: LOW
- Confidence: High
- Status: Open
- Region: `CLAUDE.md:115-116`, `CLAUDE.md:545-548`, `apps/web/.env.local.example:78-79`, `apps/web/src/lib/clip-embeddings.ts:22-44`, `apps/web/src/__tests__/clip-semantic-limits-env.test.ts:33-40`
- Mismatch:
  - `CLAUDE.md` optional env table says `SEMANTIC_TOP_K_MAX` default is `24`: `CLAUDE.md:115-116`.
  - `.env.local.example` shows `SEMANTIC_TOP_K_MAX=24`: `apps/web/.env.local.example:78-79`.
  - The runtime section says default `50`: `CLAUDE.md:545-548`.
  - Code and tests confirm fallback `50`: `apps/web/src/lib/clip-embeddings.ts:43`, `apps/web/src/__tests__/clip-semantic-limits-env.test.ts:33-40`.
- User/operator failure scenario: Operators copy the example expecting a 24-result cap, while the default production route permits 50. Future agents may "fix" the wrong side because both values appear authoritative.
- Suggested fix: Update the optional-env table and `.env.local.example` to `50`, or intentionally lower the code/test default to `24`.

### C20-DOC-02 - CLIP activation docs omit the per-run backfill cap and repeat-until-done stop condition

- Severity: MEDIUM
- Confidence: High
- Status: Open
- Region: `apps/web/README.md:68-77`, `CLAUDE.md:520-535`, `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:43-47`, `apps/web/scripts/backfill-clip-embeddings.ts:116-120`
- Mismatch:
  - `apps/web/README.md` instructs operators to backfill existing photos, then set env and DB mode: `apps/web/README.md:68-77`.
  - `CLAUDE.md` says the forced production backfill generates embeddings "for all existing photos": `CLAUDE.md:520-535`.
  - The CLIP spec says backfill re-embeds every row whose model version differs: `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:43-47`.
  - The script stops at `SEMANTIC_SCAN_LIMIT` per run and logs "Stop here and re-run to continue": `apps/web/scripts/backfill-clip-embeddings.ts:116-120`.
- User/operator failure scenario: A large-gallery production activation follows the docs exactly once, then flips production mode with only the first capped batch embedded. Search behaves like it has poor recall, not like an obvious setup failure.
- Suggested fix: Add a runbook stop condition: rerun `scripts/backfill-clip-embeddings.ts --production --force` until it reports no selected rows / `processed=0 failed=0`, or add script support for a looped `--all` mode and document that.

## Likely Issues

### C20-DOC-03 - Code comments still say "Lightroom Classic publish plugin" where docs say server API only

- Severity: LOW
- Confidence: Medium
- Status: Open
- Region: `README.md:40`, `CLAUDE.md:158`, `CLAUDE.md:572`, `apps/web/src/db/schema.ts:192-197`, `apps/web/drizzle/0006_admin_tokens.sql:1-6`, `apps/web/nginx/default.conf:123-131`, `apps/web/messages/en.json:816`
- Mismatch:
  - Product docs say no Lightroom Classic plugin is bundled: `README.md:40`, `CLAUDE.md:158`.
  - User-facing token copy also says GalleryKit exposes the endpoint but does not bundle or distribute a Lightroom Classic plugin: `apps/web/messages/en.json:816`.
  - Schema/migration/nginx comments and one CLAUDE deployment note call the surface a publish-plugin route: `apps/web/src/db/schema.ts:192-197`, `apps/web/drizzle/0006_admin_tokens.sql:1-6`, `apps/web/nginx/default.conf:123-131`, `CLAUDE.md:572`.
- User/operator failure scenario: Future documentation or UI copy revives a plugin promise because authoritative code comments imply the route exists for a plugin rather than for a generic Lightroom-compatible API.
- Suggested fix: Normalize comments to "Lightroom-compatible publish API / external publish clients" and keep the body-size rationale.

### C20-DOC-04 - CLIP script-local sidecar example is stale relative to the main runbook

- Severity: LOW
- Confidence: Medium
- Status: Open
- Region: `apps/web/scripts/backfill-clip-embeddings.ts:9-21`, `CLAUDE.md:520-532`
- Mismatch:
  - The script comment uses `npx --yes tsx@4.21.0` and mounts both `/app/data` and a separate `/app/data/models/clip:ro`: `apps/web/scripts/backfill-clip-embeddings.ts:14-21`.
  - `CLAUDE.md` uses `tsx@4.22.4` and only mounts `/app/data`, with `CLIP_MODELS_ROOT=/app/data/models/clip`: `CLAUDE.md:520-532`.
- User/operator failure scenario: An operator follows the script-local comment instead of `CLAUDE.md`, tests a different tsx version than the locked runbook, or accidentally makes the model cache read-only in a maintenance flow that needs to verify or refresh files.
- Suggested fix: Make the script comment refer to `CLAUDE.md` for the authoritative sidecar command, or update it to the same version/mount set.

## Risks Needing Validation

### C20-DOC-R01 - Plan index status may need curation before it is used as an execution source

- Severity: LOW
- Confidence: Medium
- Status: Needs validation
- Region: `.context/plans/README.md:3-40`, `.context/plans/README.md:41-57`
- Mismatch:
  - The plan index has a large active/deferred section: `.context/plans/README.md:3-40`.
  - Completed cycles immediately follow: `.context/plans/README.md:41-57`.
  - Several entries are old deferred review coverage items with no per-entry superseded/closed-by marker visible in the index itself.
- User/operator failure scenario: A future agent uses the index as a current backlog and reopens superseded deferred findings without checking the latest aggregate/review context.
- Suggested validation: Add status tags such as `active`, `superseded`, `closed-by`, or `needs-revalidation` for older deferred items that are no longer actionable as written.

## No-Finding Areas

- Deployment prune docs matched `apps/web/deploy.sh`: prune runs after `docker compose up -d --build`, uses bind mounts for mutable data, and uses `docker volume prune -f` without `-a`.
- Schema docs matched the reviewed migration/reconcile contract: every `_journal.json` tag has a SQL file, and the known non-monotonic `when` history is documented in `migrate.js`.
- Storage-backend policy was consistent at reviewed points: docs warn local filesystem only; S3/MinIO is not exposed as a supported admin feature.
- Paid-download removal was consistently documented in `CLAUDE.md`, migration comments, and reconcile drop logic.
- Privacy docs and compile-time/test guards were present for public/admin field separation.
- i18n user-facing copy had key parity coverage in `apps/web/src/__tests__/i18n-key-parity.test.ts`, and the reviewed Lightroom-token copy matched the no-bundled-plugin product stance.
- Prior cycle SEO OG-image URL comment mismatch was rechecked and not carried forward: `apps/web/src/lib/seo-og-url.ts:9-23` now rejects the documented backslash bypass, with coverage in `apps/web/src/__tests__/seo-actions.test.ts`.

## Missed-Issues Sweep

- Ran repository-wide searches for documentation-policy terms and stale feature names: `SEMANTIC_TOP_K_MAX`, `SEMANTIC_SCAN_LIMIT`, `CLIP_MODELS_ROOT`, `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, `S3`, `MinIO`, `Stripe`, `paid`, `entitlements`, `license_tier`, `Lightroom`, `plugin`, `publicSelectFields`, `PrivacySensitive`, `reconcileLegacySchema`, `docker volume prune`, `TRUST_PROXY`, upload/body-limit terms, smart-collection route terms, and lint exemption tags.
- Inventoried `.context`, `docs/`, README files, env examples, deploy scripts/config, migration/schema files, comments, tests-as-docs, and message files before writing findings. Generated/binary artifacts were not line-cited.
- No relevant documentation areas from the requested scope were intentionally skipped. I did not run the full test suite because this was a review-only documentation pass with no implementation changes.

## Totals

- Confirmed: 2
- Likely: 2
- Needs validation: 1
- Highest severity: MEDIUM
