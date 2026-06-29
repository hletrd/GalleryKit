# Cycle 13 Tracer Review

Mode: read-only causal tracing review. I did not modify production code. This report is the only intended write.

## Scope And Method

I read `AGENTS.md` and `CLAUDE.md` first, then built a trace inventory with `rg --files` while excluding `node_modules`, `.git`, build output, test output, and runtime upload/data directories. I traced the requested flows end to end across file boundaries:

- user input -> DB/files through admin actions, admin APIs, public actions, rate limits, auth/session, and origin checks
- uploads -> tracker/preclaim -> original save -> metadata/GPS stripping -> DB insert -> queue processing -> derivative serving
- auth/session -> middleware/proxy -> server actions -> admin API wrappers
- backup/restore/deploy -> advisory locks -> restore maintenance -> queue quiesce -> migrations
- public share/search/analytics -> privacy-shaped selects -> durable/best-effort analytics -> cache behavior
- cache/service worker -> HTML/image routing -> revocation/deletion/stale fallback behavior
- async queues/side effects -> tracked queue work, captions, embeddings, rollback/cleanup paths

## Review-Relevant Inventory

Representative files traced:

- Upload, processing, DB persistence, retry, and serving: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/uploads/[...path]/route.ts`, `apps/web/next.config.ts`.
- Auth, sessions, admin actions, admin APIs, and public mutations: `apps/web/src/proxy.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/action-origin.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/app/actions/collections.ts`, `apps/web/src/app/actions/lr-tokens.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/actions/seo.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/tags.ts`, `apps/web/src/app/actions/topics.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`.
- Public sharing, search, analytics, cache, and privacy-shaped data: `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/lib/analytics.ts`, `apps/web/src/lib/analytics-data.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/revalidation.ts`, `apps/web/src/lib/sw-cache.ts`, `apps/web/src/components/register-service-worker.tsx`, `apps/web/public/sw.template.js`, `apps/web/public/sw.js`.
- Backup, restore, migration, schema, and deploy: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/queue-shutdown.ts`, `apps/web/src/lib/advisory-locks.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, `apps/web/src/db/schema.ts`, `apps/web/deploy.sh`, `apps/web/scripts/deploy-remote.sh`, `apps/web/scripts/entrypoint.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`.

## Confirmed Issues

### C13-TRC-01 - Service worker admin-route bypass misses unlocalized admin routes

Severity: Low
Confidence: High
Status: Confirmed

Code region:

- `apps/web/public/sw.template.js:42-46`
- `apps/web/public/sw.template.js:296-318`
- `apps/web/public/sw.template.js:382-397`
- `apps/web/src/lib/sw-cache.ts:54-62`
- `apps/web/src/proxy.ts:65-72`
- `apps/web/src/proxy.ts:90-100`
- `apps/web/src/proxy.ts:120-129`
- `apps/web/src/__tests__/sw-cache.test.ts:47-71`
- `apps/web/src/__tests__/sw-template-contract.test.ts:71-80`

Concrete failure scenario:

1. The service worker states that admin routes always bypass network caching, but `isAdminRoute()` matches only locale-prefixed admin paths and `/api/admin` (`apps/web/public/sw.template.js:42-46`). It does not match `/admin`, `/admin/`, or `/admin/dashboard`.
2. The fetch handler bypasses only paths accepted by `isAdminRoute()` (`apps/web/public/sw.template.js:382-383`). Unlocalized admin HTML then falls through to `networkFirstHtml()` (`apps/web/public/sw.template.js:395-397`).
3. `networkFirstHtml()` caches any `ok` HTML response unless the response carries `x-gk-admin-render: 1` (`apps/web/public/sw.template.js:296-318`).
4. The proxy treats default-locale admin subroutes as protected (`apps/web/src/proxy.ts:65-72`) and redirects missing or malformed sessions to `/admin` (`apps/web/src/proxy.ts:90-100`). It only sets `x-gk-admin-render` when an `admin_session` cookie is present (`apps/web/src/proxy.ts:120-129`).
5. Result: unauthenticated default-locale admin/login HTML and possibly redirect-followed admin HTML can be cached under unlocalized admin URLs. This does not prove sensitive admin data leakage because authenticated admin renders are marked with `x-gk-admin-render`, but it violates the documented admin no-cache boundary and can produce stale/offline admin surfaces where the service worker contract says there should be none.

Validation evidence:

- The source-equivalent helper has the same omission (`apps/web/src/lib/sw-cache.ts:54-62`).
- Existing tests cover `/en/admin/`, `/ko/admin/settings`, and `/api/admin/db`, but not `/admin`, `/admin/`, or `/admin/dashboard` (`apps/web/src/__tests__/sw-cache.test.ts:47-71`).
- The template contract test verifies revocable share/map bypass order, not unlocalized admin bypass (`apps/web/src/__tests__/sw-template-contract.test.ts:71-80`).
- A direct regex spot-check returned `false` for `/admin`, `/admin/`, and `/admin/dashboard`, and `true` for `/en/admin`, `/en/admin/dashboard`, and `/api/admin/db`.

Suggested fix:

Add a default-locale admin branch to both service-worker route helpers, for example `^/admin(/|$)`, while keeping `/administrator` excluded. Regenerate `apps/web/public/sw.js` from `apps/web/public/sw.template.js`, then add tests for `/admin`, `/admin/`, and `/admin/dashboard` in `sw-cache.test.ts` plus a template contract assertion that admin bypass still precedes HTML caching.

## Likely Issues

None. I did not find an unconfirmed-but-probable traced-flow failure beyond the confirmed issue above and the hardening risks below.

## Risks Needing Manual Validation

### C13-TRC-RISK-01 - Similar-search target lookup trusts embedding existence instead of current image visibility

Severity: Low
Confidence: Medium
Status: Risk needing manual validation

Code region:

- `apps/web/src/app/api/search/similar/[id]/route.ts:74-83`
- `apps/web/src/app/api/search/similar/[id]/route.ts:115-139`
- `apps/web/src/app/api/search/similar/[id]/route.ts:198-205`
- `apps/web/src/lib/image-queue.ts:653-657`
- `apps/web/src/lib/image-queue.ts:697-742`
- `apps/web/scripts/backfill-clip-embeddings.ts:126-142`
- `apps/web/src/db/schema.ts:280-282`

Concrete failure scenario:

The similar-photo API validates the route id as a positive integer (`apps/web/src/app/api/search/similar/[id]/route.ts:74-83`), then loads the target vector directly from `image_embeddings` by `image_id` and production model version (`apps/web/src/app/api/search/similar/[id]/route.ts:115-139`). It does not join `images` or require the target image to be currently `processed = true`. The later enrichment query filters returned neighbors to processed images (`apps/web/src/app/api/search/similar/[id]/route.ts:198-205`), but that filter is not applied to the target image used to seed the similarity search.

I did not confirm a live exploit path in current normal writers. Queue processing marks `processed=true` before the embedding side effect (`apps/web/src/lib/image-queue.ts:653-657`, `apps/web/src/lib/image-queue.ts:697-742`), the backfill selects only processed images (`apps/web/scripts/backfill-clip-embeddings.ts:126-142`), and the embedding row cascades on image delete (`apps/web/src/db/schema.ts:280-282`). The risk is a state-inconsistency/future-code/restore-manual-edit case: if an embedding row exists for an unprocessed, hidden, or otherwise non-public target, the route can still use that target vector and return related public photos, confirming the target id has a production embedding.

Suggested fix:

Harden the target lookup by joining `images` and requiring `images.id = image_embeddings.image_id` plus `images.processed = true` before decoding the target vector. Consider centralizing route-id parsing for photo-like ids and rejecting values outside the schema integer range with `Number.isSafeInteger` and a MySQL `INT` max check.

### C13-TRC-RISK-02 - Realpath-before-stream comments overstate TOCTOU closure for local file reads

Severity: Low
Confidence: Medium
Status: Risk needing manual validation

Code region:

- `apps/web/src/app/api/admin/db/download/route.ts:43-75`
- `apps/web/src/lib/serve-upload.ts:175-265`

Concrete failure scenario:

The backup download route validates filename shape, checks containment, `lstat`s the selected file, resolves the real path, and then streams from the resolved path (`apps/web/src/app/api/admin/db/download/route.ts:43-75`). The comment says this closes the symlink replacement race (`apps/web/src/app/api/admin/db/download/route.ts:72-75`). The upload-serving helper follows the same broad pattern: `lstat`, `realpath`, containment, then stream/stat work on the resolved path (`apps/web/src/lib/serve-upload.ts:175-265`).

Streaming from the resolved path does prevent replacing the original path with a symlink after validation. It does not fully close every local TOCTOU class: a same-host actor with write access to the validated directory could replace the already-resolved regular file path between validation/stat and open, or change the file after `stats.size`/ETag metadata is computed. I did not identify a remote web path that gives an attacker that filesystem capability; this is a local deployment-integrity risk and a comment/assumption risk, not a confirmed remote vulnerability.

Suggested fix:

If these directories are ever writable by more than the trusted app/deploy user, open files with no-follow semantics and stream from the opened file descriptor after `fstat`, or otherwise make the single-writer filesystem assumption explicit in comments. At minimum, soften the comments so future reviewers do not treat realpath-before-open as a complete TOCTOU closure.

## Flow Trace Notes And Ruled-Down Hypotheses

Upload -> processing -> DB -> serving:

- Browser upload checks restore maintenance, same-origin admin, admin user, file metadata, rate limits, upload tracker quota, disk space, topic existence, original save, metadata extraction, GPS cleanup, DB insert, queue enqueue, audit, and revalidation in one guarded path (`apps/web/src/app/actions/images.ts:114-612`).
- Lightroom upload mirrors the same causal chain through token/cookie auth, upload tracker preclaim, topic existence before save, upload-processing contract lock, disk precheck, original save, HDR/GPS handling, DB insert, queue enqueue, and rollback cleanup (`apps/web/src/app/api/admin/lr/upload/route.ts:62-531`).
- Queue processing claims a per-image advisory lock, rechecks that the row remains unprocessed, generates variants, conditionally marks `processed=true`, and deletes generated variants if the row disappeared during processing (`apps/web/src/lib/image-queue.ts:519-675`).
- Serving validates derivative path structure, rejects symlinks/non-files, verifies realpath containment, and builds cache validators from pipeline version, file stats, and settings hash (`apps/web/src/lib/serve-upload.ts:127-296`).
- Ruled down: upload/settings race. Upload and byte/privacy-impacting settings changes share the upload-processing contract lock (`apps/web/src/app/actions/images.ts:175-190`, `apps/web/src/app/api/admin/lr/upload/route.ts:222-238`, `apps/web/src/app/actions/settings.ts:68-166`).
- Ruled down: delete while processing leaves orphan variants. The queue conditionally updates the row and full-scan deletes generated variants when the DB row is gone; admin delete also scans variant directories instead of only configured sizes (`apps/web/src/lib/image-queue.ts:653-675`, `apps/web/src/app/actions/images.ts:687-697`).

Auth/session -> actions/routes:

- Admin API routes are route-locally wrapped with `withAdminAuth`; API auth enforces token scope for PAT auth and origin checks for cookie auth (`apps/web/src/lib/api-auth.ts:55-139`).
- Mutating server actions use same-origin admin guards or explicit public/read exemptions. Public mutating routes use pre-increment rate limit helpers where scanned.
- The proxy protects admin page rendering while intentionally leaving API routes to route-local auth wrappers (`apps/web/src/proxy.ts:52-140`).

Restore/deploy/async queues:

- Restore acquires DB-scoped restore/upload/backfill locks, enters process-local restore maintenance, quiesces the local queue, performs restore/import/migration, and resumes in `finally` paths (`apps/web/src/app/[locale]/admin/db-actions.ts:291-399`).
- Queue bootstrap/retry paths check restore maintenance and DB locks before enqueue/processing; side effects are tracked so shutdown/restore can drain them (`apps/web/src/lib/image-queue.ts:489-506`, `apps/web/src/lib/image-queue.ts:1035-1089`).
- The main remaining assumption is the documented single web-process topology. I did not mark this as a finding because `CLAUDE.md` makes the single-writer deployment model explicit, but scale-out would require shared restore-maintenance state or a runtime guard.

Public share/search/analytics/cache:

- Public share and group reads resolve by secret keys and use public/privacy-shaped selects. Public analytics recording is guarded by rate limits and existence/expiry checks.
- Revocable share, collection/group, smart collection, and map HTML routes are now bypassed from the service worker HTML fallback path (`apps/web/public/sw.template.js:61-65`, `apps/web/public/sw.template.js:391-397`), so I did not carry forward stale-share-HTML hypotheses from older reviews.
- Image derivatives still intentionally use stale-while-revalidate caching; I did not find a new defect in the current deletion/revalidation code beyond the existing design tradeoff that cached image bytes can persist client-side after a prior authorized/public view.

Final missed-issue sweep:

- Checked async side-effect tracking, queue restore gates, rollback cleanup after save/insert/enqueue failures, public rate-limit rollback paths, SW route classification, privacy select helpers, backup/restore lock ordering, migration journal constraints, and local file containment patterns.
- No production code was changed. I did not run the full test suite for this artifact-only review; validation was by source tracing, targeted grep inventory, and the regex spot-check described above.
