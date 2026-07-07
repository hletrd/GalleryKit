# Cycle 9 - Code-Reviewer Lane

Date: 2026-07-07
Reviewer: code-reviewer
HEAD reviewed: `ff0c79d607208bae9487be8152fa648f4161674f`
Mode: read-only code-quality, logic, SOLID, and maintainability review except this report artifact. I did not modify application code, deploy, stop services, delete files, change schema/data, or touch production state.

## Inventory

I read `AGENTS.md` and `CLAUDE.md` first, then inventoried the repository before narrowing findings.

- Source/docs reviewed: root instructions, `CLAUDE.md`, root/app READMEs, current `.context/reviews/*` lane context, package/config files, deploy/nginx/Docker assets, migrations, app routes/actions, data layer, queue/backfill scripts, image/color pipeline, semantic search, auth/origin/rate-limit guards, privacy selectors, and maintenance/restore helpers.
- Tracked surface: 3,392 files total; `apps/web/src` has 608 tracked files, including 81 App Router/action/API files, 111 `lib` files, and 61 component files.
- Code/test surface: 600 tracked TS/TSX files under `apps/web/src`, 29 app scripts, 33 Drizzle SQL/meta files, and 12 Playwright e2e files.
- Final sweep searches covered TODO/FIXME/HACK markers, unsafe casts/ignores, route exports, auth/origin/rate-limit exemptions, raw SQL/update/delete paths, process-local state, storage abstractions, privacy selects, semantic embedding ownership, queue/backfill locks, and docs/code drift.

Concurrent review artifacts changed while this lane was running (`architect.md`, then `security-reviewer.md`); I treated them as peer/user work and did not edit or revert them.

## Validation

