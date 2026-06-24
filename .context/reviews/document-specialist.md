# Document Specialist Review — review-plan-fix cycle 1 prompt 1

**Lane:** document-specialist
**Date:** 2026-06-22
**Scope:** Documentation/code mismatch review against in-repo authoritative docs, env examples, package scripts, deploy docs, migration scripts, and public feature claims.
**Write constraints:** Review artifact only. No source-code edits, commits, pushes, deploys, or destructive actions.

## Inventory first

Authoritative docs and high-level operator docs examined:

- `AGENTS.md:1-48` — workspace rules, deploy policy, schema runbook, quality gates, color/HDR convention.
- `CLAUDE.md:1-563` — architecture, env setup, migration runbook, storage note, semantic-search production activation, color/HDR pipeline, deployment checklist.
- `README.md:1-203` — public feature and setup/deploy claims.
- `apps/web/README.md:1-72` — app-local scripts, environment notes, CLIP going-live flow.

Runtime/config surfaces examined:

- `package.json:1-23` and `apps/web/package.json:1-86` — scripts and declared stack versions.
- `.env.deploy.example:1-14`, `scripts/deploy-remote.sh:1-71`, `.gitignore:1-24`.
- `apps/web/.env.local.example:1-63`.
- `apps/web/docker-compose.yml:1-26`, `apps/web/Dockerfile:1-124`, `apps/web/deploy.sh:1-60`.
- `apps/web/scripts/ensure-site-config.mjs:1-43`.
- `apps/web/next.config.ts:1-109`, `apps/web/src/proxy.ts:1-140`, `apps/web/src/instrumentation.ts:1-36`.

Migration/schema surfaces examined:

- `apps/web/drizzle/meta/_journal.json:1-174`.
- `apps/web/drizzle/*.sql`, including the intentionally orphaned `apps/web/drizzle/0014_drop_reactions.sql:1-6`.
- `apps/web/scripts/migrate.js:1-790`, `apps/web/scripts/init-db.ts:1-35`.
- `apps/web/src/db/schema.ts:1-302`.
- `apps/web/src/__tests__/migration-journal.test.ts:1-113`, `apps/web/src/__tests__/migration-journal-monotonicity.test.ts:1-120`.

Feature-claim/runtime surfaces examined:

- Semantic search: `apps/web/src/lib/gallery-config-shared.ts:25-191`, `apps/web/src/lib/gallery-config.ts:103-210`, `apps/web/src/lib/clip-paths.ts:1-98`, `apps/web/src/lib/clip-model.ts:1-200`, `apps/web/src/lib/clip-inference.ts:1-73`, `apps/web/scripts/download-clip-models.ts:1-148`, `apps/web/scripts/backfill-clip-embeddings.ts:1-198`, `apps/web/src/lib/image-queue.ts:432-498`, `apps/web/src/app/api/search/semantic/route.ts:1-260`, `apps/web/src/app/api/search/similar/[id]/route.ts:1-241`, `apps/web/src/components/search.tsx:123-460`, `apps/web/src/components/similar-photos.tsx:1-180`, `apps/web/messages/en.json:712-722`, `apps/web/messages/ko.json:716-722`.
- Color/HDR/storage/privacy: `apps/web/src/lib/data.ts:204-448`, `apps/web/src/__tests__/privacy-fields.test.ts:1-122`, `apps/web/src/components/color-details-section.tsx:1-564`, `apps/web/src/components/lightbox-color-pip.tsx`, `apps/web/src/lib/settings-hash.ts:1-177`, `apps/web/src/lib/upload-paths.ts:1-103`, `apps/web/src/lib/storage/index.ts`, `apps/web/src/lib/storage/local.ts`, `apps/web/src/lib/storage/types.ts`.

## Findings

### 1. Confirmed issue — documented CLIP production backfill command is a no-op before activation

**Severity:** Medium
**Confidence:** High
**Type:** Confirmed documentation/code mismatch

