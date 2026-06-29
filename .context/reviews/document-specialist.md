# Cycle 13 Document-Specialist Review

Date: 2026-06-29
Scope: whole repository documentation/code contract review for `/Users/hletrd/flash-shared/gallery`.
Reviewer lane: document-specialist.

## Process and Inventory

Required first reads were completed: `AGENTS.md` and `CLAUDE.md`.

Excluded from inventory/review sweeps: `node_modules/`, `.git/`, Next/build outputs, test output, runtime data/upload/resource directories such as `apps/web/data/`, `apps/web/public/uploads/`, and `apps/web/public/resources/`.

Authoritative documentation and contract files reviewed:

- Root docs and operations: `README.md`, `AGENTS.md`, `CLAUDE.md`, `.env.deploy.example`.
- App docs/examples: `apps/web/README.md`, `apps/web/.env.local.example`, `apps/web/src/site-config.example.json`.
- Historical/current planning docs: `.context/plans/*.md`, `.context/reviews/*.md`, `docs/superpowers/**/*.md`.
- Runtime/deploy contracts: root `package.json`, `apps/web/package.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`.
- Schema/migration contracts: `apps/web/drizzle/**/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`.
- Implementation contracts behind docs: auth/rate-limit lint scripts, upload limits, semantic search, CLIP model loading, Atom feed generation, SEO/base URL handling, image processing/color/HDR pipeline, storage abstraction, DB backup/restore, health/live routes, privacy selectors/tests, and relevant Vitest/Playwright tests.

Coverage evidence:

- Deploy docs were checked against root `package.json` deploy script, `scripts/deploy-remote.sh`, `.env.deploy.example`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, and Docker/nginx behavior.
- Environment docs were checked against `.env.local.example`, `constants.ts`, `ensure-site-config.mjs`, `next.config.ts`, upload-limit helpers, DB TLS helpers, and tests.
- Public/privacy docs were checked against `data.ts`, public Atom routes, `atom-feed.ts`, schema comments, and privacy tests.
- Semantic-search docs were checked against `clip-embeddings.ts`, `clip-model.ts`, search routes, CLIP docs, package metadata, package lock, Dockerfile, and tests.
- Migration/runbook docs were checked against migration SQL, journal metadata, migrator assertions, and migration journal tests.
- Final sweep included previous-cycle findings, stale line-number references, examples that can be copied into production, comments that state source-of-truth contracts, and docs that could cause deploy/operator mistakes.

## Confirmed Issues

### DOC13-01 - Stale upload attribution comments still claim public Atom per-entry author attribution

Severity: Low
Confidence: High

Evidence:

- Browser upload still documents `uploaded_by` as feeding per-entry Atom attribution and says public feed renders a JOIN-derived display name: `apps/web/src/app/actions/images.ts:435-439`.
- Lightroom upload still says LR-published images without `uploaded_by` make public Atom per-entry author attribution "dead" even though the PAT identifies the photographer: `apps/web/src/app/api/admin/lr/upload/route.ts:434-443`.
- Current public feed routes explicitly prevent admin username exposure and fall back to the feed-level author: `apps/web/src/app/feed.xml/route.ts:76-82`, `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:87-93`.
- `getImagesForFeed` deliberately emits `author_name: NULL` and documents that per-uploader attribution must wait for a safe public display-name column: `apps/web/src/lib/data.ts:833-845`.
- The schema and Atom helper now agree with the current privacy contract: `apps/web/src/db/schema.ts:87-92`, `apps/web/src/lib/atom-feed.ts:53-58`.

Failure scenario:

A future maintainer reads the ingest-path comments as authoritative and reintroduces an admin-user join or a raw username display to "fix" missing per-entry Atom authors. That would contradict the current privacy invariant and could expose admin login identifiers through unauthenticated feed endpoints.

Suggested fix:

Update both ingest comments to say `uploaded_by` is an admin/audit linkage only. State that public Atom currently uses the feed-level author and that per-entry attribution requires a separate safe public display-name field.

### DOC13-02 - `CLAUDE.md` overstates canonical URL matching requirements

Severity: Low
Confidence: High

Evidence:

- `CLAUDE.md` says per-photo OG internal derivative fetches are pinned to trusted `siteConfig.url`: `CLAUDE.md:215`.
- The setup section says `site-config.json.url` "must match `BASE_URL` env var": `CLAUDE.md:637`.
- Runtime code defines the canonical base URL as `process.env.BASE_URL || siteConfig.url`: `apps/web/src/lib/constants.ts:21-24`.
- The production validator checks the effective URL from `BASE_URL || siteConfig.url` and explicitly tells operators to "Set BASE_URL or customize src/site-config.json": `apps/web/scripts/ensure-site-config.mjs:11-40`.
- The validator test confirms that a real `BASE_URL` may override an example `site-config.url`: `apps/web/src/__tests__/ensure-site-config.test.ts:69-76`.
- The per-photo OG route pins to the trusted effective canonical origin (`BASE_URL || siteConfig.url`), not specifically `siteConfig.url`: `apps/web/src/app/api/og/photo/[id]/route.tsx:101-120`.
- Root and app READMEs use the more accurate "set `BASE_URL` or replace site-config URL" wording: `README.md:148-149`, `apps/web/README.md:42`.
- SEO defaults also expose `url: process.env.BASE_URL || siteConfig.url`: `apps/web/src/lib/data.ts:1733-1740`.

