# Debugger Review - Cycle 8

Date: 2026-07-07 KST
Reviewer lane: debugger
HEAD reviewed: `eca554146776`
Scope: latent bugs, failure modes, regressions, restore/upload/download races, route/server-action edge cases, generated assets, service worker, migration/reconcile, backup/restore, auth/session, i18n routing, and test blind spots.
Execution constraints honored: review-only; no fixes implemented; no commit, push, deploy, service stop, file removal, source mutation, or MySQL-container mutation. The only written file is this review artifact.

## Result Summary

- Confirmed defects: 1 High
- Likely/risk findings: 1 Medium
- Tests run: none. This lane stayed source-inspection only to avoid mutating the protected temporary MySQL container and because the requested output was a review artifact.

The strongest issue is a restore-window regression in `updatePassword()`: it acquires the admin mutation slot but checks the slot object for truthiness instead of checking `.acquired`, so a refused slot still proceeds into Argon2 work and the password/session transaction. That directly defeats the restore drain contract for this one server action.

## Inventory Built First

Read first:

- `AGENTS.md`
- `CLAUDE.md`
- code-review skill instructions at `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Repository inventory:

- Counted and narrowed the active app surface to about 903 relevant files under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, and `apps/web/public`, excluding dependency/build output.
- Counted 44 app route/page/layout/action entry files under `apps/web/src/app`.
- Inventoried route handlers: admin DB download, Lightroom upload, health/live, OG routes, semantic/similar search, feeds, and both upload route twins.
- Inventoried migrations: `apps/web/drizzle/0000_*.sql` through `0029_*.sql`, plus `apps/web/drizzle/meta/_journal.json`.
- Inventoried generated/static assets: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, icons, bundled resources, and upload fixture directories.
- Inventoried tests covering the relevant failure classes: auth/action-origin/API-auth lint tests, upload route tests, service-worker contracts, migration/reconcile tests, restore scanner tests, privacy guard tests, image queue/backfill tests, and Playwright public/admin flows.

Detailed areas inspected:

- Auth/session edge cases: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/request-origin.ts`.
- Restore/admin mutation fences: `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`.
- Upload/image processing failure paths: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`.
- Public route/cache behavior: `apps/web/src/lib/serve-upload.ts`, both `/uploads/[...path]` route twins, semantic/similar search routes, OG image routes, feed routes, health/live routes.
- Backup/restore/migration: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/scripts/migrate.js`, SQL restore scanner tests and migration source tests.
- i18n/routing/cache invalidation: `apps/web/src/proxy.ts`, `apps/web/src/i18n/request.ts`, `apps/web/src/lib/locale-path.ts`, `apps/web/src/lib/revalidation.ts`, public `[locale]` layouts/pages.
- Generated assets/service worker: `apps/web/public/sw.template.js`, `apps/web/public/sw.js`, `apps/web/scripts/build-sw.ts`; template versus generated output differs by expected `SW_VERSION` stamping only.

## Findings

### DBG-C8-01 - High - Password change proceeds when restore mutation slot is refused

Severity: High
Confidence: High
Validation: confirmed from source
Status: confirmed

Evidence:

- `acquireAdminMutationSlot()` always returns an object. When restore exclusive mode is active it returns `{ acquired: false, [Symbol.dispose]() { ... } }` at `apps/web/src/lib/admin-mutation-barrier.ts:76-80`.
- The same helper documents the required call-site check as `if (!mutationSlot.acquired)` at `apps/web/src/lib/admin-mutation-barrier.ts:69-75`.
- Most server actions follow that contract; `rg` found the only truthiness check at `apps/web/src/app/actions/auth.ts:309-312`.
- `updatePassword()` currently does:
  - same-origin and current-user checks at `apps/web/src/app/actions/auth.ts:291-303`
  - one restore-maintenance snapshot at `apps/web/src/app/actions/auth.ts:304-307`
  - `using mutationSlot = acquireAdminMutationSlot(); if (!mutationSlot) ...` at `apps/web/src/app/actions/auth.ts:309-312`
  - Argon2 verify/hash and the `admin_users`/`sessions` transaction at `apps/web/src/app/actions/auth.ts:381-416`
