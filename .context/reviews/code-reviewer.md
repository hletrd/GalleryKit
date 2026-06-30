# Code Reviewer Report - Cycle 20

Review role: code-reviewer  
Repository: `/Users/hletrd/flash-shared/gallery`  
HEAD reviewed: `24c82c71` on `master`  
Implementation files edited: none

## Summary

- Confirmed issues: 1
- Likely issues: 1
- Risks needing validation: 0
- Severity mix: 0 critical, 0 high, 2 medium, 0 low
- Recommendation: COMMENT / non-blocking maintainability and analytics-correctness fixes

## Inventory Reviewed

Read first: `AGENTS.md`, `CLAUDE.md`, and the existing `.context/reviews/code-reviewer.md` cycle-20 artifact.

Relevant inventory built before the review:

- App/router/server actions/API: 76 TypeScript/TSX files under `apps/web/src/app`.
- Shared library layer: 97 files under `apps/web/src/lib`.
- UI/component layer: 57 files under `apps/web/src/components`.
- Tests and e2e coverage: 271 TypeScript/TSX files under `apps/web/src/__tests__` and `apps/web/e2e`.
- Largest/high-risk implementation files examined directly: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/migrate.js`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/app/api/admin/lr/upload/route.ts`.
- Schema/migrations/contracts: `apps/web/src/db/schema.ts`, `apps/web/drizzle/**`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, migration/reconcile tests.
- Build/deploy/runtime/docs: root `package.json`, `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`, root `README.md`, `apps/web/README.md`, `CLAUDE.md`.
- Privacy/security/static contract surfaces: auth/origin/rate-limit scanners, public select fields, semantic/similar route enrichment selects, service-worker template, OG routes, upload-path and storage helpers.

Validation evidence:

- `npm run lint:api-auth --workspace=apps/web`: passed.
- `npm run lint:action-origin --workspace=apps/web`: passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- `npm run lint --workspace=apps/web`: passed.
- `npm test --workspace=apps/web -- migration-journal.test.ts migration-journal-monotonicity.test.ts migrate-reconcile-coverage.test.ts privacy-fields.test.ts search-route-privacy.test.ts lr-upload-hdr-gate.test.ts image-queue-settings-wiring.test.ts`: 7 files, 125 tests passed.
- External behavior reference checked for finding CR20-CR-02: official Next.js docs say `router.prefetch()` warms routes and that prefetch flows use `next-router-prefetch` / `_rsc` RSC payload requests: <https://nextjs.org/docs/app/guides/prefetching>, <https://nextjs.org/docs/app/guides/cdn-caching>.

## Confirmed Issues

### CR20-CR-01 - Upload ingest orchestration is duplicated across browser, Lightroom, and retry paths

Severity: Medium  
Confidence: High  
Status: Confirmed  
Category: Maintainability / cross-file contract drift

Evidence:

- Browser upload validates auth/input, acquires the upload-processing contract lock, snapshots gallery config, and builds quota state in `apps/web/src/app/actions/images.ts:114-190`.
- Browser upload repeats disk/topic preconditions and quota rollback handling in `apps/web/src/app/actions/images.ts:244-292`.
- Browser upload saves originals, gates HDR, strips GPS, handles restore maintenance, assembles DB insert values, stores `processing_settings_json`, and manually builds the queue job in `apps/web/src/app/actions/images.ts:340-531`.
- Retry processing builds a parallel queue-job payload in `apps/web/src/app/actions/images.ts:1227-1280`.
- The Lightroom route explicitly promises identical upload infrastructure reuse in `apps/web/src/app/api/admin/lr/upload/route.ts:15-18`, but implements its own parallel topic check, contract lock, config snapshot, disk check, save-original, HDR/GPS/restore gates, insert values, and queue job in `apps/web/src/app/api/admin/lr/upload/route.ts:225-275`, `apps/web/src/app/api/admin/lr/upload/route.ts:307-452`, and `apps/web/src/app/api/admin/lr/upload/route.ts:479-516`.
- The shared source of truth for processing settings is narrower than the ingest workflow: `ProcessingSettingsSnapshot` and `createProcessingSettingsSnapshot` live in `apps/web/src/lib/image-queue.ts:92-120`, but every adapter manually forwards the fields into `ImageProcessingJob`.
- Existing regression tests show this drift class has already happened: `apps/web/src/__tests__/image-queue-settings-wiring.test.ts` locks processing-settings forwarding, and `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts` locks Lightroom parity for HDR/GPS/settings behavior.

Problem:

The product has at least three upload-entry orchestration copies. They share helpers for selected substeps, but the actual save -> policy gates -> insert -> enqueue transaction shape is duplicated. This violates the route comment's "identical" contract and makes future settings/privacy/metadata changes rely on remembering every adapter and retry path.

Concrete failure scenario:

A future change adds a new upload-time setting, metadata column, privacy gate, or queue-job field. The browser action gets updated, but the Lightroom PAT route or retry path misses the field. Browser uploads, Lightroom uploads, and retried failed images then encode different bytes or persist different admin-only metadata for the same input. This is not hypothetical; the repo already carries tests and comments for prior drift in processing settings, Lightroom HDR gating, GPS stripping, and caption inputs.

