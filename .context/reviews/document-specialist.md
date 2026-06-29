# Document-Specialist Review - Review-Plan-Fix Cycle 7

**Date:** 2026-06-29
**HEAD reviewed:** `17124135999a3d7cb4f5262e8b2b5917503088ae`
**Role:** documentation/code consistency reviewer.
**Boundary:** Reviewed current `HEAD` only. This artifact is the only intended write for this lane. Existing unrelated modified review files from other lanes were not touched.

## Inventory Coverage

Read `AGENTS.md` and `CLAUDE.md` first, then built the review inventory from tracked docs, config, source, and contract tests.

- Governing docs: `AGENTS.md`, `CLAUDE.md`, root `README.md`, `apps/web/README.md`.
- Context docs/plans/reviews: `.context/plans/README.md`, active/deferred `.context/plans/*.md`, top-level `.context/reviews/*.md`, and targeted archive/done plans only where current docs referenced their contracts.
- Deploy/runbook/env surfaces: `.env.deploy.example`, `apps/web/.env.local.example`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, `apps/web/scripts/ensure-site-config.mjs`, package manifests, and lockfile headers.
- Schema/migration/security contract surfaces: `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`, auth/origin/rate-limit scanners, privacy guards, and migration/source-contract tests.
- Feature docs and contract-bearing comments: CLIP semantic search docs/scripts/routes, Lightroom token docs/actions/page, storage quarantine, service worker docs/template/generated file, backup/restore code, upload/original path code, site-config/SEO code, and comments containing operational `MUST`/`not wired`/`not implemented` contracts.

## Findings

### DOC-C7-01 - Lightroom token docs point admins to Settings, but the live token page is separate and not discoverable in admin nav

**Status:** Confirmed issue
**Severity:** Medium
**Confidence:** High
**Classification:** confirmed documentation/code mismatch with admin UX impact

**Mismatched regions:**

