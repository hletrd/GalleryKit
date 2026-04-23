# Comprehensive Repository Code Review

Date: 2026-04-14
Reviewer: OpenAI Codex
Scope: Full tracked repository review, including source, scripts, migrations, configuration, and documentation.

## Review inventory and coverage

I first built an inventory from `git ls-files` and then reviewed every review-relevant tracked file group:

- Root docs/config: `README.md`, `CLAUDE.md`, root `package.json`, `.dockerignore`, `.gitignore`, editor config, repo rules
- App config/deploy: `apps/web/{package.json,README.md,next.config.ts,drizzle.config.ts,eslint.config.mjs,vitest.config.ts,Dockerfile,docker-compose.yml,deploy.sh,.env.local.example,components.json,postcss.config.mjs,tailwind.config.ts,tsconfig.json,nginx/default.conf}`
- Database/migrations: `apps/web/drizzle/*`, `apps/web/src/db/*`
- Runtime/backend logic: all `apps/web/src/lib/*`, `apps/web/src/app/actions/*`, `apps/web/src/proxy.ts`, `apps/web/src/instrumentation.ts`
- App routes/pages: all `apps/web/src/app/**/*`
- Client components: all non-trivial `apps/web/src/components/*`; `src/components/ui/*` were also examined as thin wrappers and had no business-logic findings
- Tests: all `apps/web/src/__tests__/*`
- I18n: `apps/web/messages/{en,ko}.json` (including parity check)
- Scripts: all `apps/web/scripts/*`
- Static worker asset: `apps/web/public/histogram-worker.js`

Out of scope / intentionally excluded as non-reviewable source-of-truth:
- Generated/build/vendor state: `.next/`, `node_modules/`, `.omc/`, `.omx/`
- Existing review artifacts under `.context/reviews/`
- Local secret/config files not tracked in git (for example `apps/web/.env.local`, local `site-config.json`)

## Verification executed

- `npm test --workspace=apps/web` ✅ passed (`35` tests across `4` files)
- `npm run build --workspace=apps/web` ✅ passed
- `npm run lint --workspace=apps/web` ❌ failed
  - Confirmed lint errors/warnings include:
    - `apps/web/src/components/histogram.tsx:161` (`react-hooks/set-state-in-effect`)
    - `apps/web/src/components/lightbox.tsx:38` (`react-hooks/set-state-in-effect`)
    - `apps/web/scripts/migrate-capture-date.js:17-18` (`no-require-imports`)
    - plus multiple unused-variable / raw-<img> warnings

---

## Confirmed issues

### 1) Fresh deployments can create a schema that does not match the runtime code
- Severity: High
- Confidence: High
- File/region:
  - `apps/web/src/db/schema.ts:11-15, 42-51, 111-140`
  - `apps/web/drizzle/0000_nappy_madelyne_pryor.sql:1-79`
  - `apps/web/scripts/migrate.js:21-148`
  - `apps/web/Dockerfile:72-76`
- Why this is a problem:
  - The current schema expects tables/columns such as `topic_aliases`, `audit_log`, `rate_limit_buckets`, `white_balance`, `metering_mode`, `view_count`, `expires_at`, etc.
  - The only committed Drizzle migration is much older and does not create many of those tables/columns.
  - The production startup path (`Dockerfile` -> `node apps/web/scripts/migrate.js`) uses that stale migration plus a manual fallback that still does **not** create the full current schema.
- Concrete failure scenario:
  - A clean Docker deployment starts with a database that is missing `topic_aliases`; topic alias resolution and category admin pages can then fail at runtime.
  - `audit_log` / `rate_limit_buckets`-based code silently degrades or errors depending on call site.
- Suggested fix:
  - Generate real migrations from the current `schema.ts`, commit them, and make production rely on those migrations instead of a hand-maintained partial fallback.
  - If a fallback remains, it must be generated from the live schema or deleted.

### 2) Locale handling is broken in many hardcoded links, redirects, and router pushes
- Severity: High
- Confidence: High
- File/region:
  - `apps/web/src/components/photo-viewer.tsx:61-64, 90`
  - `apps/web/src/components/photo-navigation.tsx:80-86, 180-194`
  - `apps/web/src/components/home-client.tsx:237, 317`
  - `apps/web/src/app/[locale]/admin/page.tsx:8-10`
  - `apps/web/src/app/actions/auth.ts:169, 193`
  - `apps/web/src/app/[locale]/g/[key]/page.tsx:94, 112, 124`
  - `apps/web/src/app/[locale]/s/[key]/page.tsx:65`
  - `apps/web/src/components/admin-header.tsx:15`
  - `apps/web/src/components/footer.tsx:42`