**Evidence:**

- `CLAUDE.md:472-485` tells operators to run the production embedding backfill after seeding, using:
  `scripts/backfill-clip-embeddings.ts --production`.
- `CLAUDE.md:487-493` then says to set `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` and set `admin_settings.semantic_search_mode='production'` after that backfill.
- `apps/web/README.md:63-70` repeats the same order: seed weights, run `scripts/backfill-clip-embeddings.ts --production`, then set the env opt-in and DB row.
- But `apps/web/scripts/backfill-clip-embeddings.ts:51-57` documents `--force` as the flag for pre-population before flipping the setting.
- The implementation enforces that gate at `apps/web/scripts/backfill-clip-embeddings.ts:90-95`: without `--force`, it checks `semantic_search_mode`; if the row is unset or `disabled`, it logs the disabled message and exits `0`.

**Why this is a problem:**

The documented operator sequence says to backfill before enabling production mode, but the command shown does not use `--force`. On a fresh install or a normal default deploy, `semantic_search_mode` is unset/disabled, so the command completes successfully without generating any `PRODUCTION_MODEL_VERSION` embeddings. The next documented steps turn production on, but the production routes can only serve rows matching the production model version.

**Concrete failure scenario:**

An operator follows `CLAUDE.md` exactly:

1. Seeds CLIP weights.
2. Runs the documented `npx --yes tsx@4.21.0 scripts/backfill-clip-embeddings.ts --production`.
3. Sees exit code `0` and continues.
4. Sets `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` and `admin_settings.semantic_search_mode='production'`.

Existing photos still have no production embeddings. The public natural-language route is now in production mode but scans `image_embeddings.model_version = PRODUCTION_MODEL_VERSION` only; existing-photo search/similar-photo results are empty or unavailable until a correct backfill is run.

**Suggested fix:**

Update both documented pre-activation backfill commands to include `--force`:

```bash
npx --yes tsx@4.21.0 scripts/backfill-clip-embeddings.ts --production --force
```

Alternatively, change the documented order so the DB row is set before the backfill. The `--force` documentation is safer because it preserves the current operator intent: pre-populate embeddings before exposing the feature.

### 2. Likely issue — `.env.local.example` omits the semantic-search production knobs that the docs tell operators to add to `.env.local`

**Severity:** Low
**Confidence:** Medium
**Type:** Likely documentation/env-example mismatch

**Evidence:**

- `CLAUDE.md:487-493` says production activation requires `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` in `.env.local`.
- `CLAUDE.md:451-452` and `apps/web/README.md:59` describe `CLIP_MODELS_ROOT` as the runtime model-weight location.
- `apps/web/src/lib/gallery-config.ts:126-145` confirms a stored `production` mode heals to `disabled` unless `process.env.SEMANTIC_SEARCH_ALLOW_PRODUCTION === 'true'`.
- `apps/web/src/lib/clip-paths.ts:48-66` confirms `CLIP_MODELS_ROOT` is an actual runtime resolver input, with default `data/models/clip`.
- `apps/web/.env.local.example:1-63` has no semantic-search section and does not mention either `SEMANTIC_SEARCH_ALLOW_PRODUCTION` or `CLIP_MODELS_ROOT`.

**Why this is a problem:**

The production feature is deliberately operator-gated and not available in the admin UI. That means `.env.local.example` is one of the few discoverable operator surfaces for the required switch. Today an operator must read the long CLIP section in `CLAUDE.md` or infer the env var from code. The omission is especially easy to miss because the same example already documents many optional knobs such as `HEALTH_CHECK_DB`, `TRUST_PROXY`, upload caps, and image-processing limits.

**Concrete failure scenario:**

An operator copies `apps/web/.env.local.example`, seeds weights, writes `semantic_search_mode='production'` in the DB, and restarts. Because the example never surfaces the env opt-in, they miss `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`; the resolver silently treats the stored production value as disabled. The UI/admin setting still cannot select production, so the failure looks like a runtime/config mystery rather than an omitted env line.

