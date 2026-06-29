# Cycle 16 Debugger Review

Review lane: `debugger`
Reviewed HEAD: `fc0417387ff1972bfabd51c1928c7b57e6b4c827`
Date: 2026-06-30 KST
Scope: current HEAD only. Latent bug, regression, edge-case, incorrect-assumption, and cross-file interaction review across the repository. Existing uncommitted review artifacts in `.context/reviews/` were treated as out-of-scope working-tree noise unless they affected validation.

## Inventory Summary

Repository inventory from `git ls-tree -r --name-only HEAD`:

- Tracked files: 2,557
- Largest tracked areas: `.context/` 1,755 files, `apps/` 608 files, `plan/` 176 files
- Application source inspected by class: app routes/pages, API routes, server actions, data/query helpers, auth/rate-limit/session code, upload/image-processing/queue code, backup/restore/migration code, SEO/feed/sitemap code, config/deploy scripts, and regression tests
- `apps/web` file-shape inventory included 425 TypeScript files, 104 TSX files, 28 SQL migrations, 11 JSON files, 6 JS files, 6 MJS files, image fixtures/assets, shell deploy helpers, and Playwright/Vitest tests

High-risk surfaces inspected without sampling:

- Server actions: `apps/web/src/app/actions/{admin-backfill,admin-users,auth,collections,embeddings,images,lr-tokens,public,seo,settings,sharing,tags,topics}.ts`
- Admin DB actions: `apps/web/src/app/[locale]/admin/db-actions.ts`
- API routes: admin backup download, Lightroom upload, semantic/similar search, OG image routes, health/live routes, upload handlers, feed handlers
- Data/query layer: `apps/web/src/lib/data.ts`, `smart-collections.ts`, `search-enrichment-fields.ts`, `gallery-config.ts`, `settings-hash.ts`
- Upload/processing/queue: `process-image.ts`, `image-queue.ts`, `upload-paths.ts`, `serve-upload.ts`, `upload-processing-contract-lock.ts`, `upload-tracker*.ts`
- Auth/security/runtime: `auth.ts`, `api-auth.ts`, `session.ts`, `admin-tokens.ts`, `request-origin.ts`, `rate-limit.ts`, `action-guards.ts`, `src/proxy.ts`
- Restore/migration: `db-actions.ts`, `db-restore.ts`, `sql-restore-scan.ts`, `mysql-cli-ssl.ts`, `scripts/migrate.js`, Drizzle migrations and journal
- Public UI/data freshness: public pages, share pages, map/timeline/year pages, feeds, sitemap, manifest, revalidation helpers

## Confirmed Issues

### DBG-C16-01: Sitemap photo entries ignore image edits and keep stale `lastModified`

Severity: Medium
Confidence: High
Status: confirmed

Code regions:

- `apps/web/src/lib/data.ts:537-543` computes the gallery-wide latest image freshness from `images.updated_at`.
- `apps/web/src/lib/data.ts:1627-1637` selects only `id` and `created_at` for sitemap photo URLs and orders by `created_at`.
- `apps/web/src/app/sitemap.ts:76-80` emits each photo URL's `lastModified` from `image.created_at`.
- `apps/web/src/app/actions/images.ts:920-927` intentionally relies on the schema `onUpdateNow()` behavior so title/description edits move `images.updated_at`.

Failure scenario:

An admin edits a photo title or description. The photo page metadata and feed entry can change immediately, and the image row's `updated_at` moves, but `/sitemap.xml` continues to publish the photo URL with its original upload `created_at`. Crawlers that use sitemap `lastmod` as a freshness signal will not be told that `/p/:id` changed, even though the application already maintains the correct `updated_at` timestamp and uses it for homepage/topic/feed freshness.

Suggested fix:

Change `getImageIdsForSitemap()` to select `updated_at` alongside `created_at`, order by `updated_at DESC, created_at DESC, id DESC`, and emit `image.updated_at ?? image.created_at` in `sitemap.ts`. Add a sitemap regression test proving a photo entry's `lastModified` uses `updated_at`.

### DBG-C16-02: Tag-only changes can make Atom feeds return false `304 Not Modified`

Severity: Medium
Confidence: High
Status: confirmed

Code regions:

- `apps/web/src/lib/photo-title.ts:67-83` derives feed/display titles from `tag_names` when the image has no meaningful stored title.
- `apps/web/src/lib/data.ts:828-853` builds feed rows with `tag_names` and orders them by `images.updated_at`.
- `apps/web/src/app/feed.xml/route.ts:60-102` uses each row's `updated_at` for entry `<updated>` and feed-level freshness.
- `apps/web/src/app/feed.xml/route.ts:144-153` returns `304` when `If-Modified-Since` covers that feed-level timestamp.
- `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:74-110` and `:142-153` mirror the same per-topic feed behavior.
- `apps/web/src/app/actions/tags.ts:176-197`, `:235-257`, `:322-332`, and `:423-448` mutate `image_tags` but do not touch the parent `images.updated_at`.
- `apps/web/src/app/actions/images.ts:1121-1135` bulk image tag add/remove also mutates `image_tags` without touching `images.updated_at`.

Failure scenario:

An untitled photo appears in Atom feeds as a tag-derived title such as `#Seoul #Night`. An admin adds or removes a tag. The feed XML content changes because `tag_names` and the derived title change, but `images.updated_at` does not. A reader polling with `If-Modified-Since` after the previous feed timestamp can receive `304 Not Modified` even though the XML body would now be different. The same stale timestamp under-reports the change to feed ordering and per-topic feed `Last-Modified`.

Suggested fix:

Whenever tag links are actually inserted or deleted for image IDs, update those parent image rows with `updated_at = CURRENT_TIMESTAMP` inside the same mutation transaction or immediately after a successful affected-row result. Cover single add/remove, batch add, and `bulkUpdateImages` tag add/remove. Add feed tests for an untitled image whose tag-only change advances feed `<updated>` / `Last-Modified` and prevents a false 304.

## Likely Issues

No additional likely issues survived the final sweep. Several candidate concerns were checked and rejected as already guarded by current code or tests: restore lock release paths, upload quota settlement, Lightroom/browser upload parity, public route rate-limit rollbacks, share-key metadata lookups, migration journal/reconcile coverage, and Node runtime pinning for Node-bound routes.

## Manual-Validation Risks

### DBG-C16-MV-01: Full unit-suite validation is currently dirty-worktree-sensitive

Severity: Low
Confidence: High
Status: manual-validation risk, not a HEAD finding

Evidence:

- `npm test --workspace=apps/web` ran 262 test files and failed only `src/__tests__/tracked-secrets.test.ts`.
- The failure referenced `.context/reviews/security-reviewer.md` containing `SESSION_SECRET` and `DB_PASSWORD` assignment-like prose in the working tree.
- `git status --short` showed that `.context/reviews/security-reviewer.md` and other review reports were already modified before this debugger report was written.
- `git show HEAD:.context/reviews/security-reviewer.md` contains only prose mentions of `SESSION_SECRET` / `DB_PASSWORD`, not the assignment-like lines that failed the working-tree test.

Risk scenario:

The test failure blocks a clean "all unit tests pass" claim in this shared dirty worktree, but it does not demonstrate an application bug in current HEAD. A clean checkout of HEAD or cleanup of the unrelated review artifact is needed before treating the full suite result as authoritative for HEAD.

Suggested validation:

Rerun `npm test --workspace=apps/web` from a clean worktree or after the unrelated `.context/reviews/security-reviewer.md` changes are corrected by their owner.

## Validation Evidence

Passed:

- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- `npm run lint --workspace=apps/web`
- `npm test --workspace=apps/web -- migrate-reconcile-coverage migration-journal migration-journal-monotonicity`
- `npm run build --workspace=apps/web`

Build note:

- The production build completed successfully. During static sitemap generation it logged the expected local `ECONNREFUSED 127.0.0.1:3306` fallback and emitted the homepage-only sitemap for build time; this path is explicitly handled in `apps/web/src/app/sitemap.ts:24-55`.

Not clean:

- `npm test --workspace=apps/web` failed only because the dirty working-tree `.context/reviews/security-reviewer.md` tripped `tracked-secrets.test.ts`; see `DBG-C16-MV-01`.

## Final Missed-Issues Sweep

The final sweep revisited:

- all route exports and Node-only imports for runtime pinning;
- public mutating route/action rate-limit coverage;
- admin action same-origin/auth/maintenance ordering;
- upload save/insert/enqueue cleanup and quota settlement;
- restore advisory lock lifecycle, queue quiescence, and post-restore migration handling;
- path traversal and symlink containment for uploads and backup download;
- public selector privacy and search enrichment fields;
- cache/revalidation interactions for public pages, feeds, sitemap, SEO settings, and gallery settings;
- broad `catch` blocks that could swallow framework control-flow or leak stale state;
- migration journal monotonicity and reconcile coverage.

Final count:

- Confirmed issues: 2
- Likely issues: 0
- Manual-validation risks: 1