- Why this is a problem:
  - The app is locale-routed, but many navigations use hardcoded root-relative paths like `/p/123`, `/admin/dashboard`, `/`, or `/${image.topic}`.
  - On a non-default locale (for example `/ko/...`), these links/pushes drop the user back to the default locale.
- Concrete failure scenario:
  - A Korean user on `/ko/p/12` presses next/previous or “back to topic” and lands on `/p/11` or `/travel` instead of the Korean route.
  - An authenticated Korean admin is redirected to `/admin/dashboard` instead of `/ko/admin/dashboard`.
- Suggested fix:
  - Centralize locale-aware route generation.
  - In client components, use `useLocale()` and prefix internal routes.
  - In server redirects, build locale-aware destinations from route params or request locale.

### 3) Cache invalidation only targets default-locale paths, so non-default pages can stay stale
- Severity: High
- Confidence: High
- File/region:
  - `apps/web/src/app/actions/images.ts:248-249, 311-312, 396-397, 427-428`
  - `apps/web/src/app/actions/topics.ts:56-57, 126-127, 156-158, 188, 218`
  - `apps/web/src/app/actions/tags.ts:57, 75, 113, 140, 188`
  - `apps/web/src/app/actions/admin-users.ts:46, 82`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:315`
- Why this is a problem:
  - These actions revalidate `/`, `/admin/dashboard`, `/admin/categories`, `/admin/tags`, etc., but the actual app pages are locale-routed under `/[locale]/...`.
  - Revalidating only the unprefixed path does not reliably invalidate `/ko/...` pages.
- Concrete failure scenario:
  - An admin updates a topic or tag and the English page refreshes correctly, while the Korean page remains stale until the ISR window expires.
- Suggested fix:
  - Revalidate all locale variants explicitly (for example loop over `LOCALES`), or revalidate by tags/route groups rather than one unprefixed path.

### 4) Shared group view counts are incremented twice per request
- Severity: High
- Confidence: High
- File/region:
  - `apps/web/src/lib/data.ts:355-374`
  - `apps/web/src/app/[locale]/g/[key]/page.tsx:15-24, 57-60`
- Why this is a problem:
  - `getSharedGroup()` has a write side effect (`view_count = view_count + 1`).
  - The shared-group page calls it once in `generateMetadata()` and again in the page itself.
- Concrete failure scenario:
  - One human page view increments `view_count` twice.
  - Bots/crawlers that hit metadata separately can inflate counts even further.
- Suggested fix:
  - Make metadata reads side-effect-free, or split `getSharedGroup()` into a pure fetch function plus an explicit counted-view path.

### 5) Successful login does not clear the DB-backed rate-limit bucket, despite code comments saying it does
- Severity: High
- Confidence: High
- File/region:
  - `apps/web/src/app/actions/auth.ts:97-112, 136-138`
  - `apps/web/src/lib/rate-limit.ts:97-139`
- Why this is a problem:
  - `login()` checks the database bucket with `checkRateLimit()` and increments it with `incrementRateLimit()`.
  - On successful auth, it only clears the in-memory `loginRateLimit` Map; it never resets or deletes the DB bucket.
- Concrete failure scenario:
  - A user mistypes the password 4 times, logs in successfully once, then mistypes once more within the 15-minute window and gets blocked anyway because the DB bucket still contains the prior failures.
- Suggested fix:
  - On successful login, explicitly clear the current login bucket for that IP/window, or change the algorithm so only failures increment the persistent bucket.

### 6) Admin dashboard pagination counts only processed images while the list includes unprocessed ones
- Severity: High
- Confidence: High
- File/region:
  - `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:13-18`
  - `apps/web/src/lib/data.ts:97-128`
- Why this is a problem:
  - The dashboard list uses `getImagesLite(..., includeUnprocessed = true)`, but `totalCount` comes from `getImageCount()` which always filters to `processed = true`.
- Concrete failure scenario:
  - After a batch upload, the dashboard can show pending/unprocessed rows on page 1, but `totalPages` is computed too low, making some rows unreachable through pagination.
- Suggested fix:
  - Add an `includeUnprocessed` parameter to `getImageCount()` and use it from the admin dashboard.

### 7) Topic aliases can collide with real topic slugs, making routing ambiguous
- Severity: High
- Confidence: High
- File/region:
  - `apps/web/src/app/actions/topics.ts:169-195`
  - `apps/web/src/lib/data.ts:392-406`
- Why this is a problem:
  - `createTopicAlias()` only enforces uniqueness inside `topic_aliases.alias`.
  - `getTopicBySlug()` resolves `topics.slug = slug OR topic_aliases.alias = slug` in one query with `limit(1)` and no priority ordering.
- Concrete failure scenario:
  - Topic A has slug `travel`; topic B gets alias `travel`.
  - Visiting `/travel` can resolve unpredictably depending on join results/query plan.
- Suggested fix:
  - Forbid aliases that match an existing topic slug.
  - Resolve direct slug matches first, then alias matches second.

### 8) Reserved route names are allowed as topic slugs/aliases, producing unreachable public topics
- Severity: High
- Confidence: High
- File/region:
  - `apps/web/src/lib/validation.ts:2-14`
  - `apps/web/src/app/actions/topics.ts:12-30, 169-179`
  - Static route conflicts under `apps/web/src/app/[locale]/{admin,p,g,s,uploads,...}`
- Why this is a problem:
  - Current validation allows slugs/aliases like `admin`, `p`, `g`, `s`, `uploads`, etc.
  - Those names collide with more specific static routes under the App Router.
- Concrete failure scenario:
  - An admin creates topic slug `admin` or alias `p`; the topic exists in the database but cannot be reached through the intended public topic URL because the static route wins.
- Suggested fix:
  - Add a reserved-path denylist for both topic slugs and aliases.

### 9) `IMAGE_BASE_URL`/CDN support is advertised but not actually compatible with the current image and CSP config
- Severity: Medium
- Confidence: High
- File/region:
  - `apps/web/src/lib/constants.ts:6-7`
  - `apps/web/src/lib/image-url.ts:3-5`
  - `apps/web/next.config.ts:19-20, 33-44`
  - `apps/web/src/components/optimistic-image.tsx:45-56`
- Why this is a problem:
  - The code advertises `IMAGE_BASE_URL` as CDN support.
  - But `next.config.ts` only allows `images.localPatterns`, not remote patterns.
  - The CSP also restricts `img-src` to `'self' data: blob:`.
- Concrete failure scenario:
  - Set `IMAGE_BASE_URL=https://cdn.example.com`; raw `<img>` requests are blocked by CSP and `next/image`-based components fail because the remote origin is not allowed.
