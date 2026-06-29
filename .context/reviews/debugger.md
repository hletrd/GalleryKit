# Cycle 17 Debugger Review

Review lane: `debugger`
Reviewed HEAD: `5e054f80f646cbcd16c7aae5412aa29424e05032`
Date: 2026-06-30 KST
Scope: current HEAD only. I read `AGENTS.md` and `CLAUDE.md` first, then reviewed latent bug and failure-mode surfaces across server actions, API routes, async queues, DB transactions, image processing, upload/restore paths, route params/i18n, UI client state, service worker behavior, tests/lint scanners, and deploy scripts. Existing modified review artifacts in `.context/reviews/` were treated as unrelated shared-worktree noise.

## Inventory Summary

Primary bug-prone surfaces inspected:

- Server actions: `apps/web/src/app/actions/{admin-backfill,admin-users,auth,collections,embeddings,images,lr-tokens,public,seo,settings,sharing,tags,topics}.ts`
- Admin DB/restore actions: `apps/web/src/app/[locale]/admin/db-actions.ts`, restore helpers, migration helpers, Drizzle journal/migrations
- Public/admin API routes: Lightroom upload, backup download, OG image routes, semantic/similar search, upload serving, feed/sitemap/robots routes
- Async/background work: `image-queue.ts`, queue shutdown/bootstrap hooks, backfill scripts, embedding backfill, upload tracker state
- Image/upload pipeline: `process-image.ts`, GPS stripping, variant generation/rollback, HDR/wide-gamut handling, path validation
- Public route/i18n/UI state: photo/share/group/topic routes, localized path helpers, photo viewer/search/map clients
- Offline/runtime tooling: service worker template and generated worker, lint scanners, rate-limit tests, deploy scripts

## Confirmed Issues

### DBG-C17-01: `strip_gps_on_upload` can silently retain GPS in original files

Severity: Medium
Confidence: High
Status: confirmed

Code regions:

- `apps/web/src/app/actions/images.ts:381-388` nulls DB latitude/longitude, then awaits `stripGpsFromOriginal(...)` on browser uploads.
- `apps/web/src/app/api/admin/lr/upload/route.ts:367-380` mirrors the same behavior for Lightroom uploads and explicitly notes the strip call is best-effort.
- `apps/web/src/lib/process-image.ts:1733-1736` documents that strip failures leave the original at risk.
- `apps/web/src/lib/process-image.ts:1793-1802` returns without modifying structurally anomalous HEIC/HEIF or unsupported extensions.
- `apps/web/src/lib/process-image.ts:1813-1820` catches all strip errors, logs them, and lets the upload continue.

Failure mode:

When the admin enables `strip_gps_on_upload`, uploads with GPS metadata can still leave GPS in `data/uploads/original/` if the lossless scrubber hits a structural anomaly, if Sharp cannot rewrite HEIC/HEIF, or if any filesystem/decoder error occurs during the strip step. The DB columns are nulled, so the public UI appears scrubbed, but the retained original file and backups can still contain the protected location data.

Concrete scenario:

A Lightroom client uploads a GPS-tagged HEIC whose container parser reports a structural anomaly. `extractExifForDb()` extracts coordinates, the upload path sets `exifDb.latitude` and `exifDb.longitude` to `null`, then `stripGpsFromOriginal()` logs `cannot strip GPS ... original retains GPS` and returns. The image is inserted and processed successfully. Later, any operational backup, restore artifact, or admin-side original-file workflow preserves the GPS metadata even though the admin setting said uploads should be stripped.

Suggested fix:

Make the privacy setting's semantics explicit and enforceable. The safest fix is to fail the upload when GPS is detected but original-file stripping cannot be guaranteed, with a clear admin-facing error for unsupported/anomalous HEIC/HEIF. If product policy insists on best-effort uploads, persist a durable admin-only `gps_strip_failed`/`original_privacy_warning` state and surface it in upload results, admin tables, and backup/export runbooks so the failure is not only a server log line. Add tests for the anomalous HEIC/unsupported-extension branch and for caught strip errors.

### DBG-C17-02: The service worker can serve deleted or changed photo pages offline for 24 hours

Severity: Medium
Confidence: High
Status: confirmed

Code regions:

- `apps/web/public/sw.js:58-63` and `apps/web/public/sw.template.js:58-63` define the revocable HTML bypass only for `/c/:slug`, `/s/:key`, `/g/:key`, and `/map`.
- `apps/web/public/sw.js:293-314` caches any successful non-admin HTML response without honoring page-level `revalidate = 0`.
- `apps/web/public/sw.js:316-332` serves the cached HTML on network failure until `HTML_MAX_AGE_MS` expires.
- `apps/web/public/sw.js:388-394` bypasses revocable share pages, then sends all other HTML routes through `networkFirstHtml(...)`.
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:36-38` explicitly renders photo pages fresh because metadata and processed-file availability can change.
- `apps/web/src/app/actions/images.ts:707` revalidates `/p/${id}` on delete, but that cannot invalidate a visitor's browser Cache Storage entry.
- `apps/web/src/__tests__/sw-template-contract.test.ts:71-80` locks the bypass to `[csg]` plus map; it does not assert `/p/:id` is excluded from offline HTML caching.

Failure mode:

Photo detail pages are mutable and removable, but they are not treated as revocable by the service worker. A visitor who has loaded `/en/p/123` can later go offline and still receive that cached HTML for up to 24 hours after the image is deleted or edited. Server revalidation and `revalidate = 0` do not help during the offline fallback because the worker returns the browser-local cached response.

Concrete scenario:

An admin deletes a photo after realizing it should not be public. The delete action removes DB/file state and revalidates `/p/123`. A prior visitor's installed PWA goes offline within 24 hours and navigates to `/en/p/123`; `fetch()` throws, `networkFirstHtml()` finds the cached page, and the deleted page's title, description, JSON-LD, derivative URLs, and neighboring links are shown from Cache Storage.

Suggested fix:

Treat `/p/:id` as revocable HTML alongside `/c`, `/s`, `/g`, and `/map`, or stop offline-caching all per-photo detail pages. Update both the template and generated service worker build output, then extend `sw-template-contract.test.ts` to assert localized and unlocalized `/p/<numeric-id>` pages bypass `networkFirstHtml`. If offline photo detail support is required, cache only a deliberately redacted shell that revalidates content before rendering sensitive metadata.

## Contract / Regression Risks

### DBG-C17-RISK-01: Semantic search rate-limit comments disagree about short-query refunds

Severity: Low
Confidence: High
Status: confirmed contract drift, not a current runtime defect

Code regions:

- `apps/web/src/lib/rate-limit.ts:24-30` says semantic text search "refunds only pre-work short-query rejections."
- `apps/web/src/lib/rate-limit.ts:374-377` says malformed or too-short bodies already read stay charged.
- `apps/web/src/app/api/search/semantic/route.ts:194-205` pre-increments the semantic limiter before reading/parsing the body.
- `apps/web/src/app/api/search/semantic/route.ts:239-246` returns `400` for too-short or too-long queries without calling `rollbackSemanticAttempt`.
- `apps/web/src/app/api/search/semantic/route.ts:37` imports only `preIncrementSemanticAttempt`, not the rollback helper.
- `apps/web/src/__tests__/semantic-search-route.test.ts:230-241` tests the 400 responses but does not assert the refund/no-refund contract for these branches.

Failure mode:

The current runtime behavior is internally consistent with the route comment: once the body has been admitted, short and oversized semantic queries stay charged. The top-level rate-limit convention block says the opposite for short-query rejections. That stale convention can mislead future reviewers into adding a rollback after body admission or can make someone "fix" the tests in the wrong direction.

Concrete scenario:

A future change follows `rate-limit.ts:24-30`, imports `rollbackSemanticAttempt`, and refunds two-character semantic queries after parsing. A scripted client can then repeatedly send small JSON bodies that consume request-body read/parse work without consuming the intended semantic bucket, weakening the endpoint's admission control. Conversely, if the intended policy is to refund short queries, legitimate users can currently burn the 30/minute semantic budget with validation errors and the tests do not flag it.

Suggested fix:

Choose one contract and make it source-locked. If charged-after-body-admission is intended, update `rate-limit.ts:24-30` and add a route test that short and oversized query responses do not call `rollbackSemanticAttempt`. If short-query refunding is intended, move that validation before the rate-limit increment without reading unbounded bodies, or call rollback only for the explicitly accepted pre-work branch and add tests for that exact behavior.

## Rejected Candidates / Areas Checked

The following candidates were checked and not carried as findings:

- Sitemap photo `lastModified` staleness from cycle 16 is fixed at HEAD: `getImageIdsForSitemap()` now selects/orders by `updated_at`, and `sitemap.ts` emits `updated_at ?? created_at`.
- Tag-only feed freshness from cycle 16 appears addressed in current code paths and was not re-reported.
- Restore maintenance gates, advisory-lock release paths, and queue shutdown hooks have explicit guard/finally paths; I did not find a new stuck-lock or stale-maintenance path.
- Lightroom and browser upload flows now share the HDR reject and GPS-strip calls; the remaining GPS issue is the best-effort failure behavior above, not parity drift.
- Public API rate-limit scanners and same-origin/admin-auth scanners cover the expected mutating surfaces; I did not find an unguarded mutating export in the inspected routes/actions.
- Route parameter validation for `/p/:id`, `/s/:key`, `/g/:key`, semantic similar IDs, and OG photo IDs rejects malformed values before DB work in the reviewed paths.
- Image queue rollback, backup final-path cleanup, and variant generation use temp/rename patterns with cleanup hooks; no additional confirmed partial-write bug survived the sweep.

## Validation Evidence

This was a static debugger review. I did not run the full lint/typecheck/test/build gates because the assigned task was to write only this review file and not implement fixes. Evidence collected came from direct source inspection with line references at current HEAD.

## Final Missed-Bug Sweep

Final sweep covered:

- server action auth/origin/rate-limit ordering;
- public API validation, runtime pinning, and rollback patterns;
- async image queue enqueue/settlement/shutdown paths;
- DB restore/migration lock and post-condition logic;
- image processing rollback, GPS stripping, HDR/wide-gamut branches, and upload cleanup;
- route params, localized/unlocalized public paths, and SEO/metadata freshness;
- client-side photo/search/map state where it intersects stale public data;
- service worker offline caching and generated/template parity;
- lint scanner assumptions and tests that source-lock security/rate-limit contracts;
- deploy script shape and disk-prune constraints from `AGENTS.md`/`CLAUDE.md`.

Final count:

- Confirmed runtime issues: 2
- Likely issues: 0
- Contract/regression risks: 1