`CLIP_MODELS_ROOT` is less severe in the shipped Docker path because `apps/web/Dockerfile:86-90` sets `/app/data/models/clip`, and the documented sidecar commands pass `-e CLIP_MODELS_ROOT=/app/data/models/clip`. It is still useful to document in the env example because non-Docker or customized sidecar paths depend on the downloader and runtime sharing the same root.

**Suggested fix:**

Add a commented semantic-search section to `apps/web/.env.local.example`, for example:

```env
# Semantic Search (operator-only production mode)
# SEMANTIC_SEARCH_ALLOW_PRODUCTION=true
# CLIP_MODELS_ROOT=/app/data/models/clip
```

Keep the comments explicit that production mode also requires seeded weights, `--production --force` backfill for existing photos, and the DB row.

## Non-findings

- Deploy docs are consistent with scripts: `AGENTS.md:17-19`, `README.md:106-116`, `.env.deploy.example:6-14`, and `scripts/deploy-remote.sh:22-71` all describe a derived SSH deploy path; the script supports both root `.env.deploy` and the default external secrets file. The example header could be clearer, but the implementation covers both paths.
- Docker disk-prune docs match `apps/web/deploy.sh:51-56`: container prune, image `-af`, builder `-af`, and volume prune without `-a`, after `docker compose up -d --build`.
- Migration docs match current guardrails: `AGENTS.md:24-27`, `CLAUDE.md` migration runbook text, `apps/web/scripts/migrate.js:144-160`, `apps/web/scripts/migrate.js:658-735`, and migration-journal tests all encode per-entry hash baselining and loud failure on missing journal hashes. The unjournaled `0014_drop_reactions.sql` is intentional per `apps/web/src/__tests__/migration-journal.test.ts:29-32`.
- Color/HDR privacy claims match code: admin-only fields in `CLAUDE.md:125-139` are omitted from public selects at `apps/web/src/lib/data.ts:323-355`, guarded by `PrivacySensitiveKeys` at `apps/web/src/lib/data.ts:405-418`, and pinned by `apps/web/src/__tests__/privacy-fields.test.ts:6-90`. Public HDR badge honesty is explicitly gated in `apps/web/src/components/color-details-section.tsx:513-525`.
- Storage support claims match code: `CLAUDE.md:111` says only local filesystem storage is supported; `apps/web/src/lib/storage/index.ts` and `apps/web/src/lib/storage/types.ts` also state the abstraction is experimental/not wired into the live pipeline, and live upload paths use `apps/web/src/lib/upload-paths.ts`.
- Public package/stack claims are internally consistent: README badges and `CLAUDE.md:11` say Next 16 / React 19 / TypeScript 6, matching `apps/web/package.json:56-61` and `apps/web/package.json:83`.

## Missed-issues sweep

Final sweep commands and checks included:

- Repo-wide targeted search for `semantic`, `CLIP`, `HDR`, `color`, `storage`, `S3`, `MinIO`, `deploy`, `migrat`, `env`, `SESSION_SECRET`, `ADMIN_PASSWORD`, framework versions, Docker prune, and root-admin claims across docs and `apps/web`.
- `process.env` inventory across `apps/web/src`, `apps/web/scripts`, and app config files, compared against `.env.local.example` and docs.
- Migration SQL vs journal cross-check: every journal tag has a file; the only file without a journal entry is the documented `0014_drop_reactions`.
- Color/HDR public/admin projection comparison against `data.ts`, `image-types.ts`, color UI components, and privacy tests.

Residual risks:

- The claim that the public demo currently has production CLIP enabled and approximately 445 real embeddings is in `CLAUDE.md:121` but depends on production DB/env state outside this repository. I could verify the code path and documented activation procedure, not the live DB row or embedding count.
- I did not run the full quality gates because this was a read-only mismatch review plus review-artifact write, not a source-change verification pass.