- Suggested fix:
  - Add `images.remotePatterns` for the CDN origin and extend CSP `img-src` accordingly.
  - Document the expected slash/origin format and test it in CI.

### 10) `robots.txt` does not block locale-prefixed share/admin URLs
- Severity: Medium
- Confidence: High
- File/region:
  - `apps/web/src/app/robots.ts:6-12`
  - Locale-prefixed share/admin routes under `apps/web/src/app/[locale]/*`
- Why this is a problem:
  - `robots.ts` disallows `/admin/`, `/s/`, and `/g/`, but not `/en/admin/`, `/ko/admin/`, `/en/s/...`, `/ko/g/...`, etc.
- Concrete failure scenario:
  - Public share links under `/ko/s/...` or `/ko/g/...` are crawlable/indexable even though the intent is clearly to keep share URLs out of search.
- Suggested fix:
  - Add locale-prefixed disallow rules for every configured locale.

### 11) The “download original” button downloads the derived JPEG, not the original upload
- Severity: Medium
- Confidence: High
- File/region:
  - `apps/web/src/components/photo-viewer.tsx:51-53, 436-444`
  - `apps/web/src/lib/process-image.ts:47-50`
- Why this is a problem:
  - The UI label says “download original”, but the href points to `/uploads/jpeg/${image.filename_jpeg}`.
  - The actual original file is stored privately under `original/` and is not what gets downloaded.
- Concrete failure scenario:
  - A user uploads a RAW/HEIC file, clicks “download original”, and receives a recompressed JPEG instead of the original file/metadata.
- Suggested fix:
  - Either relabel the button to “Download JPEG” or add a safe route for original downloads if that is actually intended.

### 12) Shared-group image order is not stable because there is no `ORDER BY` and no stored position
- Severity: Medium
- Confidence: High
- File/region:
  - `apps/web/src/app/actions/sharing.ts:87-100`
  - `apps/web/src/lib/data.ts:375-384`
- Why this is a problem:
  - `createGroupShareLink()` inserts a set of group-image rows but does not store an order column.
  - `getSharedGroup()` fetches joined images without `orderBy(...)`.
- Concrete failure scenario:
  - A shared group can render in different orders across requests or environments, making prev/next navigation inconsistent and surprising.
- Suggested fix:
  - Add an explicit `position` column to `shared_group_images` and order by it, or at minimum order by a deterministic field.

