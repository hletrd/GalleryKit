# Code Review Summary — review-plan-fix cycle 3

## Inventory built first

Reviewed the repository as a whole, with emphasis on code-bearing and runtime-relevant surfaces:

- Root/workspace surface
  - `package.json`, `README.md`, `scripts/deploy-remote.sh`
- App/config/runtime surface
  - `apps/web/package.json`, `next.config.ts`, `playwright.config.ts`, `playwright-test.config.ts`, `Dockerfile`, `docker-compose.yml`, `drizzle.config.ts`, `eslint.config.mjs`, `vitest.config.ts`
- Application code
  - `apps/web/src`: **153** TS/TSX files
    - `app`: 53
    - `components`: 44
    - `lib`: 37
    - `db`: 3
    - `i18n`/runtime glue: 3
- Tests and scripts
  - unit tests: **13** files
  - Playwright/E2E: **5** files
  - scripts: **11** files

## Verification used during review

- `cd apps/web && npx tsc --noEmit -p tsconfig.json` ✅
- `cd apps/web && npm test` ✅ (`13` files / `97` tests)
- `cd apps/web && npm run lint -- .` ✅
- `cd apps/web && npm run build` ✅
  - notable observation during build: the `TRUST_PROXY` warning was emitted repeatedly from parallel workers
- `cd apps/web && npm run lint:api-auth` ✅
- code-intel MCP tools were unavailable in this session, so repository inspection/pattern sweeps were completed via shell reads/grep instead

## Files reviewed

Broad review included the core cross-file paths involved in auth/session handling, uploads, image processing, background queue behavior, public rendering, admin mutations, sharing, SEO/metadata, storage/config plumbing, tests, and deploy/runtime config. The highest-signal files for findings in this pass were:

- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/instrumentation.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/lib/rate-limit.ts`

---

## Confirmed issues

### 1) [HIGH] Database restore still runs against a live app without draining the image queue or blocking new write activity

**Citations**
- `apps/web/src/app/[locale]/admin/db-actions.ts:232-257`
- `apps/web/src/app/[locale]/admin/db-actions.ts:330-390`
- `apps/web/src/lib/image-queue.ts:135-216`
- `apps/web/src/lib/image-queue.ts:291-335`
- `apps/web/src/instrumentation.ts:5-26`

**Problem**
`restoreDatabase()` only takes a DB advisory lock for *other restore calls*. It does **not** pause the background image-processing queue, flush buffered writes first, or prevent concurrent admin/public mutations while `mysql` is replaying the dump. Meanwhile the app boot path explicitly starts the queue, and queued jobs continue to update `images.processed` / generate files during normal runtime.

**Concrete failure scenario**
An admin starts a restore while uploads from an earlier session are still queued. During the restore, `mysql` rewrites the `images` table to an older snapshot, while the live queue keeps processing pre-restore originals and writing `processed=true` updates back into the restored database. The resulting state is mixed: DB rows come from the restore snapshot, some file variants come from post-snapshot work, and some queue jobs may now target rows that no longer match the restored state. This is exactly the kind of cross-runtime corruption a destructive restore flow should prevent.

**Suggested fix**
Introduce an explicit maintenance barrier around restore:
- set a process-wide “restore in progress” flag that rejects uploads/admin mutations,
- flush and pause the image queue before invoking `mysql`,
- flush buffered shared-group view counts before restore begins,
- only clear the barrier after restore + cache invalidation completes.
If full maintenance mode is too large for one change, at minimum make restore refuse to run while queue work is pending.

**Confidence**: High

---

### 2) [MEDIUM] Changing `image_sizes` in admin settings can break existing image URLs, OG images, and responsive `srcSet`s for already-processed images

**Citations**
- `apps/web/src/app/actions/settings.ts:35-85`
- `apps/web/src/lib/gallery-config.ts:68-84`
- `apps/web/src/lib/gallery-config-shared.ts:80-101`
- `apps/web/src/lib/image-queue.ts:193-216`
- `apps/web/src/lib/process-image.ts:369-423`
- `apps/web/src/components/home-client.tsx:249-268`
- `apps/web/src/components/photo-viewer.tsx:203-214`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:65-69`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:145-146`

**Problem**
The settings flow lets admins change `image_sizes` at any time, and the render layer immediately starts generating URLs from the **current** configured sizes. But derivatives are only produced when a file is processed by `processImageFormats()`. Existing images do not get reprocessed when `image_sizes` changes, so the UI and metadata can start requesting size variants that do not exist on disk for older images.

**Concrete failure scenario**
An admin changes `image_sizes` from `640,1536,2048,4096` to `800,1600,2400`. Newly uploaded images get the new derivatives, but older images still only have `_640`, `_1536`, `_2048`, `_4096`. The homepage now emits `_800`/`_1600` thumbnail URLs, `PhotoViewer` emits `srcSet`s for all new sizes, and photo metadata emits OG/thumbnail URLs using the new size list. Older images therefore return 404s for those generated URLs, causing broken thumbnails, degraded responsive image loading, and stale/broken social preview assets.

**Suggested fix**
Do one of these explicitly:
- make `image_sizes` effectively immutable once images exist,
- or store derivative-generation/version metadata per image and run a background reprocessing migration before switching readers to the new size set,
- or add a robust fallback path that only emits URLs for variants known to exist for that image.
Right now the system treats `image_sizes` as mutable config, but the underlying derivatives behave like immutable historical artifacts.

**Confidence**: High

---

### 3) [MEDIUM] Shared-group gallery tiles fetch an OG-sized image variant for every card instead of a grid-sized thumbnail

**Citations**
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:95-98`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:153-174`

**Problem**
The shared-group page computes `ogImageSize` using `findNearestImageSize(config.imageSizes, 1536)` and then reuses that value for the gallery card `<Image />` source. That means the tile grid pulls an approximately-1536px asset even though the rendered layout only needs roughly `100vw / 50vw / 33vw` thumbnails.

**Concrete failure scenario**
A shared group with dozens of images is opened on mobile. Instead of loading the smallest grid-appropriate variant, every tile requests the 1536px WebP. The page becomes noticeably heavier to download and decode, increasing time-to-interactive and scroll jank on slower devices/connections.

**Suggested fix**
Use the same thumbnail strategy as the main gallery surface:
- choose the smallest or second-smallest configured size for grid cards,
- or emit a proper `srcSet`/`sizes` pair instead of one large fixed asset,
- keep 1536-sized variants reserved for OG cards and large-detail views.

**Confidence**: High

---

### 4) [LOW] CSV export still double-buffers large exports in memory despite the comment claiming the implementation is incremental

**Citations**
- `apps/web/src/app/[locale]/admin/db-actions.ts:37-91`

**Problem**
`exportImagesCsv()` first materializes up to 50,000 DB rows in `results`, then materializes another large `csvLines` array, and only after that joins into the final CSV string. The comment says the code “avoid[s] holding both the DB results array and the full CSV string in memory simultaneously”, which is partially true, but it still holds both `results` and `csvLines` at once during the main loop.

**Concrete failure scenario**
On a gallery near the 50k-row cap, an export runs on a small VPS/container. Peak heap usage spikes because the code simultaneously holds the query result set and a second array of escaped CSV rows before the final string is built. That can turn an admin convenience action into a latency spike or OOM candidate.

**Suggested fix**
Switch to a streaming export path (stream rows directly to a temp file/response), or at least chunk row serialization so the code matches its “incremental” intent. If the current approach is intentionally accepted, the comment should be corrected to describe the real memory behavior.

**Confidence**: High

---

## Risks / maintainability concerns

### 5) [LOW] `TRUST_PROXY` warning is emitted at module-import time, which spams build logs and parallel worker startups

**Citations**
- `apps/web/src/lib/rate-limit.ts:85-89`
- local verification: `cd apps/web && npm run build` emitted the same warning repeatedly during static generation

**Problem**
The warning is evaluated at module import time, not at a single runtime startup boundary. Any build worker or request path that imports `rate-limit.ts` in production mode can emit the warning again.

**Concrete failure scenario**
During production build or parallel worker startup, the same warning appears many times. This does not break correctness, but it obscures real failures and makes logs noisier than necessary.

**Suggested fix**
Move the warning to a one-time runtime path (for example server startup/instrumentation) or protect it with a module-global “warned once” guard so it is actionable instead of repetitive.

**Confidence**: High

---

## Final sweep

I did a final missed-issues sweep after collecting the findings above:

- re-checked public image-size consumers, shared-group rendering, restore flow, queue bootstrap, and rate-limit startup paths
- re-ran repository-level verification (`tsc`, tests, lint, build, API-auth check)
- checked for direct tests covering the image-size mutability and restore-maintenance cases and found no focused coverage in `src/__tests__` or `e2e`

I did **not** find a stronger new issue than the five above in this pass.

## Recommendation

**REQUEST CHANGES**

The codebase is generally disciplined and currently passes lint/tests/build, but I would not sign off on the restore flow as-is because the live-restore race is a real correctness/integrity problem. The `image_sizes` mutability mismatch is the next highest-value fix because it can silently break already-processed assets across multiple public surfaces.

## Notes

- No source files were modified during this review.
- This file is the only artifact written for the review deliverable.
