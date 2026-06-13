# R27 — UI/UX Review from Photographer + Client Lens
**Date:** 2026-05-19
**Pass:** R27 (twelfth deep pass)
**Lens:** Working pro photographer (Eizo + iPhone Pro P3) + photo-recipient client (iPad Pro, Firefox X1 Carbon, Chrome Android); bilingual KO/EN.

## Result

**NEW_FINDINGS: 6**

---

### R27-UX-HIGH-1 — Backfill requires SSH/CLI with no in-app trigger

**Severity:** HIGH
**Confidence:** 90
**Files:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:146-152`, `apps/web/messages/en.json:735`, `apps/web/messages/ko.json:735`

**User-visible symptom:** When a photographer changes a color-impacting setting (e.g. `force_srgb_derivatives`, `avif_effort`, `wide_gamut_jpeg_chroma`), a warning banner appears: "These changes require running the backfill script to re-encode existing photos." There is no button, link, or scheduled trigger anywhere in the admin UI. The only path to actually running the backfill is SSH into the server and executing a docker sidecar command. A photographer on their iPhone Pro or iPad Pro viewing the admin settings page hits a dead end.

**Impact:** HIGH — the warning correctly surfaces the problem but provides zero path to resolution from within the app. A photographer working remotely (common scenario: on-location, adjusting wide-gamut chroma settings after noticing a client's exported album looks wrong) cannot act on the warning. The `backfillRequiredHint` i18n string in both `en.json` and `ko.json` explicitly says "run the backfill script" — confirming the CLI-only design is intentional, but this creates a capability gap that is visible and actionable from the admin UI standpoint.

**Technical detail:** `settings-client.tsx:146-152` renders the yellow warning banner conditioned on `hasDirtyBackfillField && hasExistingImages`. No adjacent button or action is wired. The `COLOR_HDR_BACKFILL_KEYS` set at lines 38-52 correctly identifies the triggering settings, but the resulting UX leaves the photographer in a no-op state. The CLAUDE.md backfill section documents the sidecar docker run command, which is not accessible from any browser.

**Proposed fix:** Add a "Queue Backfill" server action (protected by `requireSameOriginAdmin()`) that sets a persistent `backfill_pending = true` flag in `admin_settings`. The existing image-processing queue can check this flag on startup and after each job to drain a backfill pass. Alternatively, surface a dismissible "requires CLI" callout with the exact docker command copyable to clipboard, so at minimum the photographer on a laptop can copy-paste into terminal without consulting CLAUDE.md.

**Acceptance:** Admin settings page: after changing a `COLOR_HDR_BACKFILL_KEYS` field and saving, either (a) a "Trigger Backfill" button is present and functional, OR (b) the warning clearly states this requires server access and provides the exact command.

---

### R27-UX-MED-1 — ColorDetailsSection accordion default-open state stale across photo navigation

**Severity:** MED
**Confidence:** 88
**Files:** `apps/web/src/components/color-details-section.tsx:169-174`

**User-visible symptom:** When navigating between photos in the sidebar without a full page reload — P3 photo → sRGB photo — the color details accordion stays expanded (open) even though `isNonTrivialColor` is now false for the sRGB photo, so the empty/minimal accordion is incorrectly default-open. Conversely, navigating sRGB → P3 photo leaves the accordion collapsed even though `isNonTrivialColor` is now true, causing the photographer to miss the color metadata entirely until they manually click.

**Impact:** MED — a professional photographer navigating their wedding/portrait portfolio will frequently move between edited P3 shots and sRGB JPEGs. The incorrect default-open/closed state on every navigation requires manual correction and obscures the intended UX signal ("this photo has non-trivial color").

**Technical detail:**
```ts
// color-details-section.tsx:174
const [showColorDetails, setShowColorDetails] = useState(isNonTrivialColor);
```
`useState(isNonTrivialColor)` captures the value at mount time only. React does not re-initialize `useState` when props change — the derived `isNonTrivialColor` recomputes on each render but the `useState` initial value is discarded after mount. When the parent photo-viewer navigates to a different `image` prop without remounting `<ColorDetailsSection>`, the accordion state is stale.

**Proposed fix:** Add a `useEffect` that resets accordion state when the image identity changes:
```ts
useEffect(() => {
    setShowColorDetails(isNonTrivialColor);
}, [image.id]); // or image.filename_avif as stable identity
```

**Acceptance:** Navigate from a P3 photo to an sRGB photo in the viewer sidebar: accordion is collapsed. Navigate sRGB → P3: accordion is expanded.

---

### R27-UX-MED-2 — Analytics view counts shown without approximate/buffered disclosure

**Severity:** MED
**Confidence:** 82
**Files:** `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:107,138,169,200`

**User-visible symptom:** The analytics dashboard shows raw integer view counts (e.g. "1,247") for top photos, top topics, countries, and referrers with no indication that these numbers are approximate. CLAUDE.md explicitly documents: "View counts are buffered in process memory and flushed asynchronously, so a crash, process kill, or extended DB outage can undercount delivered views. Do not treat it as billing/audit-grade state." A photographer quoting view counts to a client ("your wedding album was viewed 847 times") could give confidently incorrect numbers.

**Impact:** MED — the misrepresentation risk is real for a professional using view data in client conversations. The buffered/approximate nature is an architectural property that photographers cannot infer from "1,247" displayed with `tabular-nums` precision formatting.

**Technical detail:** Lines 107, 138, 169, 200 all render `{row.viewCount.toLocaleString()}` — precise decimal formatting with no qualifier. No footnote, tooltip, or subheading in `analytics-client.tsx` mentions approximate counts. The i18n files (`en.json`, `ko.json`) have no `analytics.approximateDisclaimer` key.

**Proposed fix:** Add a small footnote below each table (or a single page-level callout): "View counts are approximate and may undercount if the server restarted recently." Add corresponding i18n keys `analytics.approximateDisclaimer` (EN) / `analytics.approximateDisclaimer` (KO: "조회수는 근사치이며, 서버가 최근 재시작된 경우 실제보다 낮을 수 있습니다.").

**Acceptance:** Analytics page: at least one visible indicator per table (or one page-level note) clarifies that view counts are approximate/best-effort.

---

### R27-UX-MED-3 — Histogram buried below full EXIF grid in mobile bottom sheet

**Severity:** MED
**Confidence:** 82
**Files:** `apps/web/src/components/info-bottom-sheet.tsx:457-471`

**User-visible symptom:** On a 360 px Android phone with the bottom sheet expanded, the histogram is rendered after the complete EXIF data grid (camera model, lens, focal length, aperture, shutter speed, ISO, flash, metering, white balance, exposure compensation, subject distance, color space, capture date/time — 14+ rows). The histogram requires significant scrolling to reach. A photographer checking exposure on-the-go (iPhone Pro at a wedding) opens the bottom sheet expecting the histogram at the top and instead must scroll through all camera metadata first.

**Impact:** MED — the histogram is the primary color/exposure QC tool in the mobile view. Its placement after the full EXIF grid inverts the use-frequency order: photographers check histograms constantly and camera model rarely. On a 360 px phone the histogram may be 600+ px below the sheet's top edge.

**Technical detail:** `info-bottom-sheet.tsx:457-471` positions the `<Histogram>` inside the scrollable content area, after the EXIF data block (which ends around line 455). The capture date row follows at line 473, so the histogram is sandwiched between EXIF and capture date but below the longest content block.

**Proposed fix:** Move the `<Histogram>` block to the top of the expanded sheet content, before the EXIF grid. Since the histogram is lazy-mounted (only rendered after the sheet is expanded), moving it up introduces no performance regression. Alternatively, if EXIF-first ordering is intentional, add a sticky "Jump to Histogram" anchor link at the sheet header.

**Acceptance:** On a 375 px viewport with bottom sheet expanded, the histogram is visible within the first two scrollable screenheights without needing to scroll past the full EXIF grid.

---

### R27-UX-MED-4 — Shared-group view analytics absent from admin UI

**Severity:** MED
**Confidence:** 80
**Files:** `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx`

**User-visible symptom:** The analytics dashboard shows top photos and top topics but has no section for shared group (album share link) view counts. A photographer who shares a curated album link with a wedding client cannot see how many times that specific share link was opened. The `shared_group_views` table is documented in CLAUDE.md and the schema, but its data surfaces nowhere in the admin analytics UI.

**Impact:** MED — for a professional photographer, share-link analytics is the primary engagement metric for client deliveries. Knowing "your wedding album share link was opened 23 times across 4 countries" is directly useful in client conversations. The current gap means the `shared_group_views` table accumulates data that the admin can never access without direct DB queries.

**Technical detail:** `analytics-client.tsx` fetches and renders `image_views` (top photos by view) and `topic_views` (top topics by view), plus country/referrer breakdowns — but no `shared_group_views` aggregation. The CLAUDE.md schema section lists `shared_group_views` alongside `image_views` and `topic_views` as analytics event tables (US-P44). The server-side data fetch (not fully read but inferred from the client component shape) does not include a `topSharedGroups` query.

**Proposed fix:** Add a "Top Shared Albums" table to the analytics page, joining `shared_group_views` with `shared_groups` for the album name/key. Surface total views and unique viewer count (if available) per share link. Add i18n keys `analytics.topSharedAlbums` / `analytics.sharedAlbum` (KO: `공유 앨범`).

**Acceptance:** Admin analytics page shows a "Top Shared Albums" section with share link name and view count for the selected time window.

---

### R27-UX-LOW-1 — Touch-target audit SCAN_ROOTS excludes public page-level route files

**Severity:** LOW
**Confidence:** 85
**Files:** `apps/web/src/__tests__/touch-target-audit.test.ts:53-56`

**User-visible symptom:** None currently visible — this is a test coverage gap. Interactive elements added directly to `app/[locale]/(public)/p/[id]/page.tsx`, `app/[locale]/g/[key]/page.tsx`, or `app/[locale]/s/[key]/page.tsx` would not be caught by the 44 px touch-target audit, allowing undersized touch targets to ship to mobile users silently.

**Impact:** LOW — the risk is latent, not currently realized. Component-level coverage (`components/`) is thorough. The risk materializes only if a future page-level change adds an interactive element inline at the page level rather than in a component. However, the policy (CLAUDE.md: "44x44 px minimum — all interactive elements") applies to all interactive elements, and the gap in `SCAN_ROOTS` creates a structural blind spot.

**Technical detail:**
```ts
// touch-target-audit.test.ts:53-56
const SCAN_ROOTS: ReadonlyArray<string> = [
    componentsDir,
    adminDir,
];
```
`app/[locale]/(public)/` is not in `SCAN_ROOTS`. The `appLevelErrorFiles` supplement at lines 42-49 adds only `global-error.tsx` and `[locale]/error.tsx` — not the public route pages.

**Proposed fix:** Add the public route group to `SCAN_ROOTS`:
```ts
const publicDir = path.resolve(srcRoot, 'app', '[locale]', '(public)');
const SCAN_ROOTS: ReadonlyArray<string> = [
    componentsDir,
    adminDir,
    publicDir,
];
```
Set `KNOWN_VIOLATIONS` entries to `0` for each public page file initially (since they currently delegate to components). This closes the structural gap without adding any false positives.

**Acceptance:** `SCAN_ROOTS` includes `app/[locale]/(public)/`; the test suite continues to pass; any future undersized touch target added to a public page file causes a hard test failure.

---

## Closed items (not re-raised)

The following items from prior passes were verified closed at HEAD and are not re-raised:

- **R5-M5**: Masonry P3 badge accessible name (`home-client.tsx:353-355`) and lightbox pip aria-label (`lightbox-color-pip.tsx:123-127`) — confirmed closed (commit `3aa9704b`).
- **R5-M6**: Dashboard retry failure shows toast error — confirmed closed (`dashboard-client.tsx:51,55`, commit `da9f27bd`).
- **R5-M7**: Copy failure uses `viewer.copyFailed` key + clipboard JSON includes `avif_10bit` — confirmed closed in both `color-details-section.tsx:218` and `lightbox-color-pip.tsx:69` (commit `40197967`).
- **R5-L-BUNDLE**: Dead `admin` branch in `isNonTrivialColor` in info-bottom-sheet — confirmed closed (`info-bottom-sheet.tsx:178-184`, commit `c13ca9d0`).