### 13) Topic cover images are never cleaned up on topic update/delete
- Severity: Medium
- Confidence: High
- File/region:
  - `apps/web/src/app/actions/topics.ts:37-45, 92-99, 138-166`
  - `apps/web/src/lib/process-topic-image.ts:67-90`
- Why this is a problem:
  - Updating a topic image writes a new file but never removes the old one.
  - Deleting a topic removes only the database row; its image file remains under `public/resources`.
- Concrete failure scenario:
  - Repeated edits to topic cover images leak orphaned files indefinitely and keep serving assets that no longer correspond to any topic.
- Suggested fix:
  - Track the previous filename on update/delete and remove the old file after a successful DB change.

### 14) Tag names can contain commas, but multiple code paths treat commas as tag separators
- Severity: Medium
- Confidence: High
- File/region:
  - `apps/web/src/app/actions/tags.ts:34-56, 83-111`
  - `apps/web/src/lib/data.ts:172, 195`
  - `apps/web/src/components/home-client.tsx:205, 212`
  - `apps/web/src/components/image-manager.tsx:327-355`
- Why this is a problem:
  - Tag names are stored as free text and are not forbidden from containing commas.
  - `GROUP_CONCAT(...)` uses comma-separated output, and multiple UI paths later split `tag_names` with `.split(',')`.
- Concrete failure scenario:
  - Rename a tag to `Black, White`; the gallery overlay/admin editor later interpret it as two separate tags (`Black` and `White`), breaking display and edit semantics.
- Suggested fix:
  - Forbid commas in tag names, or stop using comma-separated serialization for tag display data.
  - Prefer structured arrays from the server instead of `GROUP_CONCAT` strings when the UI needs editable tags.

### 15) SIGTERM queue draining logic can deadlock when there is queued backlog
- Severity: Medium
- Confidence: High
- File/region:
  - `apps/web/src/instrumentation.ts:6-25`
- Why this is a problem:
  - On SIGTERM the handler pauses the queue and then awaits `state.queue.onIdle()`.
  - In `p-queue`, `onIdle()` does not resolve while paused queued jobs still remain in the queue.
- Concrete failure scenario:
  - If there is 1 running job and 10 queued jobs during shutdown, the handler pauses the queue, the running job finishes, the queued jobs never start, and `onIdle()` waits forever until the orchestrator kills the process.
- Suggested fix:
  - Do not pause before `onIdle()`, or explicitly drain/clear queued work with a different shutdown policy.
  - I locally reproduced this `p-queue` behavior with a minimal script during the review.

### 16) Admin thumbnail previews load the large base AVIF instead of a thumbnail-sized variant
- Severity: Low
- Confidence: High
- File/region:
  - `apps/web/src/components/image-manager.tsx:303-310`
  - `apps/web/src/lib/process-image.ts:419-428`
- Why this is a problem:
  - The admin table preview uses `/uploads/avif/${image.filename_avif}`.
  - In this codebase the base filename is hard-linked/copied from the 2048px variant, so a 128px preview can download a much larger asset than necessary.
- Concrete failure scenario:
  - Admin dashboard with many rows pulls large 2048px AVIF files into tiny preview boxes, wasting bandwidth and slowing scrolling.
- Suggested fix:
  - Use a sized variant such as `_640.avif` or a dedicated admin thumbnail path.

### 17) The upload UI accepts fewer file types than the backend processing pipeline
- Severity: Low
- Confidence: High
- File/region:
  - `apps/web/src/components/upload-dropzone.tsx:63-66`
  - `apps/web/src/lib/process-image.ts:52-55`
- Why this is a problem:
  - The backend allows `.tiff`, `.tif`, `.gif`, `.bmp`, `.heif`, etc.
  - The browser dropzone only advertises/accepts a narrower subset.
- Concrete failure scenario:
  - A TIFF or BMP file supported by the server cannot be selected through the normal admin upload UI.
- Suggested fix:
  - Align the dropzone accept list with the server’s allowed extension set.

### 18) Lightbox focus restoration stores the wrong element
- Severity: Low
- Confidence: High
- File/region:
  - `apps/web/src/components/lightbox.tsx:159-170`
- Why this is a problem:
  - The effect focuses the close button **before** capturing `document.activeElement` as `previouslyFocused`.
  - That means the saved “previous” element is usually the close button itself, not the element that launched the lightbox.
- Concrete failure scenario:
  - A keyboard user opens the lightbox, closes it, and focus is not restored to the triggering control.
- Suggested fix:
  - Capture `document.activeElement` before moving focus into the lightbox.

### 19) `migrate-data.ts` logs the full MySQL connection string, including the password
- Severity: Low
- Confidence: High
- File/region:
  - `apps/web/scripts/migrate-data.ts:22-25`
