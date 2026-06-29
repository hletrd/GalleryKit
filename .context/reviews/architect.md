# Architect Review - Cycle 11

Review target: current `master` HEAD `a4af799209d51c5b8972d39747ab185346ed0eac`. Recent commits on top of `d5d79e17` are review-artifact commits; I treated the production source as the active implementation surface and did not edit production code.

Role: architectural/design risks, coupling, layering, and boundary ownership.

## Inventory Built Before Findings

I read the workspace instructions and `CLAUDE.md` first, then inventoried the current repo before forming findings.

Review-relevant inventory:

- Governance and architecture docs: `AGENTS.md`, `CLAUDE.md`, root/package deploy scripts, and current `.context/reviews/*.md` artifacts.
- App/request surface: all App Router pages, route handlers, API routes, and server actions under `apps/web/src/app`.
- Core architecture modules: `apps/web/src/lib/**`, especially auth/session, action guards, rate limits, data selectors/privacy guards, upload paths, image processing, queue/bootstrap/shutdown, restore maintenance, DB restore, storage quarantine, semantic search, and CLIP model paths.
- Schema and migration surface: `apps/web/src/db/schema.ts`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, and `apps/web/scripts/migrate.js`.
- Operations surface: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, and sidecar scripts under `apps/web/scripts`.
- Contract tests: privacy field guards, action/API/rate-limit scanners, Lightroom upload source contracts, storage quarantine tests, upload path tests, migration/journal tests, queue/backfill tests, semantic-search tests, and recent current-cycle review artifacts.

Counted active source/config files under the app/lib/component/script/schema/nginx review roots: 286 files with source/config extensions. Excluded `node_modules`, binary fixtures, screenshots, runtime data, and historical archived review material except where needed to avoid stale duplicate claims.

## Confirmed Findings

### ARCH-C11-01 - Mutating admin actions do same-origin checks after auth/session work

Severity: Low
Confidence: High
Status: Confirmed layering/guardrail issue, not a confirmed CSRF bypass

Evidence:

- `apps/web/src/app/actions/settings.ts:40-47` checks maintenance, then calls `isAdmin()`, then calls `requireSameOriginAdmin()`.
- `apps/web/src/app/actions/seo.ts:54-61` has the same ordering.
- `apps/web/src/app/actions/topics.ts:85-92` repeats the same trust-boundary order for topic creation, with the same pattern repeated across other topic mutations.
- `apps/web/src/app/actions/admin-users.ts:75-82` calls `isAdmin()` before same-origin rejection on admin creation; `apps/web/src/app/actions/admin-users.ts:182-190` calls `isAdmin()` and `getCurrentUser()` before origin rejection on deletion.
- The broader sweep shows many similar sequences in `apps/web/src/app/actions/tags.ts`, `sharing.ts`, `collections.ts`, `settings.ts`, `seo.ts`, and `topics.ts`.
- The guard helper itself is documented as the server-action provenance boundary at `apps/web/src/lib/action-guards.ts:19-37`.

Failure scenario:

A malicious site triggers cross-site server-action requests from an authenticated admin browser. Mutations are eventually blocked, but each request can still force session verification and, on some paths, current-user lookup before the provenance check rejects it. More importantly, this ordering teaches future maintainers that auth/session work is acceptable before the origin boundary; a later edit can add validation, DB reads, rate-limit increments, audit work, or other side effects before `requireSameOriginAdmin()` while the current lint gate still passes because it only proves the guard exists.

Suggested fix:

Standardize mutating admin action prologues so `requireSameOriginAdmin()` is the first trust-boundary check after cheap maintenance/read-only preconditions, then run `isAdmin()` / `getCurrentUser()`, validation, rate limits, and DB work. Strengthen `apps/web/scripts/check-action-origin.ts` so it fails if `isAdmin`, `getCurrentUser`, `db.*`, audit logging, or rate-limit pre-increments appear before the same-origin return path in mutating exports.

### ARCH-C11-02 - Sidecar backfill scripts bypass the bounded-concurrency architecture

Severity: Medium
Confidence: High
Status: Confirmed operational architecture issue

Evidence:

