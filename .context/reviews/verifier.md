# Cycle 16 Verifier Review

Date: 2026-07-08
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `d71a3534`
Mode: evidence-based static correctness review with focused contract tests/lints.

I did not implement fixes, deploy, stop services, delete files, or modify anything outside this assigned review file. Final `git status --short` also showed modified reports from other review lanes: `.context/reviews/architect.md`, `.context/reviews/code-reviewer.md`, `.context/reviews/critic.md`, `.context/reviews/perf-reviewer.md`, `.context/reviews/security-reviewer.md`, and `.context/reviews/test-engineer.md`.

## Inventory Built First

I built the verifier inventory before analyzing findings.

- Required contracts: `AGENTS.md`, `CLAUDE.md`, root deploy policy, migration runbook, privacy-field checklist, upload/color/HDR notes, semantic-search activation notes, and deploy/disk-hygiene contracts.
- Auth/origin/rate-limit surface: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/proxy.ts`, custom lint scripts, admin/public API routes, and server actions.
- Migration/schema surface: `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/db/schema.ts`, and migration coverage tests.
- Privacy/select surface: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, public/timeline/map/search query paths, and `apps/web/src/__tests__/privacy-fields.test.ts`.
- Upload/processing surface: browser upload action, Lightroom upload API, upload tracker, upload paths, restore maintenance locks, image queue, `process-image.ts`, color detection, EXIF/GPS stripping, settings snapshots, and related tests.
- Color/HDR surface: `apps/web/src/lib/color-detection.ts`, `apps/web/src/lib/color-primaries.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/settings-hash.ts`, and color/process-image tests.
- Semantic-search surface: semantic and similar routes, embedding storage/model-version helpers, CLIP model loader, model download script, backfill script, queue embedding side effect, settings validators, UI mode tests, and CLIP preflight workflow.
- Deploy/runtime surface: `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/scripts/entrypoint.sh`, and `apps/web/nginx/default.conf`.

Final inventory rule: I examined every file in the review-relevant surfaces above either directly or through the specific invariant it participates in. I did not sample only a subset of the relevant auth/API/migration/privacy/upload/color/semantic/deploy files. Generated assets, static images, and build outputs were not reviewed because they do not define these runtime contracts.

## Validation Evidence

Commands run during this verifier pass:

- `npm run lint:api-auth --workspace=apps/web`: passed; admin API exports checked as wrapped by `withAdminAuth(...)`.
- `npm run lint:action-origin --workspace=apps/web`: passed; mutating server actions checked for same-origin provenance or explicit approved exemption/rate-limited public action.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed; public mutating/expensive routes checked for pre-increment rate limiting or approved exemption.
- Focused contract tests: `npm test --workspace=apps/web -- --run src/__tests__/privacy-fields.test.ts src/__tests__/migrate-pending-migrations.test.ts src/__tests__/migrate-reconcile-coverage.test.ts src/__tests__/settings-hash.test.ts src/__tests__/semantic-search-route.test.ts src/__tests__/semantic-route-production.test.ts src/__tests__/similar-route.test.ts src/__tests__/lr-upload-route-behavior.test.ts src/__tests__/upload-processing-contract-lock.test.ts src/__tests__/color-detection.test.ts src/__tests__/process-image-color-roundtrip.test.ts src/__tests__/process-image-post-encode-verification.test.ts src/__tests__/strip-gps-from-original.test.ts`: 13 files passed, 285 tests passed.
- Migration journal check: 30 SQL files, 30 journal entries, no missing SQL, no missing journal entry, no duplicate `when`; newest entries `0022` through `0029` are above the current max-cursor path. One historical adjacent inversion remains at `_journal.json` entries `0006`/`0007` (`apps/web/drizzle/meta/_journal.json:47-59`), but current tail entries follow the documented "greater than max current journal when" rule.

Full `npm run lint`, `npm run typecheck`, `npm run build`, full `npm test`, and Playwright e2e were not run in this verifier lane.

## Behavior Claims Checked

- Source vs AGENTS/CLAUDE: the reviewed source generally matches the documented contracts for admin API auth wrapping, same-origin action guards, public route rate-limit linting, migration postconditions, privacy field omissions, upload settings snapshots, color/HDR processing, semantic-search gates, and deploy disk hygiene.
- Auth/origin/rate-limit lints: custom lints pass, and source shows API cookie auth requires trusted same-origin while PAT auth is scope-bound (`api-auth.ts`); public semantic/similar routes charge before protected DB/embedding work.
- Migration/journal invariants: every committed SQL has a journal entry and vice versa; `migrate.js` hashes every journal SQL (`apps/web/scripts/migrate.js:210-226`), refuses unmirrored DML baselining (`apps/web/scripts/migrate.js:180-208`), reconciles legacy schema before baselining (`apps/web/scripts/migrate.js:348-430` and later), and postconditions all committed hashes.
- Privacy field guards: `publicSelectFields` and `publicMapSelectFields` are derived from `adminSelectFields` by explicit omissions (`apps/web/src/lib/data.ts:251-407` and `409-488`), and `privacy-fields.test.ts` mirrors `SENSITIVE_KEYS` (`apps/web/src/__tests__/privacy-fields.test.ts:41-79`).
- Upload/processing contracts: browser upload preclaims quota before awaited checks (`apps/web/src/app/actions/images.ts:219-269`), verifies disk/topic under the upload contract path, rejects HDR when disabled (`apps/web/src/app/actions/images.ts:381-388`), strips GPS in DB and original or fails closed (`apps/web/src/app/actions/images.ts:409-422`), and inserts processing snapshot/color metadata. Lightroom upload mirrors the contract with the PAT route's post-parse lock and fail-closed GPS/HDR handling (`apps/web/src/app/api/admin/lr/upload/route.ts:252-314`, `396-424`, `443-470`).
- Color/HDR contracts: color signal detection maps CICP/NCLX and HDR PQ/HLG (`apps/web/src/lib/color-detection.ts:171-213`); processing uses fresh dimensions, wide-gamut cap/intermediate ICC preservation, P3/sRGB target ICC, AVIF high-bit-depth fallback, atomic derivative writes, and audit-only post-encode checks (`apps/web/src/lib/process-image.ts:1049-1145`, `1280-1484`).
- Semantic activation gates: semantic mode defaults disabled and production heals to disabled unless runtime env allows it (`apps/web/src/lib/gallery-config-shared.ts:119-120`, `223-229`); semantic route serves only stub/production and filters by active model version (`apps/web/src/app/api/search/semantic/route.ts:186-205`, `263-311`); similar route is production-only and filters `PRODUCTION_MODEL_VERSION` (`apps/web/src/app/api/search/similar/[id]/route.ts:115-190`).
- Deploy script contracts: root remote helper is env-file driven and permission-gated (`scripts/deploy-remote.sh:22-93`); deploy script pulls, checks env permissions, health-checks, then prunes containers/images/build cache/dangling volumes only after live container health (`apps/web/deploy.sh:10-108`).

## Confirmed Issues

### VER-16-01 - Admin deletion can throw outside its structured error path when the DB pool cannot hand out a connection

Severity: Medium
Confidence: High
Status: Confirmed issue

Evidence:

- `apps/web/src/app/actions/admin-users.ts:194-207` performs maintenance, same-origin, mutation-slot, and admin checks and returns structured `{ error: ... }` objects on guard failures.
- The dedicated MySQL connection is acquired at `apps/web/src/app/actions/admin-users.ts:231` before the `try` block begins at `apps/web/src/app/actions/admin-users.ts:239`.
- The structured rollback/error mapping/final release logic only covers failures after the connection exists (`apps/web/src/app/actions/admin-users.ts:291-313`).
- The action is recognized by `lint:action-origin` as a mutating admin action, so callers and tests expect the guarded action surface rather than an unhandled server-action exception.

Problem:

If `connection.getConnection()` rejects, the error bypasses the action's localized `{ error: t('failedToDeleteUser') }` response and bypasses the function's cleanup shape. This creates a raw server-action failure for a normal transient infrastructure condition such as a saturated MySQL pool, restart, or connection refusal.

Concrete failure scenario:

An admin clicks "delete user" while MySQL is restarting or the pool is exhausted. The action passes auth/origin checks, then `connection.getConnection()` rejects at line 231. Because the `try` begins later, the caller receives an unstructured server error instead of the expected localized failure object, and the UI may show a generic crash/toast or retry the mutation ambiguously.

Suggested fix:

Move the connection acquisition inside a broader `try` and make the connection nullable for `finally`, or wrap only the acquisition in its own `try/catch` returning `failedToDeleteUser`. Keep rollback/release guarded by `if (conn)`. Add a targeted unit/source test that stubs `connection.getConnection()` rejection and asserts the action returns `{ error: t('failedToDeleteUser') }`.

### VER-16-02 - CLIP backfill action can throw outside its structured error path when advisory-lock connection acquisition fails

Severity: Medium
Confidence: High
Status: Confirmed issue

Evidence:

- `apps/web/src/app/actions/embeddings.ts:59-78` returns structured `BackfillEmbeddingsResult` values for maintenance/origin/admin/rate-limit failures.
- The action resolves mode and model version, then acquires a dedicated lock connection at `apps/web/src/app/actions/embeddings.ts:113`.
- The `try`/`catch` that logs and returns `{ status: 'error', message: t('embeddingBackfillFailed') }` starts after acquisition (`apps/web/src/app/actions/embeddings.ts:115-201`).
- The `finally` assumes `lockConn` exists and releases/destroys based on `semanticBackfillLockHeld` (`apps/web/src/app/actions/embeddings.ts:202-212`).

Problem:

`connection.getConnection()` rejection bypasses the action's declared structured `BackfillEmbeddingsResult` contract. The comments note the UI is not currently wired, but the function is exported, linted, and designed as an admin action; surfacing it later would inherit this edge failure.

Concrete failure scenario:

An operator triggers the admin CLIP backfill while the DB pool is saturated. The action passes origin/admin/rate-limit checks and mode gating, then line 113 rejects. The caller gets an unhandled server-action exception rather than `{ status: 'error', message: embeddingBackfillFailed }`, and the action's logging/error translation path is skipped.

Suggested fix:

Hoist `let lockConn: PoolConnection | null = null` before the `try`, perform `lockConn = await connection.getConnection()` inside it, and guard the `finally` release path with `if (lockConn)`. Add a test that rejects `getConnection()` and asserts the returned error status/message.

## Likely Issues

None found beyond the confirmed issues above.

## Risks Requiring Manual Validation

### VER-16-RISK-01 - Nginx/proxy rate-limit correctness depends on host topology and manual config application

Severity: High
Confidence: High for source contract, Low for live host state
Status: Manual-validation risk

Evidence:

- `apps/web/nginx/default.conf:20-29` warns that nginx `limit_req_zone` uses `$binary_remote_addr` and needs realip/PROXY-protocol support behind a load balancer.
- `apps/web/nginx/default.conf:59-71` states the X-Forwarded-For overwrite is correct only when the connection peer is the real client and otherwise collapses app per-IP limits into one shared bucket.
- The public SSR limiter is config-only and explicitly requires manual operator reload (`apps/web/nginx/default.conf:290-306`).
- The deploy script does not install or reload nginx config; it deploys Docker and prunes Docker artifacts (`apps/web/deploy.sh:51-108`).

Problem:

Repo source can prove the intended nginx/app contract, but not that the production host has the matching realip topology or that this config was applied after edits. A mismatch can either over-throttle all users behind one load balancer IP or undercut per-client abuse controls.

Concrete failure scenario:

A TLS load balancer connects to nginx from one private IP. Nginx overwrites `X-Forwarded-For` with that LB IP and rate-limit zones key on `$binary_remote_addr`. Five failed logins or a burst of public SSR requests from one visitor can consume the shared bucket for all visitors; conversely, app telemetry cannot distinguish real clients.

Suggested fix:

Add an operational validation step after deploy: `nginx -T`/`nginx -t`, confirm `set_real_ip_from`/`real_ip_header` or `$proxy_add_x_forwarded_for` for LB topology, and hit a diagnostic endpoint through the real edge to confirm app-visible IPs. Consider a non-destructive deploy check script that prints the active nginx topology assumptions without reloading.

### VER-16-RISK-02 - Production CLIP activation remains environment/preflight dependent and is not proven by normal tests

Severity: Medium
Confidence: High
Status: Manual-validation risk

Evidence:

- Offline CLIP load tests skip unless `CLIP_OFFLINE_LOAD=1`, `CLIP_MODELS_ROOT` is set, and the pinned quantized model exists (`apps/web/src/__tests__/clip-offline-load.test.ts:32-41`).
- Semantic integration tests skip unless `CLIP_INTEGRATION=1` (`apps/web/src/__tests__/clip-semantic-integration.test.ts:30-31`).
- The dedicated GitHub workflow seeds weights and runs `npm run test:clip:preflight` only on schedule/manual dispatch (`.github/workflows/clip-preflight.yml:3-46`).
- Runtime production mode heals to disabled unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` through `resolveSemanticSearchMode` (`apps/web/src/lib/gallery-config-shared.ts:223-229`), and production search returns 503 when no production embeddings are present (`apps/web/src/app/api/search/semantic/route.ts:285-289`).

