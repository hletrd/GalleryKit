# Cycle 9 Critic Review — ultradeep whole-repo critique

## Scope, inventory, and review method

I built a whole-repo inventory first and treated **review-relevant** as human-authored product/runtime files under the tracked workspace, excluding generated/runtime/history artifacts that are not the current product surface.

### Included inventory (examined)
- Root/meta/config/docs: **18** files
- `apps/web/` config/docs/deploy files: **27** files
- Drizzle SQL + schema metadata relevant to runtime schema: **6** files
- Scripts: **12** files
- i18n/runtime locale files: **3** files
- DB layer: **3** files
- Core libs: **35** files
- Storage libs: **5** files
- App routes/actions/layouts/api: **54** files
- App components: **24** files
- UI primitives: **20** files
- Unit tests: **22** files
- E2E tests/helpers: **5** files

**Total examined review-relevant files: 234**

### Explicit exclusions (not current product source)
- Generated/build/runtime/cache/history artifacts: `.next/**`, `node_modules/**`, `.context/plans/**`, prior `.context/reviews/**` artifacts except this target file, `.omx/**`, `.omc/**`, `test-results/**`
- Runtime secrets/local env files: `.env.deploy`, `apps/web/.env.local`
- Binary/runtime assets not meaningful for code critique: uploaded derivatives, image fixtures, font binaries

### Verification run during review
- `npm run lint --workspace=apps/web` ✅
- `npm run test --workspace=apps/web` ✅ (22 files / 131 tests)
- `npm run build --workspace=apps/web` ✅
- `npm run lint:api-auth --workspace=apps/web` ✅

That matters because the repo is currently **surface-green**; the issues below are mostly structural, architectural, and scale/ops/product risks that lint/tests/build do not catch.

---

## Executive verdict

The repo is **not in immediate break/fix shape**; it is in **architecture-drift / operational-risk shape**.

The strongest pattern across the codebase is this: the project has started to grow features that imply multi-instance, CDN/object-storage, high-volume catalog, and durable admin operations, but several core mechanisms still assume a **single long-lived Node process with local disk**. That mismatch is now the main risk.

---

## Findings

## 1) Remote-storage support is architecturally incomplete, and the current S3 path would still blow memory on large objects

**Status:** Confirmed
**Confidence:** High
**Why this matters:** The repo contains a storage abstraction that suggests local/S3/MinIO portability, but the actual product path still hardcodes local filesystem assumptions. That is architecture drift: the code advertises a capability that the real request path does not honor.

### Evidence
- `apps/web/src/lib/storage/index.ts:8-13`
  - The module itself explicitly says the storage backend is **not yet integrated** and that actual file I/O still goes through direct filesystem code.