- `apps/web/scripts/backfill-color-pipeline.ts:27-32` documents `BACKFILL_CONCURRENCY` as a cap to avoid overwhelming the server and uses a global MySQL advisory lock.
- `apps/web/scripts/backfill-color-pipeline.ts:370-371` parses `BACKFILL_CONCURRENCY` as `Math.max(1, Number(...) || 2)` and passes it straight to `new PQueue({ concurrency })`.
- `apps/web/scripts/backfill-cicp-recheck.ts:80-81` uses the same unbounded parse shape.
- The app already has a safer finite integer helper at `apps/web/src/lib/env.ts:1-24`.
- The in-app runner explicitly clamps its concurrency to the DB pool budget at `apps/web/src/lib/admin-backfill-runner.ts:662-673`.

Failure scenario:

An operator runs the documented sidecar backfill with `BACKFILL_CONCURRENCY=Infinity`, `1e309`, or a very large value. The script bypasses the intended PQueue cap, can schedule a large gallery's re-encode work at once, and each task can drive Sharp AVIF/WebP/JPEG fan-out plus MySQL updates from a separate sidecar pool. That undermines the architecture that reserves pool/CPU budget for the live web process and can turn maintenance into host-level CPU, memory, disk I/O, and DB saturation. Fractional values such as `2.5` are also accepted, which makes the operational contract ambiguous.

Suggested fix:

Reuse `parseBoundedPositiveInteger` or add a script-local equivalent for sidecars: require finite values, intentionally floor or reject fractions, and clamp to a documented maximum. Keep sidecar defaults more aggressive than in-app if desired, but still finite. Add coverage for `Infinity`, `1e309`, fractional, zero, negative, and very large `BACKFILL_CONCURRENCY` values in both scripts.

## Risks

### ARCH-C11-RISK-01 - The quarantined storage backend still maps private originals under the public upload root

Severity: Medium
Confidence: High
Status: Risk; confirmed design mismatch in a quarantined module, not a live path today

Evidence:

- Current canonical paths split processed derivatives under `UPLOAD_ROOT` from originals under `UPLOAD_ORIGINAL_ROOT`: `apps/web/src/lib/upload-paths.ts:11-46`.
- Legacy public originals are explicitly treated as unsafe and fail production startup when present: `apps/web/src/lib/upload-paths.ts:24-25`, `apps/web/src/lib/upload-paths.ts:110-130`, and `apps/web/src/instrumentation.ts:1-5`.
- The local storage backend imports only `UPLOAD_ROOT`: `apps/web/src/lib/storage/local.ts:14-15`.
- It includes `original` in directories it creates under `UPLOAD_ROOT`: `apps/web/src/lib/storage/local.ts:17-20` and `apps/web/src/lib/storage/local.ts:50-59`.
- All keys, including `original/foo`, resolve under `UPLOAD_ROOT`: `apps/web/src/lib/storage/local.ts:40-47`; writes use that resolver at `apps/web/src/lib/storage/local.ts:62-84`.
- `getUrl()` refuses `original/*` URLs at `apps/web/src/lib/storage/local.ts:130-138`, but that is only an API-level URL guard, not a storage-location guard.
- CI currently quarantines imports from `@/lib/storage` outside the storage module: `apps/web/src/__tests__/storage-quarantine.test.ts:1-25` and `apps/web/src/__tests__/storage-quarantine.test.ts:116-129`.
- Nginx blocks `/uploads/original/` in the documented deployment at `apps/web/nginx/default.conf:163-165`, but the app-level static/public file model still treats `public/uploads` as public infrastructure.

Failure scenario:

A future storage-integration change removes or relaxes the quarantine and saves originals through `getStorage().writeStream('original/name.jpg', ...)`. The file lands in `public/uploads/original` rather than `data/uploads/original`. In the running process, the startup guard has already run, so it does not catch the new file until restart. Depending on serving layer and environment, the original can be reachable under `/uploads/original/name.jpg`, or the next production boot fails closed because `assertNoLegacyPublicOriginalUploads()` sees a file in the legacy public original directory. Either outcome violates the private-originals architecture.

Suggested fix:

Do not integrate `@/lib/storage` until the keyspace explicitly models privacy domains. Map `original/*` to `UPLOAD_ORIGINAL_ROOT`, map derivative keys to `UPLOAD_ROOT`, and map `resources/*` to the resources root. Alternatively remove original support from the storage abstraction until the full upload/processing/serving pipeline is migrated. Add a storage test that writes `original/foo.jpg` and asserts the resolved file is under `UPLOAD_ORIGINAL_ROOT`, not `UPLOAD_ROOT/original`.

### ARCH-C11-RISK-02 - Browser and Lightroom uploads duplicate the same ingest pipeline instead of sharing an upload service

Severity: Medium
Confidence: High
Status: Risk; current behavior is heavily guarded, but the architecture is brittle

Evidence:

- Browser upload owns the full ingest sequence in `apps/web/src/app/actions/images.ts:114-612`: auth/origin, upload tracker, upload-processing contract lock, config snapshot, disk preflight, topic check, save original, HDR gate, GPS strip, late restore check, DB insert, tags, enqueue, audit, and revalidation.
- Lightroom upload independently reimplements the same sequence in `apps/web/src/app/api/admin/lr/upload/route.ts:62-531`.
- The LR route comments repeatedly call out parity with the browser path, for example filename validation at `apps/web/src/app/api/admin/lr/upload/route.ts:154-161`, contract locking at `apps/web/src/app/api/admin/lr/upload/route.ts:222-238`, disk preflight at `apps/web/src/app/api/admin/lr/upload/route.ts:256-284`, HDR gating at `apps/web/src/app/api/admin/lr/upload/route.ts:327-344`, GPS strip at `apps/web/src/app/api/admin/lr/upload/route.ts:346-359`, and enqueue snapshot parity at `apps/web/src/app/api/admin/lr/upload/route.ts:456-493`.
- The regression test is largely a source-text parity net because the route is expensive to exercise end-to-end: `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-16`, `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:166-174`, and `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:281-387`.

Failure scenario:

A future feature adds a new ingest invariant to `uploadImages()` such as a new processing setting snapshot, metadata column, privacy scrub, queue payload field, cleanup branch, or rate-limit rollback. Unless the author remembers to duplicate the same change in `/api/admin/lr/upload` and add another source-contract assertion, browser uploads and PAT uploads drift again. Prior comments in the LR route already document several such drift classes: HDR gate, GPS strip, ICC column, upload attribution, contract lock, disk preflight, quota settlement, and queue payload settings. The result can be path-dependent privacy behavior, inconsistent color processing, orphaned originals, missing attribution, or uploads that ignore admin settings on the primary non-browser ingest path.

Suggested fix:

Extract a server-only ingest orchestration service that accepts an authenticated actor, a file, sanitized metadata, a topic, client identity, and an auth mode, then owns the shared sequence once: quota claim/settle, upload-processing contract lock, strict config snapshot, disk preflight, save/original cleanup, metadata extraction, HDR/GPS policy, DB insert, enqueue payload, audit event hooks, and revalidation. Keep browser action and Lightroom route as thin adapters for auth, input parsing, response formatting, and i18n. Replace most source-text parity tests with behavior tests against the shared service and a small adapter contract for token-specific behavior.

## Final Missed-Issue Sweep

Final sweeps covered:

- Trust boundaries: server actions, API auth wrappers, same-origin ordering, public mutating route rate limits, and semantic/OG/share rollback patterns.
- Data/privacy boundaries: public/admin select shapes, map GPS opt-in, timeline/search enrichment mirrors, sensitive-key guards, and public route consumers.
- Upload/storage boundaries: browser upload, Lightroom upload, private original paths, legacy public original guard, derivative serving, static-vs-route upload serving, and storage quarantine.
- Runtime coordination: restore maintenance, DB/advisory locks, image queue, backfill runners, process-local maps/timers, upload tracker, shared-group view buffering, and single-instance assumptions.
- Schema/ops: migration journal/reconcile, Docker/nginx body-size and upload path policies, deploy persistence, sidecar scripts, CLIP model seeding and semantic mode gates.

No additional architect-level findings survived the final sweep beyond the four items above. I did not run full lint/typecheck/build/Vitest because this was a review-only artifact and no executable source changed. Validation performed for this artifact: `git diff --check -- .context/reviews/architect.md` passed after the markdown whitespace fix.