Problem:

The normal focused/unit tests prove gates and mode behavior, not that a live production host has seeded model files, offline transformer loading, and production embeddings. That is acceptable operationally, but it is a real activation risk for the documented semantic-search runbook.

Concrete failure scenario:

An operator sets admin mode to `production` and `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, but the model cache was not seeded on the deployed host or `CLIP_MODELS_ROOT` points at the wrong bind mount. The route either heals disabled or fails inference/no-embeddings with 503, so the public search UI appears unavailable despite the setting.

Suggested fix:

Before enabling production mode, run the documented model download plus `npm run test:clip:preflight` with `CLIP_OFFLINE_LOAD=1`, `CLIP_INTEGRATION=1`, and the same `CLIP_MODELS_ROOT` used by the container. Consider adding a deploy-time read-only preflight command that reports model-cache presence and active model-version row counts without mutating state.

### VER-16-RISK-03 - Migration reconcile coverage is a source tripwire, not structural schema equivalence

Severity: Medium
Confidence: High
Status: Manual-validation risk

Evidence:

- `migrate-reconcile-coverage.test.ts` explicitly says it is a source tripwire and cannot verify types/defaults (`apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`).
- The index tripwire similarly checks source name presence, not structural equivalence (`apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:107-122`).
- `reconcileLegacySchema` is large and hand-maintained (`apps/web/scripts/migrate.js:348-430` and later), while journal entries can be baselined after reconcile.
- The focused migration tests passed, and the journal/file inventory found no missing SQL or journal entries.

Problem:

Current tests catch many omission classes but still cannot prove that `reconcileLegacySchema` creates the exact same MySQL column types, defaults, nullability, indexes, and constraints as Drizzle SQL on a fresh database. The docs correctly call for a fresh DB plus `information_schema` diff as the authoritative check; that check is not part of the focused verifier run.

Concrete failure scenario:

A future migration changes a column default or index prefix while keeping the same column/index name. The source tripwire passes because the name appears in `migrate.js`, but a fresh install through reconcile/baseline ends with a schema that differs subtly from Drizzle SQL. Later writes or query plans diverge only in production.

Suggested fix:

Promote the fresh-DB init plus `information_schema` structural diff to a repeatable CI/manual script, at least for migration PRs. Keep the source tripwire as fast coverage, but do not treat it as proof of structural parity.

### VER-16-RISK-04 - GPS fail-closed source is correct, but some tests assert source text rather than behavior

Severity: Low
Confidence: High
Status: Manual-validation/test-proof risk

Evidence:

- Browser upload source deletes the saved original and continues failure handling when `stripGpsFromOriginal(...)` returns false (`apps/web/src/app/actions/images.ts:409-422`).
- Lightroom upload source deletes the saved original, settles quota, and returns 422 when GPS stripping fails (`apps/web/src/app/api/admin/lr/upload/route.ts:407-424`).
- The tests that pin browser/LR GPS wiring assert source text for the failure branch (`apps/web/src/__tests__/images-action-gps-toggle-wiring.test.ts:69-76`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:106-111`).
- The focused verifier run did execute `strip-gps-from-original.test.ts`, but that proves the helper behavior, not full upload action rollback behavior under a mocked helper failure.

