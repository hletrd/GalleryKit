# Cycle 28 Critic Review

Reviewer: cycle-28 critic
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `395de19b` (`docs(cycle-27): 📝 record deploy completion`)
Mode: skeptical whole-repo critique focused on cross-system risks, product-policy mismatch, weak boundaries, and regression-prone workflows.

## Inventory First

I loaded the project operating contract before reviewing code: the in-session `AGENTS.md` instructions, `CLAUDE.md`, `README.md`, and `apps/web/README.md`. I also read the cycle-27 critic artifact and current `critic-verifier.md` to avoid re-filing already-fixed findings, then verified those findings against current HEAD.

Repository inventory used for this pass:

- Git-tracked files at HEAD: 2,598.
- Non-generated repository files excluding `.git`, `node_modules`, and `.next`: 6,755.
- Tracked application source/tests under `apps/web/src`: 520 files.
- Route/action surface under `apps/web/src/app`: 77 files.
- Core library surface under `apps/web/src/lib`: 98 files.
- Unit tests under `apps/web/src/__tests__`: 278 files.
- Migrations under `apps/web/drizzle`: SQL files `0000` through `0027` plus `meta/_journal.json`.

Review-relevant files and documentation examined or inventory-scanned:

- Governance/product/ops docs: `AGENTS.md` from the prompt, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `.context/reviews/critic.md`, `.context/reviews/critic-verifier.md`, current `.context/plans/**` and review-history policy markers.
- Root/app config: `package.json`, `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/scripts/entrypoint.sh`, `apps/web/deploy.sh`.
- Schema/migration/restore: `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, all current migration SQL, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/instrumentation.ts`, and restore tests.
- Auth/origin/rate-limit/admin API: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/proxy.ts`, all `/api/admin/**` routes, and action-origin/API-auth/public-route lint scripts by source scan.
- Upload/image/color/storage: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/upload-tracker*.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/process-topic-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/app/actions/admin-backfill.ts`, `apps/web/src/lib/storage/**`, and related tests.
- Public data/privacy/search/serving: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/lib/serve-upload.ts`, upload route handlers, public photo/topic/share/group/timeline/map/smart-collection pages, `apps/web/src/app/actions/public.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, OG/feed/sitemap/robots routes, and privacy/search tests.
- Product-policy drift scan: live source/docs searched for Stripe/payment/entitlements, reactions, culling/scoring/proofing/editing, unsupported S3/MinIO/storage switching, legacy public originals, semantic-stub honesty, and process-local scale-out assumptions.

Final missed-issues sweep covered all tracked source/config/docs/tests/migrations relevant to runtime behavior and product policy. Generated/vendor/build directories and binary assets were excluded as non-review-relevant; no relevant live source or documentation area was intentionally skipped.

## Findings

### C28-CRIT-01 - Dormant storage backend still encodes the obsolete public-original layout

Status: Risk
Severity: Low now; Medium if `@/lib/storage` is integrated without fixing this first
Confidence: High
Perspective: privacy boundary, future integration hazard, product-policy mismatch

Evidence:

- The product contract says the storage abstraction is not integrated and must not be exposed as a supported backend feature yet (`CLAUDE.md:149`). It also says originals live in the private upload store (`CLAUDE.md:184`) and that public serving excludes `original/` (`CLAUDE.md:210`).
- The live upload path enforces that split: `UPLOAD_ROOT` is the public derivative root, `LEGACY_UPLOAD_DIR_ORIGINAL` is explicitly the old public-original location, and `UPLOAD_ORIGINAL_ROOT`/`UPLOAD_DIR_ORIGINAL` is the private original store (`apps/web/src/lib/upload-paths.ts:12-41`). Production startup fails if the legacy public original directory still contains files (`apps/web/src/lib/upload-paths.ts:163-184`), and nginx returns 404 for `/uploads/original/` (`apps/web/nginx/default.conf:165-167`).
- The experimental local storage backend still imports only `UPLOAD_ROOT` (`apps/web/src/lib/storage/local.ts:15`), creates an `original` directory under that public root (`apps/web/src/lib/storage/local.ts:20`, `apps/web/src/lib/storage/local.ts:50-53`), and resolves every key, including `original/foo.jpg`, under `UPLOAD_ROOT` (`apps/web/src/lib/storage/local.ts:40-47`). Its type-level convention repeats that mapping: keys may be `original/abc.jpg`, and the current local backend maps keys to `UPLOAD_ROOT/<key>` (`apps/web/src/lib/storage/types.ts:11-14`).
- The singleton comments correctly say this module is not wired into the live upload/processing/serving path (`apps/web/src/lib/storage/index.ts:4-12`), and CI quarantines imports from outside `lib/storage` (`apps/web/src/__tests__/storage-quarantine.test.ts:111-132`). That means this is not a live leak today; the risk is that the internal abstraction's behavior conflicts with the current privacy invariant the moment the quarantine is intentionally relaxed.

Problem:

The repository has two incompatible "originals" contracts. The live product has moved originals out of the public upload tree, but the dormant storage backend still models `original/` as a subdirectory of the public derivative root. The quarantine test prevents accidental imports, but it does not make the backend itself safe for the eventual integration path it is designed to support.

Concrete failure scenario:

A future storage-integration change deletes or relaxes `storage-quarantine.test.ts` as instructed when wiring the abstraction into uploads. The developer calls `getStorage().writeStream('original/<uuid>.jpg', ...)` because `StorageBackend` documents that key convention. The code writes the full-resolution original to `public/uploads/original`, recreating the legacy public-original layout that production startup and docs treat as forbidden. Depending on rollout order, this either makes production fail closed on restart, leaves originals under a web-served tree behind only nginx/routing blocks, or splits backup/deploy expectations because derivatives and private originals are no longer in the documented mounts.

Suggested fix:

Make the quarantined backend obey the current invariant before anyone can integrate it. Either remove `original/` support from `StorageBackend` until the end-to-end design is decided, or route `original/*` keys through `UPLOAD_ORIGINAL_ROOT`/`UPLOAD_DIR_ORIGINAL` while derivative/resource keys stay under `UPLOAD_ROOT`. Update `REQUIRED_DIRS` so it does not create `UPLOAD_ROOT/original`, and add storage-local tests asserting that an `original/foo.jpg` write lands in the private original root and that `getUrl('original/foo.jpg')` still throws. Keep the quarantine test until the full upload/processing/serving migration happens.

## Checked Clean / Not Re-filed

- Cycle-27 legacy-original permissions are fixed at current HEAD: migration creates/chmods the private original root to non-world-readable mode and chmods migrated files (`apps/web/scripts/migrate.js:77-124`), with a regression test (`apps/web/src/__tests__/migrate-legacy-originals.test.ts:87-101`).
- The critic-verifier semantic honesty finding is fixed: production semantic search now returns `503 semantic_no_embeddings` when there are no production embeddings (`apps/web/src/app/api/search/semantic/route.ts:285-290`), matching `apps/web/README.md:63-68`.
- The checked-in nginx derivative path now proxies `/uploads/{jpeg,webp,avif}` to Next by default (`apps/web/nginx/default.conf:169-185`), matching the documented host-side reverse-proxy topology (`apps/web/README.md:53-54`).
- The per-photo OG fallback now validates and redirects using a canonical base URL, not the inbound request origin (`apps/web/src/app/api/og/photo/[id]/route.tsx:249-294`).
- Public smart collections check `is_public` in both metadata/render and load-more paths before compiling stored queries (`apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:29-34`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:80-101`, `apps/web/src/app/actions/public.ts:207-221`).
- Public privacy selectors remain guarded: standard public selects omit sensitive/admin-only fields (`apps/web/src/lib/data.ts:368-489`), timeline mirrors the same privacy contract (`apps/web/src/lib/data-timeline.ts:20-67`), and semantic/similar enrichment uses the shared compile-time guarded selector.
- Payment/Stripe, entitlements, reactions, culling, scoring, proofing, and photo-editing product surfaces were not reintroduced in live source. Remaining references are historical migrations/docs/removal guards.
- Restore, upload, LR token, admin API, and public search routes have the expected same-origin/auth/rate-limit/maintenance gates in current source. The remaining process-local restore/queue/rate-limit constraints are explicitly documented as single-instance topology, not re-filed as a new defect.

## Validation Evidence

This was a review artifact pass, not a product-code patch. I used repo-wide inventory and source scans plus targeted line-level reads across the route/action/auth/privacy/restore/upload/semantic/deploy/storage surfaces above. I did not run the full blocking quality gates because the only change made by this turn is this Markdown review file.

## Finding Count

- Confirmed live defects: 0
- Likely issues: 0
- Risks: 1
- Total findings reported: 1
