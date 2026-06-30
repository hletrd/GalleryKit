# Cycle 40 Code / Architecture / Debugger Review

Reviewer lane: code quality, architecture, latent correctness bugs, and debugger-style failure modes.

Result: no new actionable findings in this lane.

## Scope and Baseline

- Read `AGENTS.md` and `CLAUDE.md` before inspecting code paths.
- Used the current aggregate baseline in `.context/reviews/_aggregate.md:3`, which points at cycle 39.
- Excluded the already scheduled cycle-39 items listed in `.context/reviews/_aggregate.md:5` through `.context/reviews/_aggregate.md:11`.
- Excluded the deferred cycle-39 items in `.context/plans/cycle-39-2026-06-30-deferred.md:3`, `.context/plans/cycle-39-2026-06-30-deferred.md:9`, `.context/plans/cycle-39-2026-06-30-deferred.md:15`, and `.context/plans/cycle-39-2026-06-30-deferred.md:21`.

## Inventory

- Repository code inventory sampled for this pass: 519 TypeScript/TSX files under `apps/web/src`, 12 app route files, and 282 files under `apps/web/src/__tests__`.
- Security and route lint surfaces inspected:
  - `apps/web/scripts/check-api-auth.ts`
  - `apps/web/scripts/check-action-origin.ts`
  - `apps/web/scripts/check-public-route-rate-limit.ts`
  - `apps/web/src/lib/api-auth.ts`
- High-risk runtime and failure-mode surfaces inspected:
  - `apps/web/src/app/api/admin/lr/upload/route.ts`
  - `apps/web/src/app/api/search/semantic/route.ts`
  - `apps/web/src/app/api/search/similar/[id]/route.ts`
  - `apps/web/src/app/[locale]/admin/db-actions.ts`
  - `apps/web/src/lib/image-queue.ts`
  - `apps/web/src/lib/background-db-writes.ts`
  - `apps/web/src/lib/data.ts`
  - `apps/web/scripts/migrate.js`

## Evidence

- `npm run lint:api-auth --workspace=apps/web` passed. It currently verifies both admin API routes, including the Lightroom upload route.
- `npm run lint:action-origin --workspace=apps/web` passed. It verifies the top-level action barrel and all mutating server action exports.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed. It verifies public mutating routes and expensive `GET`/`HEAD` handlers, including OG and semantic routes.
- The action-origin scanner recursively discovers `app/actions/`, admin `db-actions.ts`, and the top-level action barrel at `apps/web/scripts/check-action-origin.ts:78` through `apps/web/scripts/check-action-origin.ts:108`.
- The action-origin scanner rejects pre-origin side effects/auth reads before the guard and requires the guard branch to exit before side effects at `apps/web/scripts/check-action-origin.ts:671` through `apps/web/scripts/check-action-origin.ts:688`.
- The public route scanner treats `GET` and `HEAD` as expensive-read methods at `apps/web/scripts/check-public-route-rate-limit.ts:37` through `apps/web/scripts/check-public-route-rate-limit.ts:44`, and checks for expensive work before a rate-limit gate at `apps/web/scripts/check-public-route-rate-limit.ts:399` through `apps/web/scripts/check-public-route-rate-limit.ts:445`.
- Admin API auth runs the token scope path before cookie same-origin auth and applies no-store/nosniff response headers on both token and cookie paths at `apps/web/src/lib/api-auth.ts:68` through `apps/web/src/lib/api-auth.ts:142`.
- The Lightroom upload route is pinned to Node runtime, checks restore maintenance and upload size before parsing, bounds multipart parsing concurrency, and settles upload tracker claims on failure paths at `apps/web/src/app/api/admin/lr/upload/route.ts:76` through `apps/web/src/app/api/admin/lr/upload/route.ts:186`.
- The Lightroom upload route serializes upload-setting changes, checks disk space using `bavail`, handles RAW/HDR/GPS/restore races, and cleans up originals before insert on rejected post-save paths at `apps/web/src/app/api/admin/lr/upload/route.ts:275` through `apps/web/src/app/api/admin/lr/upload/route.ts:429`.
- Public semantic search performs same-origin, maintenance, content-type, content-length, chunked-transfer, abort, and rate-limit gates before DB-backed semantic-mode work at `apps/web/src/app/api/search/semantic/route.ts:107` through `apps/web/src/app/api/search/semantic/route.ts:184`.
- Similar-photo search is production-only, same-origin guarded, rate-limited before DB config work, and bounded by `SEMANTIC_SCAN_LIMIT` at `apps/web/src/app/api/search/similar/[id]/route.ts:68` through `apps/web/src/app/api/search/similar/[id]/route.ts:180`.
- Restore preparation flushes buffered shared-group view counts, quiesces the image queue, drains tracked background DB writes, and resumes/clears maintenance in the `finally` path at `apps/web/src/app/[locale]/admin/db-actions.ts:492` through `apps/web/src/app/[locale]/admin/db-actions.ts:541`.
- Background DB writes are tracked and drained until no in-flight writes remain at `apps/web/src/lib/background-db-writes.ts:3` through `apps/web/src/lib/background-db-writes.ts:32`.
- The image-processing queue reclaims duplicate-claim retry state, verifies derivative files before marking rows processed, and cleans up generated variants if a row is deleted during processing at `apps/web/src/lib/image-queue.ts:540` through `apps/web/src/lib/image-queue.ts:700`.
- Public shared-photo and shared-group queries document and enforce omission of sensitive fields such as coordinates, original filenames, and user filenames at `apps/web/src/lib/data.ts:1197` through `apps/web/src/lib/data.ts:1238` and `apps/web/src/lib/data.ts:1267` through `apps/web/src/lib/data.ts:1311`.
- `reconcileLegacySchema` mirrors current image-processing, HDR/color, retry-diagnostic, processing-settings, AVIF bit-depth, shared-group, and rate-limit tables/columns at `apps/web/scripts/migrate.js:317` through `apps/web/scripts/migrate.js:560`.

## Findings

No new actionable findings.

The reviewed high-risk paths showed existing guards for the failure classes this lane targeted: missing admin auth, missing action origin guards, unmetered expensive public API reads, upload quota leaks on error, restore-vs-background-write races, image-processing completion races, public privacy field leaks, and legacy-schema drift. The targeted lint gates passed and the inspected implementation paths aligned with the project contracts in `AGENTS.md` and `CLAUDE.md`.

## Residual Risk

- I did not run the full `npm run typecheck --workspace=apps/web`, `npm run build --workspace=apps/web`, or `npm test --workspace=apps/web` suite in this review lane.
- The cycle-39 deferred items remain deferred rather than newly re-raised here: schema index planning for feed/sitemap and backfill scans, broader imported-helper side-effect classification, and sidecar keyset pagination.