Problem:

The implementation matches the documented fail-closed privacy contract today. The remaining risk is proof strength: source-text tests can pass while a refactor changes runtime behavior in a way that preserves the searched strings.

Concrete failure scenario:

A future refactor moves deletion or quota settlement outside the false-return branch but leaves the same string literals and function call text in the file. The source-text tests stay green, but a failed GPS strip could leave an original at rest or misreport quota until manual testing catches it.

Suggested fix:

Add behavior tests for both upload paths that mock `stripGpsFromOriginal` to return false and assert: no DB insert, original deletion called, quota settled/rolled back, and user-facing failure status/message returned.

## No-Issue Confirmations

- API/auth/origin/rate-limit: the three custom lints passed. Cookie-auth admin APIs require same-origin through `withAdminAuth`; public semantic/similar routes are same-origin and pre-increment rate-limited before protected DB/embedding work.
- Migration/journal: SQL and journal tags match exactly. Current tail journal entries use increasing `when` values above the present max, satisfying the current add-migration rule. The historical `0006`/`0007` inversion remains visible but is mitigated by current reconcile/baseline/postcondition behavior.
- Privacy: public listing/search/map field sets omit the documented sensitive fields; type guards and `privacy-fields.test.ts` cover the sensitive-key union.
- Upload/processing: browser and LR upload paths both enforce topic validation, upload-processing contract locking, quota preclaim/settle behavior, disk checks with `bavail`, HDR ingest gates, GPS fail-closed source behavior, original cleanup before failed insert, and processing-settings snapshots.
- Color/HDR: current processing source matches the photographer-intent contract: no edit/scoring/culling features, color metadata is retained for admin audit, wide-gamut sources are P3/sRGB converted according to config, HDR ingest is rejected by default, and delivered HDR/gain-map flags remain admin-only.
- Semantic search: disabled by default, production dark-launched behind env and model-version gates, stub rows segregated from production rows, similar route production-only, scan/topK caps tested in focused semantic tests.
- Deploy: remote deploy is config-driven, deploy uses `git pull --ff-only`, runtime env permissions are enforced, health is checked before pruning, and `docker volume prune` is used without `-a` after live container health.

## Final Sweep

- Reviewed earlier cycle-16 lane reports for missed issues, then independently verified the two confirmed source defects above before including them.
- Re-ran the three custom lints and focused verifier-relevant tests after the review inventory.
- Checked migration journal/file counts mechanically.
- Confirmed only `.context/reviews/verifier.md` was modified by this verifier lane.
- Known validation gap: full repo gates (`lint`, `typecheck`, `build`, full `test`, e2e) were not run in this lane, so this report should not be read as a full release sign-off.