Failure scenario:

An operator may think `BASE_URL` and `site-config.json.url` must be duplicated exactly and spend time changing gitignored or bind-mounted config unnecessarily. A future agent could also "fix" the code/tests to enforce equality, breaking the documented and tested override path.

Suggested fix:

Change `CLAUDE.md` to consistently describe the source of truth as the effective canonical origin: `BASE_URL || siteConfig.url`. Replace "must match `BASE_URL`" with "used when `BASE_URL` is unset" or "may be overridden by `BASE_URL`".

### DOC13-03 - Privacy test comment points to an obsolete `data.ts` line range

Severity: Low
Confidence: High

Evidence:

- The privacy test still says the existing `_privacyGuard` lives at `data.ts:198-200`: `apps/web/src/__tests__/privacy-fields.test.ts:81-84`.
- The actual guard is now at `apps/web/src/lib/data.ts:459-477`.

Failure scenario:

During a privacy-sensitive schema change, a reviewer follows the test comment to the wrong region and misses the current `PrivacySensitiveKeys` contract. This is especially risky because `AGENTS.md` requires new admin-only columns to be added to the omit block, type guard, and fixture together.

Suggested fix:

Replace the hard-coded line range with a symbol reference such as "`_privacyGuard` in `apps/web/src/lib/data.ts`" or update the line range whenever this file moves.

## Likely Issues

### DOC13-04 - Caption-generator comment says binary footprint is zero despite shipped CLIP native inference

Severity: Low
Confidence: Medium

Evidence:

- The caption generator correctly says Florence-2 captioning is stubbed, but then says the stub keeps "the binary footprint zero": `apps/web/src/lib/caption-generator.ts:4-15`.
- The app now depends on `@huggingface/transformers`: `apps/web/package.json:28-30`.
- The lockfile shows `@huggingface/transformers` pulls `onnxruntime-node` and includes the native package: `package-lock.json:1045`, `package-lock.json:8638-8643`.
- CLIP docs and code describe the production encoder and calibrated threshold as shipped: `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:4`, `apps/web/src/lib/clip-embeddings.ts:172-191`.

Failure scenario:

A maintainer or operator reads "binary footprint zero" as a global runtime/deploy statement and assumes the container has no native ONNX inference payload. That conflicts with the production CLIP path and can lead to wrong image-size, cold-start, or dependency triage assumptions.

Suggested fix:

Reword the comment to "no additional Florence-2 model or captioning-runner footprint" or "no additional captioning binary/model footprint" so it remains true without contradicting the CLIP runtime.

## Risks Needing Manual Validation

### DOC13-05 - Shipped CLIP spec still contains unresolved "open item" wording

Severity: Low
Confidence: Medium

Evidence:

- The CLIP design spec now begins with a shipped/activated production status and records production threshold `0.22`: `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:3-11`.
- Later in the same spec, section 12 is still titled "Open Items to Resolve During Planning" and lists threshold value as an open item: `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:94-101`.
- The spike result resolves items 1, 2, and 4 but still says threshold item 3 is deferred to Task 14: `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:103-132`.
- The implementation and plan show Task 14 completed and the threshold set to `0.22`: `apps/web/src/lib/clip-embeddings.ts:175-191`, `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:855-875`.

Failure scenario:

A future agent treating the spec as an authoritative current design could re-open threshold calibration or runtime-selection work that is already completed. This is lower risk because the spec's top banner is current and the linked plan is historical, but the local section heading still reads like pending work.

Suggested fix:

Rename section 12 to "Planning Decisions and Resolutions" or append a short note after line 132 saying Task 14 resolved item 3 with `PRODUCTION_COSINE_THRESHOLD = 0.22`; keep the historical measurements if they are useful.

## No Findings in These Areas

- Deploy/runbook behavior: root deploy script, `.env.deploy.example`, remote SSH command derivation, Docker Compose build args, bind mounts, and post-deploy Docker pruning matched the documented operational model.
- DB TLS backup/restore: docs matched the fail-closed non-local `DB_SSL_CA` behavior and MySQL CLI flag generation.
- Upload limits: README/nginx/app helper values matched the documented 2 MiB generic API cap, 216 MiB admin upload/LR caps, 250 MiB restore cap, 200 MiB per-file cap, 2 GiB total window, and 100-file window.
- Health/live routes: Docker healthcheck uses `/api/live`; `/api/health` only checks DB when `HEALTH_CHECK_DB=true`, matching docs.
- Storage abstraction: docs correctly state local filesystem is the only integrated production backend and cloud backends are abstractions, not wired runtime behavior.
- Migration journal/runbook: journal monotonicity and migrator postconditions were represented in docs and tests.
- Semantic search runtime: production mode, same-origin enforcement, rate limiting, active model-version filtering, threshold use, and no-store behavior matched the current docs aside from the historical open-item wording above.

## Verification Notes

This was a read-only documentation/code mismatch review plus this artifact write. I did not run lint, typecheck, build, or tests because the request was for review findings and no production code was changed.