- Why this is a problem:
  - The script prints the resolved connection string directly to stdout.
- Concrete failure scenario:
  - Running the migration in CI or a shared terminal leaks DB credentials into logs/history.
- Suggested fix:
  - Log only host/database/user, or redact the password before printing.

---

## Likely issues

### 20) The image-processing queue still has a cross-process race in multi-instance deployments
- Severity: High
- Confidence: Medium
- File/region:
  - `apps/web/src/lib/image-queue.ts:54-98, 134-158`
- Why this is likely a problem:
  - The queue does a read-only “is `processed = false`?” check before expensive work, but it does **not** atomically claim the row before processing.
  - If two Node processes/containers bootstrap at the same time, both can process the same pending image.
  - The loser then sees `affectedRows === 0` and deletes the generated variants, assuming the image was deleted.
- Concrete failure scenario:
  - During a rolling deploy or horizontal scale-out, two workers process the same image; one marks it processed, the second deletes the generated files, leaving `processed = true` in the DB but missing files on disk.
- Suggested fix:
  - Add a real claim step (for example `processing = true` / `claimed_at` / advisory lock) before running Sharp.
- Manual validation note:
  - This matters only when more than one Node process/container can work the same queue.

### 21) Infinite-scroll state probably does not reset cleanly when filters/topic props change
- Severity: Medium
- Confidence: Medium
- File/region:
  - `apps/web/src/components/load-more.tsx:18-44, 51-66`
  - `apps/web/src/components/home-client.tsx:298-305`
- Why this is likely a problem:
  - `LoadMore` copies `initialOffset` and `hasMore` into local state once and never syncs them back to props.
  - `HomeClient` explicitly resets `allImages` when server props change, which strongly suggests the client component is reused across filter/query changes.
- Concrete failure scenario:
  - Change tag filters after having already scrolled deep into a gallery; the next infinite-scroll fetch uses an old offset or stale `hasMore` value and can skip, duplicate, or prematurely stop loading.
- Suggested fix:
  - Add an effect in `LoadMore` that resets `offset`/`hasMore` whenever the underlying query identity changes (topic + tags + initialOffset).
- Manual validation note:
  - This should be tested in-browser with filter toggling after several “load more” batches.

---

## Risks needing manual validation

### 22) The 10 GB server-action body size is a very large authenticated DoS surface
- Severity: Medium
- Confidence: Medium
- File/region:
  - `apps/web/next.config.ts:25-32`
  - `apps/web/src/app/actions/images.ts:48-52`
- Why this is a risk:
  - The app explicitly allows very large request bodies and then accepts up to 10 GB total batch size.
  - Even though uploads are admin-only, that is still a huge resource commitment for a server action.
- Concrete failure scenario:
  - A compromised admin session or accidental bulk upload can saturate memory, temp storage, or reverse-proxy buffers long before the app rejects/finishes work.
- Suggested fix:
  - Re-evaluate the real operational maximum, enforce it consistently at proxy/framework/action layers, and load-test it under realistic deployment constraints.
- Manual validation note:
  - Whether this is acceptable depends on the deployment’s memory/disk envelope and trusted-admin assumptions.

---

## Final sweep for commonly missed issues

I did a final sweep specifically for categories that are often missed in repo-wide reviews:

- Route generation / locale preservation ✅ checked across pages, components, redirects, and router pushes
- Cache invalidation across localized ISR pages ✅ checked
- Schema/migration parity ✅ checked across `schema.ts`, drizzle SQL, startup scripts, and Docker path
- Side effects hidden inside read helpers / metadata functions ✅ checked (`getSharedGroup` issue found)
- Queue/shutdown concurrency paths ✅ checked (`image-queue` + `instrumentation.ts`)
- Static/privacy config ✅ checked (`robots.ts`, CSP, image base URL)
- Script-only security issues ✅ checked (`migrate-data.ts` credential leak)
- i18n message parity ✅ checked (`en.json` and `ko.json` have matching flattened keys)
- Tests and verification coverage ✅ checked (tests/build/lint)

No additional tracked source/config/script/doc file groups were skipped after the sweep. The thin `src/components/ui/*` wrappers were reviewed as low-risk adapter files and produced no business-logic findings.

## Summary

Most serious problems are:
1. deployment schema drift,
2. broken locale-aware routing/invalidation,
3. incorrect shared-group view counting,
4. login rate-limit reset bug,
5. queue shutdown/concurrency hazards.

Everything above is written from code evidence in the current repository state, not from comments/tests alone.