- `apps/web/src/lib/gallery-config-shared.ts:10-19`
  - Current persisted gallery settings do **not** include a storage backend key.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:85-174`
  - The settings UI exposes only image quality, image sizes, and GPS stripping; there is no storage backend control.
- `apps/web/src/lib/process-image.ts:216-236`
  - Upload ingestion writes originals directly to `UPLOAD_DIR_ORIGINAL` on local disk.
- `apps/web/src/lib/serve-upload.ts:32-102`
  - Public asset serving reads directly from local filesystem paths.
- `apps/web/src/components/photo-viewer.tsx:202-223`, `apps/web/src/components/lightbox.tsx:146-168`, `apps/web/src/components/home-client.tsx:244-258`
  - Frontend rendering is still built around `/uploads/...` path conventions.
- `apps/web/src/lib/storage/s3.ts:95-115`
  - Even the “streaming” S3 write path eagerly collects the entire stream into memory before calling `PutObject`.

### Failure scenario
A team tries to “enable S3/MinIO support” based on the presence of `src/lib/storage/**`. Uploads still land on local disk, public reads still expect `/uploads/...`, and if anyone does wire the S3 backend into a large upload path, `writeStream()` will buffer the entire payload into memory first. Result: partial migration, broken asset serving, or container OOM under large objects.

### Why this is worse than dead code
This is not harmless unused code. It changes how future contributors will reason about the system. The repo currently looks more portable than it is.

---

## 2) Login and password-change rate limiting still has a concurrency hole despite comments claiming the opposite

**Status:** Confirmed
**Confidence:** High
**Why this matters:** The code comments say these flows were fixed for TOCTOU, but the DB-backed rate-limit check still runs **before** the DB increment. That means concurrency can still overshoot the intended cap.

### Evidence
- `apps/web/src/app/actions/auth.ts:104-139`
  - `login()` performs `checkRateLimit(...)` and account-scoped `checkRateLimit(...)` first, then increments later at `135-137`.
- `apps/web/src/app/actions/auth.ts:277-295`
  - `updatePassword()` also checks the DB bucket before incrementing it.
- Contrast with flows that actually do increment-before-check correctly:
  - `apps/web/src/app/actions/public.ts:65-80`
  - `apps/web/src/app/actions/sharing.ts:74-79`, `166-170`
  - `apps/web/src/app/actions/admin-users.ts:82-99`

### Failure scenario
Five concurrent login attempts for the same IP/account arrive at once near the threshold. Each request sees the bucket **before** the others increment it, all pass the check, and all proceed into Argon2 verification. That defeats the intended burst-throttling window and increases both brute-force exposure and CPU-spike risk.

### Cross-cutting inconsistency
This is especially problematic because other modules explicitly use the safer increment-first pattern. The repo now has **multiple contradictory implementations of “the standard rate-limit fix.”**

---

## 3) Critical behavior still depends on in-memory singleton state, so correctness degrades as soon as deployment stops being single-process

**Status:** Confirmed in code, likely in production impact depending on topology
**Confidence:** High
**Why this matters:** Several important behaviors are still process-local: throttling, upload quota, shared-link analytics, and background queue coordination. That is fine only for one sticky Node process. The project’s packaging/docs otherwise imply more serious self-hosting and scaling paths.

### Evidence
- Upload quota tracker:
  - `apps/web/src/app/actions/images.ts:54-79`, `117-171`
- Share-link rate limit cache:
  - `apps/web/src/app/actions/sharing.ts:20-60`
- Search rate limit cache:
  - `apps/web/src/app/actions/public.ts:32-49`, `50-99`
- Shared-group view counting buffer/backoff:
  - `apps/web/src/lib/data.ts:10-24`, `27-41`, `47-95`, `600-604`
- Global image-processing queue singleton and bootstrap:
  - `apps/web/src/lib/image-queue.ts:77-93`, `136-175`, `292-317`, `372-373`
- Deployment guidance still implicitly centers one host-local process:
  - `apps/web/docker-compose.yml:10-22`

### Failure scenarios
1. **Two app replicas** each maintain their own in-memory share/search/upload counters. Users can exceed intended per-window limits just by bouncing across instances.
2. **A process restart** wipes in-memory upload tracker state and view-count buffer state. Rate limits soften unexpectedly; buffered view counts are lost unless graceful shutdown happened in time.
3. **Multiple workers** all bootstrap the processing queue, scan the same pending rows, and rely on advisory locks plus retries. The locks prevent duplicate processing, but the scan/retry load still multiplies with every instance.

### Why this matters product-wise
This repo is drifting toward “serious self-hosted gallery” concerns (sharing, backups, remote deploy, object storage abstraction, SEO). Process-local correctness is increasingly the wrong default.

---

## 4) The build pipeline can silently ship localhost metadata/canonical/share URLs

**Status:** Confirmed
**Confidence:** High
**Why this matters:** Wrong canonical URLs, sitemap URLs, OG URLs, and share base URLs are a product-level defect, not just a config inconvenience. They hurt SEO, previews, and trust.

### Evidence
- `apps/web/package.json:10`
  - Prebuild silently copies `src/site-config.example.json` into `src/site-config.json` if the real file is missing.
- `apps/web/src/site-config.json:4-5`
  - The checked-in config currently points to `http://localhost:3000`.
- URL derivation depends on that config unless env is set:
  - `apps/web/src/lib/constants.ts:11-14`
  - `apps/web/src/app/sitemap.ts:12`
  - `apps/web/src/lib/data.ts:783-790`
  - Public metadata pages also consume the derived site URL (`page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`, `s/[key]/page.tsx`, `g/[key]/page.tsx`).
- Docs say operators should mount a real config:
  - `README.md` and `apps/web/README.md`
  - But the build does not fail closed when they forget.

### Failure scenario
A CI/CD or Docker build runs without a mounted production `src/site-config.json` and without `BASE_URL`. Build still succeeds. The resulting deployment emits `localhost` in sitemap entries, canonical tags, OG URLs, and share links. Search engines and social previews index the wrong origin, and users see broken preview/share behavior.

### Why this is a prioritization issue
This is exactly the sort of mistake that green CI will never catch, but users/search engines will.

---

## 5) Sitemap generation hard-caps discoverability at 24k images and churns `lastModified` unnecessarily

**Status:** Confirmed
**Confidence:** High
**Why this matters:** This is a latent product risk hiding inside otherwise correct code. The gallery can store more images than the sitemap will ever expose.

### Evidence
- `apps/web/src/app/sitemap.ts:14-18`
  - Hard cap of `MAX_SITEMAP_IMAGES = 24000` with no sitemap-index sharding.
- `apps/web/src/app/sitemap.ts:19-55`
  - Only one sitemap is emitted.
- `apps/web/src/lib/data.ts:736-746`
  - Data layer supports capped retrieval for sitemap, but nothing above it paginates into multiple files.
- `apps/web/src/app/sitemap.ts:25-38`
  - Home/topic `lastModified` is set to `new Date()` on every request, which makes those entries appear freshly modified even when nothing changed.

### Failure scenario
A gallery grows past 24k images. The oldest or newest 6k+ images (depending on retention/order policy) never appear in the sitemap. Search indexing quietly plateaus. At the same time, the homepage/topic sitemap entries always look modified “now,” causing noisy recrawl signals without corresponding content value.

### Why this is easy to miss
Everything still “works” locally, and the site remains green in lint/tests/build. The failure is SEO-scale truncation.

---

## 6) The dangerous admin data paths are thinly verified and have no lifecycle management for accumulated backups

**Status:** Backup retention = Confirmed; restore/dump correctness gap = Manual-validation risk
**Confidence:** Medium
**Why this matters:** Backup/restore is one of the highest-impact surfaces in the repo. Right now it is safer than average from a path-traversal perspective, but still under-verified operationally.

### Evidence
- Backup creation persists files under a growing local directory:
  - `apps/web/src/app/[locale]/admin/db-actions.ts:118-123`
- Backup download serves whatever valid backup file exists there:
  - `apps/web/src/app/api/admin/db/download/route.ts:19-62`
- I found **no code path that prunes old backups** in `apps/web/src/**` or `apps/web/scripts/**`.
- Test coverage exists for filename validation/download route only:
  - `apps/web/src/__tests__/backup-filename.test.ts`
  - `apps/web/src/__tests__/backup-download-route.test.ts`
- I found **no automated tests** covering:
  - `dumpDatabase()`
  - `restoreDatabase()`
  - storage backend switching / remote storage behavior
  - concurrent `login()` / `updatePassword()` rate-limit behavior

### Failure scenarios
1. A busy admin uses the backup feature routinely; `data/backups/` grows forever until the same disk used by the app starts pressuring upload/restore operations.
2. A restore regression ships even though the test suite is green, because the suite does not exercise the actual `mysql` subprocess restore flow.
3. A concurrency bug in auth throttling escapes because helper tests pass while the action-level sequencing stays untested.

### Why this is not just a “test more” complaint
These are the exact surfaces where failure is expensive: auth throttling, backup, restore, and storage portability.

---

## Additional observations worth tracking (not promoted to top-six findings)

### A) `shared_groups.expires_at` exists in schema but there is no user-facing expiry management flow
- Evidence: `apps/web/src/db/schema.ts:87-95`, plus repo-wide search only found read-path handling in `apps/web/src/lib/data.ts:543-555` and seed/migration references.
- Risk type: Likely architecture drift.
- Why it matters: this smells like an unfinished product promise rather than a currently broken feature.

### B) Public search remains `%LIKE%`-based rather than relevance/full-text based
- Evidence: `apps/web/src/lib/data.ts:664-733`, invoked by `apps/web/src/app/actions/public.ts:25-99`, triggered from `apps/web/src/components/search.tsx:40-81`.
- Risk type: Likely scale/perf risk.
- Why it matters: acceptable now, but it will age poorly as catalog size grows.

---

## Final missed-issues sweep

I did a final sweep specifically looking for auth gaps, route mismatches, silently dangerous file serving, and unreviewed high-risk surfaces.

### Checked and did **not** find a new critical issue
- Admin API auth surface:
  - reviewed route surface and ran `npm run lint:api-auth --workspace=apps/web` ✅
- File-serving traversal/symlink protections:
  - `apps/web/src/lib/serve-upload.ts`
  - `apps/web/src/app/api/admin/db/download/route.ts`
  - both have containment + symlink checks
- Restore SQL scanning:
  - `apps/web/src/lib/sql-restore-scan.ts`
  - reasonably defensive for the current design
- Legacy public-original fail-closed startup check:
  - `apps/web/src/instrumentation.ts:2-6`
  - `apps/web/src/lib/upload-paths.ts:73-94`
- General code health signal:
  - lint/tests/build all pass

### What remains most likely to surprise the team later
1. Infra/topology changes (multi-instance, worker count, remote storage)
2. SEO correctness under real deployments
3. Scale boundaries (sitemap/search/backup accumulation)
4. Action-level concurrency, not helper-level correctness

---

## Bottom line

The repo’s biggest current risk is **not** “a missing null check.” It is that the codebase has started to **signal capabilities and deployment shapes that the implementation does not yet fully support**.

If I were prioritizing follow-up work, I would do it in this order:
1. Fix auth rate-limit sequencing in `login()` and `updatePassword()`.
2. Decide whether the product is officially **single-node local-disk only** or whether remote storage / multi-instance support is a real goal.
3. Fail builds closed on invalid production URL config instead of silently inheriting localhost.
4. Replace single-file sitemap logic with paginated sitemap-index generation.
5. Add lifecycle management + tests for backup/restore and the highest-risk action flows.