Suggested fix:

Extract a server-only ingest service, for example `apps/web/src/lib/upload-ingest.ts`, that owns the shared workflow:

- Contract lock acquisition and release.
- Strict gallery-config snapshot creation plus serialization.
- Save-original, HDR, GPS-strip, restore-maintenance, and disk-space gates.
- DB insert-value construction for image rows.
- Queue-job construction through one typed builder from `ProcessingSettingsSnapshot`.

Keep `uploadImages` and `/api/admin/lr/upload` as thin adapters for auth, body parsing, localized response shape, tag handling, audit, and revalidation. Add a compile-time or unit-test guard that fails when `ProcessingSettingsSnapshot` gains a field not forwarded to `ImageProcessingJob`, and route-level tests proving both adapters call the same ingest builder.

## Likely Issues

### CR20-CR-02 - View analytics writes can be triggered by server-rendered prefetches

Severity: Medium  
Confidence: Medium  
Status: Likely  
Category: Logic / analytics correctness / cross-file interaction

Evidence:

- Photo views are recorded during the server page render, before client navigation is committed, in `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:154-156`.
- Topic views are recorded during server render in `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:163-164`.
- Shared-group views are recorded during server render in `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:127-132`.
- The recorders read request headers, rate-limit by IP, validate visibility, and insert durable analytics rows in `apps/web/src/app/actions/public.ts:371-391`, `apps/web/src/app/actions/public.ts:398-421`, and `apps/web/src/app/actions/public.ts:429-456`.
- The photo UI intentionally prefetches adjacent photo routes via idle `router.prefetch(...)` in `apps/web/src/components/photo-viewer.tsx:238-264`.
- The photo navigation also prefetches on hover in `apps/web/src/components/photo-navigation.tsx:220-242`.
- The server photo page renders hidden adjacent-photo links with `prefetch={true}` in `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:284-292`.
- A repo search found no recorder guard for `next-router-prefetch`, RSC, or prefetch-specific headers before consuming the view-record rate budget and writing analytics rows.
- Official Next.js docs describe manual prefetch as warming routes and CDN guidance documents `next-router-prefetch` / `_rsc` RSC payload requests for prefetch flows.

Problem:

Analytics writes are tied to server component evaluation instead of a client-side "this page/photo was actually viewed" commitment. In App Router, prefetching can fetch the RSC payload for a target route. If that evaluates the page module containing `void recordPhotoView(...)`, the analytics side effect can happen even when the visitor never navigates to that photo.

Concrete failure scenario:

A visitor opens photo 10. The page's hidden `Link prefetch={true}`, the `PhotoViewer` idle prefetch, or a hover over the next/previous control warms photo 9 and photo 11. If the current Next.js prefetch path evaluates the photo page server component, `recordPhotoView` inserts rows for photos 9 and 11. The analytics tables inflate, and those phantom requests consume the shared `VIEW_RECORD_MAX_REQUESTS` budget in `apps/web/src/app/actions/public.ts:330-348`. The same pattern can affect topics or shared groups if links to those pages become prefetched later.

Suggested fix:

Move durable view recording behind an actual client-side commitment: for example, a small public analytics route or server action called from a client effect after hydration and after the current image/page is visible. If server-side recording is retained, add an explicit prefetch/RSC request guard before the rate-limit increment and DB visibility query, then add regression coverage that `router.prefetch('/p/<id>')` does not insert into `imageViews`. Add analogous tests for topic and shared-group pages if those routes are prefetchable.

## Non-Findings And Guardrails Checked

- Admin API auth wrapping is enforced for the current admin routes.
- Mutating server actions enforce same-origin provenance or carry explicit read-only/public exemptions; public analytics actions are recognized as rate-limited by the scanner.
- Public mutating API routes pass the rate-limit scanner; expensive public GET routes `/api/og`, `/api/og/photo/[id]`, `/api/search/semantic`, and `/api/search/similar/[id]` have explicit origin/rate-limit/cache handling.
- Migration journal integrity, monotonicity, migration hash coverage, and reconcile-baseline coverage are guarded by tests and passed in the focused run.
- Public image field selection omits the sensitive contract keys; semantic/similar enrichment uses the shared compile-guarded select.
- Deploy/runtime docs and scripts consistently describe the single-instance topology, bind-mounted persistent stores, no `volume prune -a` auto-prune policy, host-network MySQL, and sidecar patterns for backfills/model seeding.
- Standard ESLint passed.

## Missed-Issue Sweep

Final sweep covered repository inventory, docs and plans/review history, high-risk large files, auth/session/origin/rate-limit flows, upload/queue/settings contracts, public analytics side effects, public search/OG routes, data privacy select shapes, migrations/reconcile, schema/journal files, service-worker generation, Docker/compose/nginx/deploy scripts, package scripts, and targeted tests. I did not intentionally skip any relevant app/routes/actions/lib/components/db/scripts/tests/config/deploy/docs files for the requested code quality, logic, maintainability, SOLID, or cross-file interaction angles. Implementation code was not edited.