- Restore depends on refused new mutation slots after setting the durable marker and before import: it calls `drainAdminMutationsForRestore()` at `apps/web/src/app/[locale]/admin/db-actions.ts:550-562` and releases the exclusive side later at `apps/web/src/app/[locale]/admin/db-actions.ts:572-578`.
- Existing auth source coverage only asserts that the slot is acquired before expensive work/DB mutation; it does not assert the refused-slot branch. See `apps/web/src/__tests__/auth-mutation-barrier-source.test.ts:13-26`.

Failure scenario:

1. An admin submits a password change while no restore marker is active.
2. `updatePassword()` passes the one-time maintenance check at `apps/web/src/app/actions/auth.ts:304-307`.
3. A restore starts before line 309, sets the durable/process maintenance state, and activates the exclusive mutation barrier while preparing to import.
4. `acquireAdminMutationSlot()` returns an object with `acquired: false`.
5. `if (!mutationSlot)` is false because the object is truthy, so the action continues into rate-limit work, Argon2 verification/hash, and the password/session transaction.
6. The restore drain can believe new mutations are blocked, yet this action writes `admin_users.password_hash` and rotates `sessions` during or immediately around the restore import window. Depending on timing, the restored DB can end up with password/session state that did not come from either a clean pre-restore or clean post-restore state.

Why happy-path tests can pass:

- The barrier unit test correctly verifies refused slots expose `slot.acquired === false` at `apps/web/src/__tests__/admin-mutation-barrier.test.ts:41-48`.
- The auth source test only checks that the slot line appears before rate-limit, Argon2, and transaction work at `apps/web/src/__tests__/auth-mutation-barrier-source.test.ts:16-25`.
- There is no behavioral test that drives `updatePassword()` while the exclusive barrier is active and asserts it returns `restoreInProgress` without calling `argon2.verify`, `argon2.hash`, or `db.transaction`.

Suggested fix:

- Change `apps/web/src/app/actions/auth.ts:309-312` to check `if (!mutationSlot.acquired) return { error: t('restoreInProgress') };`.
- Add an auth action behavior test that activates `drainAdminMutationsForRestore()`, calls `updatePassword()` with otherwise-valid form/session mocks, and asserts no password verification, hash, transaction, cookie write, or audit write occurs.
- Consider a source-contract test that rejects `if (!mutationSlot)` in `auth.ts`, because this was the exact typo class.

### DBG-C8-02 - Medium - Upload route advertises range handling but always returns full-body 200 responses

Severity: Medium
Confidence: Medium
Validation: likely issue from source inspection
Status: likely

Evidence:

- Both upload route twins carry the public rate-limit exemption rationale that derivative serving is bounded by "range handling" at `apps/web/src/app/uploads/[...path]/route.ts:4` and `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:4`.
- The GET handlers pass only `If-None-Match`, method, and abort signal to `serveUploadFile()` at `apps/web/src/app/uploads/[...path]/route.ts:7-15` and `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:7-15`; the `Range` header is never forwarded.
- `serveUploadFile()` handles 304 and HEAD at `apps/web/src/lib/serve-upload.ts:268-302`, then opens the file and always sets full-file `Content-Length` at `apps/web/src/lib/serve-upload.ts:304-328`.
- The body response is always returned with default status 200 at `apps/web/src/lib/serve-upload.ts:365-369`; there is no `206 Partial Content`, `Content-Range`, `Accept-Ranges`, or `416 Range Not Satisfiable` path.
- Upload-serving tests cover GET, 304, HEAD, abort cleanup, directory/extension mismatches, and symlink containment, but `rg` found no `Range`, `Accept-Ranges`, or `Content-Range` coverage in `apps/web/src/__tests__/serve-upload.test.ts:41-260` or `apps/web/src/__tests__/uploads-route-method-wiring.test.ts:41-65`.

Failure scenario:

When a derivative is served through the route-handler fallback rather than Next's static file server, a browser/CDN/client that retries or resumes with `Range: bytes=...` receives a full 200 response. That can break resume semantics, waste bandwidth on large JPEG/AVIF derivatives, and diverge from the route comment and lint exemption rationale. The failure is easy to miss because ordinary image loads, HEAD probes, and ETag revalidation all pass.

Suggested fix:

- Either implement single-range support in `serveUploadFile()` and pass `request.headers.get('range')` from both route twins, or remove the "range handling" claim and explicitly decide that the fallback route does not support partial content.
- If implemented, add tests for satisfiable range, suffix range, invalid/multiple range, conditional 304 precedence, HEAD with range, and abort cleanup on a partial stream.

## Final Sweep

No additional confirmed findings after reviewing these areas:

- Browser upload path: `uploadImages()` checks same-origin, restore maintenance, admin mutation slot, current user, upload contract lock, disk space, topic existence, per-file failures, late restore cleanup, upload tracker settlement, and post-commit revalidation/audit boundaries in `apps/web/src/app/actions/images.ts:129-624`.
- Delete/update image actions: single and bulk deletion hold mutation slots, handle strict cleanup failures as explicit user-visible failures, and revalidate narrow or broad paths in `apps/web/src/app/actions/images.ts:655-923`.
- Lightroom upload path: token/cookie auth, content-length/chunked rejection, quota preclaim/settlement, multipart parse slot, upload contract lock, HDR gate, GPS original stripping, late restore cleanup, DB insert containment, enqueue/audit/revalidate post-commit behavior in `apps/web/src/app/api/admin/lr/upload/route.ts:84-611`.
- Queue processing: advisory claim, original resolution, restore-maintenance checks, derivative verification, retry/permanent-failure tracking, side-effect draining, bootstrap resume, and orphan temp cleanup in `apps/web/src/lib/image-queue.ts:373-1240`.
- Image processing: original save cleanup, RAW rejection, color/HDR metadata extraction, atomic derivative writes, backup/rollback cleanup, non-empty derivative verification, and restore sidecar guards in `apps/web/src/lib/process-image.ts:887-1485`.
- Backup/restore: backup dump validation, temp permissions, child-process watchdogs, SQL scan/trailer checks, post-restore migrations, lock release, maintenance retention on failure, and queue resume behavior in `apps/web/src/app/[locale]/admin/db-actions.ts:166-939`.
- Migration/reconcile: journal baselining guards, pending-tail handling, DML-baseline refusal, full-schema reconcile, migration postcondition hash check, and admin seeding in `apps/web/scripts/migrate.js:348-1034`.
- Auth/API wrappers: token scope handling, same-origin cookie auth, token rate-limit attempts, no-store/nosniff defaults, and request origin trust in `apps/web/src/lib/api-auth.ts:1-145` and `apps/web/src/lib/request-origin.ts:1-109`.
- Public semantic/similar routes: restore gates, same-origin checks, content-length enforcement, JSON shape checks, rate-limit pre-increment, query/body caps, no-store headers, and failure responses in `apps/web/src/app/api/search/semantic/route.ts:1-369` and `apps/web/src/app/api/search/similar/[id]/route.ts:1-286`.
- OG/feed/health routes: restore-maintenance fast paths, no-store on errors, rate-limit placement, fallback responses, and cache validators inspected in `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/app/feed.xml/route.ts`, and localized feed routes.
- i18n/proxy/routing: locale prefix enforcement, admin route protection, CSP nonce injection, admin-render cache marker, and not-found maintenance guards in `apps/web/src/proxy.ts`, `apps/web/src/i18n/request.ts`, and localized public layouts.
- Generated assets/service worker: `public/sw.js` is regenerated from `public/sw.template.js` with the expected stamped version; image cache HEAD revalidation, HTML-cache admin exclusions, and offline fallback routing were inspected.
- Tests: current tests cover many previously reported races, but the auth refused-slot branch and upload range semantics are not covered.

Residual risks:

- This was a source review, not a runtime or browser-flow run. Child-process restore event orderings and deployment proxy/body-size behavior still deserve behavioral validation in their own lanes.
- I did not run tests or commands that could touch the protected MySQL container.