- `npm run lint --workspace=apps/web` passed.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run typecheck --workspace=apps/web` passed.
- `npm test --workspace=apps/web` passed: 340 files passed, 2 skipped; 3,151 tests passed, 4 skipped.
- `npm run build --workspace=apps/web` passed. It logged the known homepage-only sitemap fallback because local MySQL at `127.0.0.1:3306` was unavailable during static generation.

I did not run Playwright e2e because this was a static/deep review lane and no browser-flow change was made.

## Findings Summary

- Critical: 0
- High: 0
- Medium: 2
- Low: 2

## Findings

### CR-C9-01 - Semantic embedding writes overwrite alternate model versions

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- The schema makes `image_embeddings.image_id` the sole primary key while `model_version` is a normal column (`apps/web/src/db/schema.ts:286-300`).
- The physical migration matches that shape with `PRIMARY KEY (image_id)` (`apps/web/drizzle/0012_image_embeddings.sql:5-11`).
- Every writer uses `onDuplicateKeyUpdate` on `image_id` and rewrites `modelVersion`: admin backfill (`apps/web/src/app/actions/embeddings.ts:175-186`), upload queue (`apps/web/src/lib/image-queue.ts:512-523`), and sidecar backfill (`apps/web/scripts/backfill-clip-embeddings.ts:212-223`).
- Public semantic/similar routes filter by `model_version` (`apps/web/src/app/api/search/semantic/route.ts:271-278`, `apps/web/src/app/api/search/similar/[id]/route.ts:141-149`, `apps/web/src/app/api/search/similar/[id]/route.ts:182-189`).
- The docs say embedding writes are one row per `(image_id, model_version)` and retries upsert that composite row (`apps/web/README.md:70-82`, `CLAUDE.md:160`).

Why this matters:

The code implements one active embedding per image, but the docs and query model imply versioned embeddings. The mismatch is not just documentation drift: switching modes or model versions can destroy the previous version's row.

Concrete failure scenario:

An image has a production `jina-clip-v2-d512-q8` embedding. An admin or operator switches to stub mode for smoke testing, or runs the stub backfill on the same DB. The upsert hits the `image_id` primary key and overwrites the production row with `stub-sha256-v1`. When production mode is restored, semantic and similar search filter for the production model and now omit that image until it is re-embedded.

Suggested fix:

Choose and enforce one ownership model. If multiple model versions are supported, migrate the key to `(image_id, model_version)` and update writers, scans, cleanup, and tests around that composite invariant. If only one active embedding is intended, update the docs/runbooks, make mode/model switches explicit destructive operations, and block stub writes from replacing production rows unless the operator opts into that loss.

### CR-C9-02 - Public privacy guards can be bypassed by aliasing sensitive columns

Severity: Medium
Confidence: High
Status: Risk, confirmed guard-shape gap

Evidence:

- `publicSelectFields` omits sensitive keys from `adminSelectFields` and guards only `keyof typeof publicSelectFields` against `PrivacySensitiveKeys` (`apps/web/src/lib/data.ts:368-475`).
- Public mirrors use the same result-key guard pattern: search enrichment (`apps/web/src/lib/search-enrichment-fields.ts:29-47`), timeline fields (`apps/web/src/lib/data-timeline.ts:35-67`), and `searchImages` (`apps/web/src/lib/data.ts:1599-1617`).
- The privacy tests pin public result keys and sensitive key names (`apps/web/src/__tests__/privacy-fields.test.ts:19-57`, `apps/web/src/__tests__/privacy-fields.test.ts:103-164`), but they do not detect a sensitive Drizzle column selected under a safe alias.

Why this matters:

The public/admin data boundary depends on field names rather than selected source columns. That is brittle in a codebase with several hand-maintained public select shapes.

Concrete failure scenario:

A future public search or share optimization adds `gpsLat: images.latitude`, `originalName: images.user_filename`, or `sourceFile: images.filename_original`. The compile-time guard passes because the aliases are not in `PrivacySensitiveKeys`, and unauthenticated data can leak through page props or JSON responses.

Suggested fix:

Move public selectors to a column-level allowlist helper instead of a key-name denylist. Route-specific selects should derive from that helper. Add an AST/source-contract test that rejects direct references to sensitive `images` columns in public modules, even when the result key is aliased.

### CR-C9-03 - `getSharedGroup` mixes data reads with view-count side effects

Severity: Low
Confidence: High
Status: Confirmed

Evidence:

- `getSharedGroup()` loads a group and its public images, then calls `bufferGroupViewCount(group.id)` unless `incrementViewCount:false` or a valid selected photo is present (`apps/web/src/lib/data.ts:1322-1407`).
- The same helper is exported through React `cache()` with a warning not to call it twice with different count semantics in one render path (`apps/web/src/lib/data.ts:1796-1800`).
- The public group page separately records durable analytics after resolving the selected image (`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:137-142`).

Why this matters:

A data-access helper has a hidden write side effect and its cached wrapper has argument-sensitive semantics. That weakens separation of concerns and makes future reuse risky.

Concrete failure scenario:

A metadata route, admin preview, or share-management view calls `getSharedGroupCached(key)` only to inspect the group. The denormalized `view_count` increments even though no public group view occurred. If another call in the same render path uses different options, cache deduplication can make the side effect depend on call order.

Suggested fix:

Make shared-group reads pure. Move denormalized counter buffering into an explicit `recordSharedGroupView`/`recordSharedGroupLookup` service owned by the public route, and cache only the pure read helper.

### CR-C9-04 - Drizzle Kit TLS config does not share the runtime DB CA contract

Severity: Low
Confidence: High
Status: Confirmed

Evidence:

- Runtime DB setup requires `DB_SSL_CA` for non-local DB hosts unless `DB_SSL=false`, then reads that CA into `ssl.ca` (`apps/web/src/db/index.ts:7-19`).
- Operational MySQL scripts use the same fail-closed CA behavior (`apps/web/scripts/mysql-connection-options.js:13-29`).
- `drizzle.config.ts` independently enables TLS for non-local hosts with only `{ rejectUnauthorized: true }` and never reads `DB_SSL_CA` (`apps/web/drizzle.config.ts:6-22`).

Why this matters:

The same database environment has two TLS implementations. Runtime/backup/restore can work with a private CA while Drizzle Kit fails or pushes operators toward local TLS workarounds.

Concrete failure scenario:

An operator runs a Drizzle Kit command against a non-local private-CA MySQL host. The app and migration scripts connect because `DB_SSL_CA` is configured, but Drizzle Kit rejects the certificate because the CA was not loaded. The workaround pressure is to disable TLS verification for tooling, which drifts from the runtime safety contract.

Suggested fix:

Centralize MySQL connection-option construction or duplicate the same CA-loading rule in `drizzle.config.ts`. Alternatively, make Drizzle Kit explicitly local-only unless a supported CA path is present, matching the project guidance that production schema changes go through committed migrations.

## Final Sweep

No Critical or High code-quality/logic findings were found in this pass. Commonly missed areas checked included server-action origin order, admin API wrappers, public route rate-limit pre-increments, analytics charging order, semantic/similar search scan bounds, upload/delete/retry cleanup, queue/backfill lock interaction, migration journal/reconcile drift, public privacy selectors, smart-collection compiler constraints, service-worker cache boundaries, restore-maintenance fences, and storage path containment.

Not re-filed as defects after verification:

- Public analytics view-record rate limiting charges before public target lookup, but that order is intentional and source-locked by `apps/web/src/__tests__/cycle-10-source-contracts.test.ts:10-19`.
- The color sidecar and retry path do not have the suspected processed-row race: `retryFailedImage()` only re-enqueues `processed=false` failed rows (`apps/web/src/app/actions/images.ts:1261-1321`), while the color backfill selects `processed = TRUE` rows (`apps/web/scripts/backfill-color-pipeline.ts:372-381`).
