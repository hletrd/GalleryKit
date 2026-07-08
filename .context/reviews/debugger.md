# Cycle 36 Debugger Review

Role lane: debugger review worker
Date: 2026-07-08 KST
Repository: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `40b7720cade239c407288a7426663d6038c05476`
Status: review-only. Production code was not edited.

## Inventory First

Required guidance read before source review: `AGENTS.md`, `CLAUDE.md`, and the prior cycle artifacts only as baseline context.

Bug/regression/failure-mode inventory reviewed:

- Recent cycle35 diff: `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/components/search.tsx`, `apps/web/nginx/default.conf`, related tests.
- Upload and quota settlement: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`.
- Restore and maintenance drain: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance*`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/maintenance-scheduler.ts`.
- Advisory lock lifecycle: `apps/web/src/lib/advisory-locks.ts`, `apps/web/src/lib/advisory-lock-release.ts`, topic route lock usage, admin-delete locks, backfill locks, DB restore locks.
- Async/background runners: `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/lib/image-queue.ts`, CLIP semantic routes, pending file deletions.
- Data consistency and public reads: `apps/web/src/lib/data.ts`, shared links/groups, map GPS opt-in, public search/load-more and feed routes.
- Failure evidence tests: topic action tests, semantic/similar route tests, upload/serve-upload tests, backup/restore tests, lint gates.

## Findings

No confirmed or likely current latent bug/regression findings were identified in this cycle.

### Manual-Validation Risk: Live nginx reload/topology can drift from repo failure-mode assumptions

- Severity: Medium
- Confidence: High for source evidence; manual validation required for live state.
- Classification: Manual-validation risk.
- File / region:
  - `apps/web/nginx/default.conf:20-28` warns that limiter keys are the nginx TCP peer unless real-IP/PROXY-protocol is configured.
  - `apps/web/nginx/default.conf:59-71` warns that the shipped `X-Forwarded-For $remote_addr` topology is correct only when the nginx peer is the real client.
  - `apps/web/nginx/default.conf:291-294` says normal deploys do not apply this file and an operator must manually test/reload nginx.
- Concrete failure scenario: a cycle changes nginx limiter behavior or an operator inserts a CDN/LB in front of nginx, then only `npm run deploy` is run. The container updates but the host nginx config stays stale or still sees the LB as every visitor. App behavior remains correct in source, but production failure modes differ: public SSR throttling may be absent, and per-IP budgets may collapse all users into one bucket.
- Suggested fix: add an operational verification step that captures live nginx `nginx -T` output or a config checksum after reload and compares it with the repo template for security-relevant blocks. For non-direct-client topologies, explicitly validate real-IP extraction and `TRUSTED_PROXY_HOPS` with a request carrying a known forwarded chain.

## Regression Checks / Non-Findings

- Prior cycle35 debugger finding is fixed: `apps/web/src/app/actions/topics.ts:690-723` now wraps `setTopicMapVisible(...)` in `withTopicRouteMutationLock(...)`, so it serializes with slug rename/create/delete route mutations.
- Topic rename state preservation remains intact: `apps/web/src/app/actions/topics.ts:287-372` reads the authoritative row inside the transaction and route lock, carries `map_visible`, rewrites image/topicAlias/topicView children, remaps smart-collection topic predicates, then deletes the old slug.
- Upload browser path quota settlement: `apps/web/src/app/actions/images.ts:217-227` claims quota before awaits; `apps/web/src/app/actions/images.ts:232-279` rolls back disk/topic failures; `apps/web/src/app/actions/images.ts:326-548` handles per-file cleanup; `apps/web/src/app/actions/images.ts:555-608` settles actual successes before returning.
- Lightroom upload path quota/original cleanup: `apps/web/src/app/api/admin/lr/upload/route.ts:143-180` claims and creates idempotent settlement; `apps/web/src/app/api/admin/lr/upload/route.ts:300-394` rolls back topic/config/storage/save failures; `apps/web/src/app/api/admin/lr/upload/route.ts:420-465` deletes originals and settles quota for HDR/GPS/restore rejection before insert.
- Restore path failure modes: `apps/web/src/app/[locale]/admin/db-actions.ts:789-1027` owns temp-file cleanup until child-process handoff, keeps maintenance on restore/import/migration failure, sanitizes stderr, and runs post-restore migrations before success.
- Advisory lock lifecycle: `apps/web/src/lib/advisory-lock-release.ts:47-57` destroys pooled connections on ambiguous `GET_LOCK` failure; `apps/web/src/lib/advisory-lock-release.ts:64-108` destroys rather than releases if any `RELEASE_LOCK` fails. Topic/backfill/restore callers use this shared release discipline.
- Backfill runner lifecycle: `apps/web/src/lib/admin-backfill-runner.ts:681-948` puts state mutation, config read, queue construction, queue drain, lock release, and connection lifetime under one runner ownership path; candidate-count zero releases immediately.
- Public semantic/similar routes: `apps/web/src/app/api/search/semantic/route.ts:107-369` and `apps/web/src/app/api/search/similar/[id]/route.ts:68-286` check origin/maintenance, pre-increment rate limits before DB-backed protected work, guard body/id shape, handle aborts, and share compile-guarded result enrichment fields.
- Public upload serving: `apps/web/src/lib/serve-upload.ts:162-384` closes handles on errors, avoids opening fds for HEAD/304, uses fd-stat for GET body consistency, and destroys streams on client abort.
- Privacy/map consistency: `apps/web/src/lib/data.ts:1777-1817` keeps the public GPS query behind `topics.map_visible = true` plus a runtime assertion.

## Validation Evidence

- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- `npm test --workspace=apps/web -- --run src/__tests__/tracked-secrets.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/request-origin.test.ts src/__tests__/serve-upload.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/sql-restore-scan.test.ts src/__tests__/topics-actions.test.ts src/__tests__/semantic-search-route.test.ts src/__tests__/similar-route.test.ts`: passed, 9 files / 139 tests.
- `npm run audit:prod`: passed, 0 production dependency vulnerabilities at `moderate`.

## Final Missed-Issue Sweep

Final sweep covered recent diffs, all route handlers, all server-action guard surfaces, public route exemptions, upload quota settlement, original-file cleanup, path containment, restore temp-file/child-process cleanup, advisory lock release and acquire-error paths, background runner finalizers, DB restore scanner edge cases, privacy select guards, semantic/similar search abort/error branches, nginx topology assumptions, and tracked-secret patterns.

Skipped or limited areas: generated output, `node_modules`, binary fixtures, archived screenshots, and local secret values in untracked env files. No product code was changed.