- `CLAUDE.md:152` says Lightroom tokens "can be rotated or revoked from the admin Settings panel."
- The actual token UI is a dedicated page at `apps/web/src/app/[locale]/admin/(protected)/tokens/page.tsx:11-24`, rendering `TokensClient`.
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:45-83` implements create/revoke behavior there, not in Settings.
- The admin nav currently lists dashboard/categories/tags/SEO/settings/password/users/db/analytics at `apps/web/src/components/admin-nav.tsx:15-25`; it has no `/admin/tokens` entry, and `apps/web/messages/en.json:2-14` has no `nav.tokens` label.

**Why this is a problem:** The authoritative docs send operators to Settings, but the current Settings page does not own token management. The real page exists but is not linked from the admin navigation, so an admin following the docs has no obvious way to find the credential-management surface.

**Concrete failure scenario:** An operator needs to revoke a compromised Lightroom Classic token. They open Admin -> Settings as documented, find only gallery/color/privacy/slideshow/semantic controls, and miss the unlinked `/admin/tokens` page. The compromised token remains usable until someone knows or guesses the direct URL.

**Suggested fix:** Update `CLAUDE.md` to name the dedicated Tokens page and add a visible `/admin/tokens` entry with localized `nav.tokens` labels, or intentionally relocate token management into Settings. If the page remains separate, document "Admin -> Tokens" instead of "Settings panel."

### DOC-C7-02 - Semantic-search route header still describes the old stub-only/random behavior

**Status:** Confirmed issue
**Severity:** Low
**Confidence:** High
**Classification:** confirmed source-comment/code mismatch

**Mismatched regions:**

- `apps/web/src/app/api/search/semantic/route.ts:8-10` says the endpoint embeds queries via the stub CLIP text encoder and returns scores above `COSINE_THRESHOLD` (`0.18`).
- `apps/web/src/app/api/search/semantic/route.ts:19-20` describes stub output as "random output."
- Current implementation branches to the real CLIP encoder in production at `apps/web/src/app/api/search/semantic/route.ts:232-235` and scans only the active model version at `apps/web/src/app/api/search/semantic/route.ts:242-251`.
- The stub implementation is deterministic, not random: `apps/web/src/lib/clip-inference.ts:6-13` and `apps/web/src/lib/clip-inference.ts:63-72` state and implement deterministic hash-based embeddings. User-facing docs agree at `apps/web/README.md:57-60` and `apps/web/messages/en.json:717-719`.

**Why this is a problem:** The route header is a contract-style comment at the top of a public API implementation. Future maintainers can incorrectly reason that production search is not active on this route, or that stub tests are nondeterministic, despite the code and public docs saying the opposite.

**Concrete failure scenario:** A maintainer debugging production search reads the header, assumes only the stub path can run, and changes threshold/model-version logic around `COSINE_THRESHOLD` instead of the production `PRODUCTION_COSINE_THRESHOLD` path. That can produce a bad fix or an incomplete test.

**Suggested fix:** Rewrite the header summary to match the lower "Serving gate" section: stub mode uses deterministic non-semantic embeddings and `COSINE_THRESHOLD`; production mode uses `embedTextReal`, `PRODUCTION_MODEL_VERSION`, and `PRODUCTION_COSINE_THRESHOLD`.

## Likely Issues

None found.

## Risks Needing Manual Validation

None found.

## Verified Non-Findings

- The prior document-specialist finding about `data/originals` is fixed: current `CLAUDE.md:209` names `data/uploads/original`, matching `apps/web/src/lib/upload-paths.ts`, `apps/web/Dockerfile`, and restore/backfill docs.
- Deploy docs match implementation: root `.env.deploy` is supported by `scripts/deploy-remote.sh`, the external default env path remains supported, remote deploy uses `apps/web/deploy.sh`, compose bind-mounts `./data`, `./public/uploads`, `./public/resources`, and `./src/site-config.json`, and auto-prune runs only after `docker compose ... up -d --build`.
- Migration docs match current guardrails: new migrations must advance `_journal.json` `when`, `migrate.js` baselines by committed hashes, and reconcile/post-condition tests cover the current schema.
- Site-config and SEO docs match code: `seo_og_image_url` exists in admin actions/UI/messages and is consumed by public metadata/OG routes; static links/analytics still come from `site-config.json`.
- Storage docs match quarantine: `@/lib/storage` remains local-only and is not wired into upload/processing/serving paths; `storage-quarantine.test.ts` pins that contract.
- CLIP setup docs match current activation path: production mode is env-gated, weights load offline from `CLIP_MODELS_ROOT`, model rows are segregated by `model_version`, and the admin UI intentionally offers only Disabled/Stub.
- Version claims match manifests: Node `>=24`, Next `^16.2.9`, React `^19.2.5`, and TypeScript `^6` align with README/CLAUDE badges and tech-stack text.

## Final Missed-Issues Sweep

Final targeted sweeps covered stale route names, deploy helper defaults, Docker bind mounts, nginx body caps, CLIP/stub/production wording, Settings-vs-SEO-vs-Tokens admin surfaces, storage/S3 wording, site-config keys, backup/restore file scopes, service-worker docs, migration journal guidance, paid-download removal, and source comments containing `MUST`, `not implemented`, `not wired`, `random`, or `Settings panel`.

Intentionally not inspected line-by-line: binary/image assets, generated screenshots, full historical `.context/reviews/archive/` contents, and old archived implementation plans not referenced by current authoritative docs. They were inventoried and searched where current docs/contracts pointed at them.

## Validation

- `git diff --check -- .context/reviews/document-specialist.md` — passed.
- No application tests were run in this lane; this was a review-only documentation/source-contract pass.

**Disposition:** 2 confirmed findings, 0 likely findings, 0 manual-validation-only risks. No application-code fixes, commits, pushes, or deploys performed by this lane.
