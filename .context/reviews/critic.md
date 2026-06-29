# Cycle 19 Critic Review

Reviewer: critic
Scope: whole-repo skeptical review at HEAD `26f1a66d`
Mode: read-only source review plus targeted guard checks; source files were not modified.

## Inventory

Primary instructions and prior context reviewed:

- `AGENTS.md` from the prompt, including repo-specific git/deploy/schema/quality gates.
- `CLAUDE.md`, with emphasis on runtime topology, privacy fields, migrations, upload/color/HDR, semantic search, and operations.
- Cycle context: `.context/plans/cycle-19-plan.md`, `.context/plans/cycle-19-deferred.md`, existing review history under `.context/reviews/`, and the current dirty worktree state.

Relevant repo surfaces examined:

- Product/public UI/data paths: `apps/web/src/lib/data.ts`, public pages under `apps/web/src/app/[locale]/(public)/**`, `photo-viewer.tsx`, `info-bottom-sheet.tsx`, search/similar routes, service worker template, topic/smart-collection data paths.
- Admin and ingest paths: `actions/images.ts`, `actions/topics.ts`, `actions/tags.ts`, `actions/collections.ts`, Lightroom upload route, admin DB actions, auth/session/token wrappers.
- Operational/safety paths: `deploy.sh`, `docker-compose.yml`, `Dockerfile`, `scripts/migrate.js`, migration SQL/journal, restore maintenance, upload tracker, rate limiting, advisory locks, image queue/backfill runners.
- Test/guard surfaces: custom lint gates, privacy/type guards, focus-visible and touch-target scanners, migration journal tests, source-contract tests for upload/rate-limit/search.

Validation evidence:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Full lint/typecheck/build/test suite was not re-run for this critic-only report.

Dirty-worktree note:

- Before writing this report, `git status --short` already showed modified review artifacts: `.context/reviews/code-reviewer.md`, `.context/reviews/perf-reviewer.md`, `.context/reviews/verifier.md`. I did not inspect them as source of truth for this report and did not modify them.

## Findings

### CRIT19-01 — Embedding storage allows only one model row per image

Severity: Medium
Confidence: High
Status: Confirmed design risk

Evidence:

- `apps/web/src/db/schema.ts:280-295` defines `image_embeddings.image_id` as the primary key and keeps `model_version` as a secondary indexed column.
- `apps/web/scripts/migrate.js:643-656` reconciles the same physical table shape: `PRIMARY KEY (image_id)` plus an index on `(model_version, updated_at)`.
- `apps/web/scripts/backfill-clip-embeddings.ts:123-183` selects rows missing the target `model_version`, then writes with `onDuplicateKeyUpdate`, which overwrites any existing row for that image.
- `apps/web/src/app/actions/embeddings.ts:103-163` mirrors the same per-version selection followed by primary-key upsert.

Failure scenario:

Stub and production embeddings are treated as versioned data in query code, but the table can store only one version per image. Running a production backfill over previously stubbed rows replaces the stub rows. Rolling back to stub mode, comparing model versions, running a partial canary, or keeping two production model generations hot requires a full re-backfill for whichever version was overwritten. A failed or partial model migration can therefore leave the system with neither a complete new model nor a complete previous model.

Fix:

Make `(image_id, model_version)` the primary or unique key, update Drizzle schema and `reconcileLegacySchema`, and change upserts to target that composite identity. Existing route lookups already filter by `model_version`, so read-path changes should be small. Add a migration/backfill test proving stub and production rows can coexist for one image.

### CRIT19-02 — Topic slug is still a mutable natural key with manual fan-out

Severity: Medium
Confidence: High
Status: Confirmed architectural risk

Evidence:

- `apps/web/src/db/schema.ts:4-17` makes `topics.slug` the primary key and `topic_aliases.topic_slug` an FK to it.
- `apps/web/src/db/schema.ts:19-33` stores `images.topic` as an FK to `topics.slug`.
- `apps/web/src/db/schema.ts:239-250` stores analytics in `topic_views.topic`, also FKed to `topics.slug` with `ON DELETE CASCADE`.
- `apps/web/src/app/actions/topics.ts:255-339` implements rename as insert-new-topic, manually update `images`, `topicAliases`, `topicViews`, smart-collection JSON, then delete old topic.
- The code comment at `apps/web/src/app/actions/topics.ts:294-300` documents that `topicViews` was previously missed and would have been cascade-deleted.

Failure scenario:

The current three FK children are handled, and smart collections are remapped, but every future table or JSON/blob reference to topic slug must be remembered manually. The next slug-dependent feature can pass basic tests and still lose history, break public pages, or orphan references when a rare admin rename occurs. This is the exact "fix one sibling, miss the next" class already visible in the `topicViews` repair comments.

Fix:

Prefer a stable surrogate topic id and keep slug as a unique display/routing field, or at minimum add `ON UPDATE CASCADE` where supported and keep a schema-level registry test that fails when any FK to `topics.slug` lacks cascade or rename handling. If retaining recreate-delete rename, add a central list of slug-bearing children and a test that compares it against `INFORMATION_SCHEMA` plus known JSON remappers.

### CRIT19-03 — Upload quota settlement remains comment-enforced control flow

Severity: Medium
Confidence: Medium-High
Status: Risk needing continued manual validation

Evidence:

- `apps/web/src/app/actions/images.ts:238-242` pre-claims `tracker.bytes` and `tracker.count`.
- `apps/web/src/app/actions/images.ts:247-293` has hand-placed rollback settles for disk and topic validation.
- `apps/web/src/app/actions/images.ts:278-279` states the invariant: any await between claim and final settle must roll back on throw.
- `apps/web/src/app/actions/images.ts:536-551` has another comment explaining why one cleanup await is safe only because `deleteOriginalUploadFile` is non-throwing.
- `apps/web/src/app/actions/images.ts:565-596` settles on all-failed or success paths.
- `apps/web/src/__tests__/images-action-toctou-claim.test.ts:34-57` guards the current shape with regex/count assertions, not a behavioral all-throw-path harness.

Failure scenario:

A future edit adds an awaited validation, metadata transform, or cleanup in the post-claim window and forgets to settle on throw. The outer upload action can then leak the pre-claimed count/bytes until the in-memory one-hour window expires, causing legitimate admin uploads from the same user/IP to be blocked. The inverse under-count class is also possible around stale windows because `settleUploadTrackerClaim` mutates whichever entry exists for the key at settle time (`apps/web/src/lib/upload-tracker.ts:19-33`).

Fix:

Wrap the post-claim region in a single `try/finally` with a `claimSettled`/actual-success accumulator, and make `settleUploadTrackerClaim` window-identity-aware by passing the claimed `windowStart`. Replace or supplement the source-regex test with a behavioral test that forces throws at representative awaited seams and asserts quota is settled exactly once.

### CRIT19-04 — Correctness state is process-local despite several correctness contracts

Severity: Medium if scaled; Low under current single-process deploy
Confidence: High
Status: Confirmed latent operational risk

Evidence:

- `apps/web/docker-compose.yml:3-22` defines one `web` service/container with host networking and `TRUST_PROXY=true`.
- `apps/web/src/lib/restore-maintenance.ts:1-56` stores restore maintenance in `globalThis`.
- `apps/web/src/lib/upload-tracker-state.ts:7-21` stores upload quota state in a process-local `Map`.
- `apps/web/src/lib/rate-limit.ts:112-122` uses process-local maps for fast-path public/admin-token buckets, while only some buckets have DB backing.
- `apps/web/src/lib/data.ts:49-63` and `apps/web/src/lib/data.ts:222-249` keep shared-group view-count buffering and shutdown flush state in module globals.
- `apps/web/src/lib/admin-backfill-runner.ts:144-250` keeps UI-visible backfill status in `globalThis`.

Failure scenario:

The current topology appears intentionally single-process, so this is not a present production bug. But if the app is run with multiple Node workers, multiple containers, or an autoscaled platform, restore maintenance can block uploads in one process while another accepts them, upload quota and public throttles fragment, view-count increments flush independently or are lost on one process exit, and backfill status can be invisible from a different worker. Some advisory locks protect DB mutations, but not these in-memory UI/rate/maintenance states.

Fix:

Before any multi-replica deployment, either add a hard startup fence that refuses multi-instance operation for the current mode, or move correctness-critical state to MySQL/Redis/durable storage. Keep purely observational process-local caches only where stale/missing state cannot affect safety or quotas.

### CRIT19-05 — EXIF metadata remains visually grouped but semantically flat

Severity: Medium for accessibility semantics; Low for sighted product behavior
Confidence: High
Status: Confirmed product/a11y issue

Evidence:

- Desktop photo info renders EXIF as `div > p + p` pairs in `apps/web/src/components/photo-viewer.tsx:790-825`.
- Bottom sheet renders the same pattern in `apps/web/src/components/info-bottom-sheet.tsx:335-375`.

Failure scenario:

Screen reader users encounter a series of paragraphs rather than a definition list of labels and values. The visual grid communicates key/value relationships, but the DOM does not. This weakens navigation and comprehension for camera/lens/exposure metadata, especially in the bottom sheet where the content is compact and repeated.

Fix:

Refactor both EXIF grids to `<dl>` with each item as `<div><dt>label</dt><dd>value</dd></div>`, preserving the current grid classes. Add a source or rendered test that both components use `dt/dd` for at least representative EXIF fields.

### CRIT19-06 — IPv6 clients can rotate per-address public rate-limit buckets

Severity: Low
Confidence: High for the gap, Medium for impact
Status: Confirmed defense-in-depth risk

Evidence:

- `apps/web/src/lib/rate-limit.ts:123-141` normalizes an IP address exactly.
- `apps/web/src/lib/rate-limit.ts:163-194` uses the normalized client IP as the public/admin-token rate-limit key.
- Public expensive routes such as semantic search share these per-IP buckets after same-origin/body checks (`apps/web/src/app/api/search/semantic/route.ts:172-183`, `apps/web/src/app/api/search/similar/[id]/route.ts:84-94`).

Failure scenario:

An abusive IPv6 client with a delegated prefix can rotate source addresses and receive a fresh bucket for each address. Login brute-force is partly mitigated by account-scoped throttling, and semantic routes have hard body/scan caps, so this is not a high-severity confidentiality issue. It is still a resource-control gap for unauthenticated public CPU/DB surfaces.

Fix:

Normalize IPv6 rate-limit keys to a configured prefix, commonly `/64`, while leaving IPv4 exact. Add tests for representative IPv6 addresses within and outside the same prefix, and document any trusted-proxy/CDN interaction.

### CRIT19-07 — Semantic route header comment contradicts current rate-limit behavior

Severity: Low
Confidence: High
Status: Confirmed documentation/maintenance issue

Evidence:

- `apps/web/src/app/api/search/semantic/route.ts:12-16` says disabled mode returns before rate-limit charging.
- The implementation intentionally charges before the DB-backed config lookup at `apps/web/src/app/api/search/semantic/route.ts:172-183`, then checks `semanticSearchMode` at `apps/web/src/app/api/search/semantic/route.ts:185-200`.

Failure scenario:

The code is the safer behavior and should remain. The stale header can mislead a future maintainer into "restoring" the comment's behavior, reopening the previous unmetered config-lookup class, or writing tests against the wrong contract.

Fix:

Update the route header to state that syntactic/header/body-size rejects happen before charging, but disabled/stub/production mode lookup is protected DB work and stays charged.

## Scale/Performance Watchlist

- `getImagesForSmartCollection` correctly skips `COUNT(*) OVER()` on cursor pages, but initial/offset pages still compute `COUNT(*) OVER()` across the compiled predicate (`apps/web/src/lib/data.ts:1394-1455`). This is acceptable at current personal-gallery scale and becomes a Medium performance issue only when public smart collections regularly match thousands of images.
- Shared-group view-count buffering lives in `data.ts` (`apps/web/src/lib/data.ts:49-63`, `apps/web/src/lib/data.ts:222-249`). It is bounded and has tests, but the next behavioral change should consider extraction so the read data-access module stops owning timers and write buffering.
- The dead/deferred storage abstraction risk remains documented in `.context/plans/cycle-19-deferred.md`; I did not find a live importer in this pass.

## Non-Findings / Rechecked Closures

- The prior CLIP queue concern is no longer current: `apps/web/src/lib/clip-model.ts:53-64` now has configurable concurrency, max pending, and queue timeout; `apps/web/src/lib/clip-model.ts:94-127` rejects full/expired waits.
- The semantic search routes now pre-increment before the config lookup, closing the previous unmetered disabled-mode DB-work concern (`apps/web/src/app/api/search/semantic/route.ts:172-183`, `apps/web/src/app/api/search/similar/[id]/route.ts:84-112`).
- Search enrichment now uses a shared compile-guarded public select (`apps/web/src/lib/search-enrichment-fields.ts:1-46`) in both semantic and similar routes.
- Focus-visible coverage has a general scanner now (`apps/web/src/__tests__/focus-visible-links-scan.test.ts:1-101`) plus cycle-specific pins. I did not find the earlier "no scanner" gap still open.
- Touch-target coverage remains broad and scans components, admin routes, public route group, and app-level locale files (`apps/web/src/__tests__/touch-target-audit.test.ts:42-83`).
- Migration journal monotonicity and silent-skip postconditions are guarded (`apps/web/src/__tests__/migration-journal-monotonicity.test.ts:1-120`), and `migrate.js` has a loud missing-hash check (`apps/web/scripts/migrate.js:787-808`).
- API-admin auth and mutating action origin guards passed their repo lint gates during this review.

## Final Missed-Issue Sweep

Sweep coverage included:

- Public unauthenticated routes for body caps, same-origin, no-store, runtime pinning, and rate-limit order.
- Admin API wrapper and PAT route posture.
- Upload, Lightroom ingest, topic rename/delete, smart collections, sharing, map visibility, and analytics view recording.
- Service worker HTML/image caching, admin bypass, revocable share/photo/map bypass, and admin-render header interaction.
- Migration reconciliation against schema and journal.
- Process-local state and deploy topology assumptions.
- Existing cycle 19 plan/deferred items checked against current source so fixed items were not re-reported.

No new Critical or High-confidence live data-loss/privacy issue was confirmed in this pass. The highest-value fixes are structural: composite embedding identity, topic slug identity/cascade design, and a single-settle upload quota control flow.
