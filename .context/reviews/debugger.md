# Debugger Review — Cycle 1

## Inventory reviewed
I reviewed the review-relevant surface under `apps/web/src`:
- App routes and server actions: `app/**`
- Core data / DB / queue / config helpers: `lib/**`, `db/**`
- Client UI flows with async state: `components/**`
- Existing regression coverage: `src/__tests__/**`

I also cross-checked repo policy and the existing `CLAUDE.md` / `AGENTS.md` guidance before writing this report.

## Findings

### 1) [HIGH] The MySQL `group_concat_max_len` bootstrap runs asynchronously, so fresh pooled connections can execute queries before the session setting lands
- **File / region:** `apps/web/src/db/index.ts:46-51`
- **Why this is a problem:** the `connection` event handler fires `callbackConnection.promise().query('SET group_concat_max_len = 65535')` and immediately returns. The next query on that same newly created connection can run before the `SET` completes, so the connection still has MySQL’s default `GROUP_CONCAT` limit when it is first used.
- **Concrete failure scenario:** on startup or when the pool expands, a request hits a query that uses `GROUP_CONCAT` (for example public tag listings / CSV export / SEO-derived tag names) before the session variable has finished applying. The response can be silently truncated to the default 1024-byte limit, which is hard to detect because the query still succeeds.
- **Suggested fix:** make the session initialization synchronous from the pool’s perspective. For example, initialize the connection before handing it to the pool user, or destroy/retry connections when the `SET` fails so the pool never serves a connection whose session state is unknown.
- **Confidence:** High

### 2) [HIGH] `getGalleryConfig()` has no DB-failure fallback, so a transient `admin_settings` outage can take down multiple public pages
- **File / region:** `apps/web/src/lib/gallery-config.ts:33-39, 68-88`
- **Cross-file impact:** `apps/web/src/components/nav.tsx:6-12`, `apps/web/src/app/[locale]/(public)/page.tsx:104-120`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:122-132`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:38-44, 118-125`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:29-35, 89-94`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:34-40, 89-95`
- **Why this is a problem:** unlike `getSeoSettings()`, `_getGalleryConfig()` does not catch query failures and does not fall back to the pure defaults in `gallery-config-shared.ts`. Any read error from `admin_settings` bubbles up into SSR.
- **Concrete failure scenario:** a temporary MySQL lock, migration issue, or pool failure makes `db.select(...).from(adminSettings)` throw. The homepage, topic page, photo page, and share pages that all call `getGalleryConfig()` can then return 500s even though the gallery could otherwise render with the shared defaults.
- **Suggested fix:** mirror the SEO helper: wrap the settings query in `try/catch`, log a warning, and fall back to `getSettingDefaults()` / `parseImageSizes(DEFAULT_IMAGE_SIZES)` so public rendering stays up during config-table outages.
- **Confidence:** High

### 3) [MEDIUM] Pagination loses its “has more” sentinel at the 100-item edge because `getImagesLite()` caps the requested limit again
- **File / region:** `apps/web/src/app/actions/public.ts:23-40`, `apps/web/src/lib/data.ts:318-335`, `apps/web/src/components/load-more.tsx:29-41`
- **Why this is a problem:** `loadMoreImages()` deliberately requests `safeLimit + 1` rows so it can tell whether another page exists. But `getImagesLite()` clamps any request to at most 100 rows, so when the caller asks for 100 items the extra sentinel row is discarded and `hasMore` becomes false even if more rows remain.
- **Concrete failure scenario:** if a caller or future UI uses `limit=100` for larger pages, infinite scroll stops one page early because the helper can only return 100 rows and the action infers `hasMore: false` from the truncated result.
- **Suggested fix:** either route `loadMoreImages()` through `getImagesLitePage()` and slice the extra sentinel there, or remove the redundant cap inside `getImagesLite()` when the caller already constrains the limit.
- **Confidence:** High

### 4) [HIGH] No-op admin updates are misreported as “not found” because the code treats `affectedRows === 0` as an existence check on UPDATEs
- **File / region:** `apps/web/src/app/actions/images.ts:592-621`, `apps/web/src/app/actions/tags.ts:74-87`, `apps/web/src/app/actions/topics.ts:241-270`
- **Why this is a problem:** these handlers already fetch the row before updating it, but they still treat `affectedRows === 0` as a missing-record failure. MySQL reports 0 affected rows when an UPDATE writes the same values it already stored, so a valid no-op edit is mistaken for a missing record.
- **Concrete failure scenario:** an admin opens an edit dialog and saves without changing values, or submits sanitized values that normalize back to the original row. The action returns `imageNotFound` / `tagNotFound` / `topicNotFound` even though the row exists. In the topic flow, this can also discard a newly uploaded topic image on a no-op metadata save.
- **Suggested fix:** use the pre-read existence check as the source of truth, or compare `matchedRows` / `changedRows` explicitly if the DB driver is configured to expose them. Do not use `affectedRows === 0` to mean “row missing” after a successful UPDATE.
- **Confidence:** High

### 5) [MEDIUM] Clicking anywhere on the lightbox photo closes it because the click handler is attached to the full-screen container
- **File / region:** `apps/web/src/components/lightbox.tsx:247-280`
- **Why this is a problem:** `onClick={handleBackdropClick}` is on the outer dialog container, and the image itself does not stop propagation. That means the photo surface behaves like a backdrop click target even though it is the primary content.
- **Concrete failure scenario:** a desktop user clicks the image to inspect it, or clicks while fullscreen controls are visible. The lightbox closes immediately, which feels like an accidental dismissal rather than an intentional close action.
- **Suggested fix:** move the close handler to a dedicated backdrop element behind the image, or stop propagation on the image/picture container so clicks on the media do not dismiss the dialog.
- **Confidence:** Medium

## Final sweep
I rechecked the usual bug-prone surfaces after the main pass: async initialization (`db/index.ts`), configuration reads (`gallery-config.ts`), pagination helpers (`public.ts` / `data.ts`), admin update actions (`images.ts`, `tags.ts`, `topics.ts`), and modal/lightbox behavior (`lightbox.tsx`). I did not find evidence that any additional review-relevant file was skipped on this pass.
