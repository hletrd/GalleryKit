# Plan 100 — Cycle 1 RPF v3 Fixes (HEAD: 67655cc)

## Status

DONE — all 10 tasks landed in fine-grained commits during cycle 1
RPF v3. Implementation commits (master, GPG-signed):

- `75849b3` fix(lightbox): size LightboxTrigger to 44x44 touch target — T-100.2 / NF-2a
- `c7fb450` fix(photo-viewer): size desktop Info sidebar toggle to 44px — T-100.3 / NF-2b
- `aef79da` fix(admin-login): size submit button and password toggle to 44px — T-100.4 / NF-1
- `5964c81` fix(load-more): size Load More button to 44px touch target — T-100.6 / NF-5
- `bc7e258` fix(nav): size topic links and site title to 44px touch targets — T-100.5 + T-100.7 / NF-4 + NF-6
- `aca754c` fix(data): restore tag_names aggregation in masonry listing query — T-100.1 / NF-3
- `378a3d7` fix(photo-viewer): wire blur_data_url as background-image preview — T-100.8 / F-10 + F-23 partial
- `0ac6516` test(data): lock getImagesLite tag_names SQL shape against regression — T-100.10 / TE-2
- `8c4069c` test(a11y): codify 44px touch-target floor as fixture audit — T-100.9 / TE-1

Quality-gate evidence (post-fix):

- `npm run lint --workspace=apps/web` — exit 0
- `npm run lint:api-auth --workspace=apps/web` — exit 0
- `npm run lint:action-origin --workspace=apps/web` — exit 0
- `npx tsc --noEmit -p apps/web/tsconfig.json` — exit 0
- `cd apps/web && npx vitest run` — 63 files / 416 tests passed (was 61 / 411 — +2 fixture files / +5 tests)
- `cd apps/web && npm run test:e2e` — see e2e log
- `cd apps/web && npm run build` — see build log

## Summary

Address 6 NEW designer-v2 findings (NF-1..NF-6) and 5 partial-fix follow-ups
(F-10, F-18, F-19, F-20, F-23) surfaced by the user-injected designer review at
`.context/reviews/designer-uiux-deep-v2.md` plus the multi-lens cycle-1 RPF v3
review aggregate at `.context/reviews/_aggregate-cycle1-rpf3.md`.

The two highest-impact tasks are:
- **NF-3 / F-18 partial:** `tag_names` returns null in `getImagesLite` /
  `getImagesLitePage` correlated subquery. Every screen-reader user sees
  "View photo: Untitled" 30 times in a row in the masonry grid.
- **NF-2 (a+b):** LightboxTrigger and desktop Info sidebar toggle are 32 px
  tall — below the 44 px touch-target floor. Affects the primary fullscreen
  interaction.

Both are user-affecting and per the user-injected directive must land this
cycle. None of the findings are deferrable — accessibility/correctness
findings cannot be deferred per CLAUDE.md.

## Tasks

### T-100.1 — Fix `getImagesLite` / `getImagesLitePage` correlated subquery to use LEFT JOIN (NF-3 / F-18 partial)

- **Severity:** High (broken aria-labels in production)
- **File:** `apps/web/src/lib/data.ts:324, 374, 428`
- **Action:** Switch the correlated subquery `(SELECT GROUP_CONCAT(DISTINCT
  t.name ORDER BY t.name) FROM ${imageTags} it JOIN ${tags} t ON it.tag_id =
  t.id WHERE it.image_id = ${images.id})` to LEFT JOIN + Drizzle column refs:
  ```ts
  tag_names: sql<string | null>`GROUP_CONCAT(DISTINCT ${tags.name} ORDER BY
  ${tags.name})`
  // and add to query:
  .leftJoin(imageTags, eq(images.id, imageTags.imageId))
  .leftJoin(tags, eq(imageTags.tagId, tags.id))
  .groupBy(images.id)
  ```
- **Plus:** GROUP BY must include all selected non-aggregated columns when
  MySQL is in `ONLY_FULL_GROUP_BY` mode. Verify by running `npm test`. If
  needed, group by `images.id` only (relies on functional dependency on the
  PK, which is the documented MySQL 5.7+ behavior).
- **Plus:** Apply the same fix to `getImagesAdmin` at line 428 to keep code
  paths unified.
- **Plus:** Update the docblock at `data.ts:309-313` to reflect the new
  rationale.
- **Plus:** Verify the `total_count: COUNT(*) OVER()` window function in
  `getImagesLitePage` (line 375) still works after the JOIN change. If the
  window function semantics shift due to GROUP BY, replace with a separate
  `getImageCount` call (already exists at line 253).
- **Verify:** Run vitest. Run dev server and curl `/en/tws` RSC payload to
  confirm `tag_names` is non-null for image 348.

### T-100.2 — Bump LightboxTrigger to 44 px (NF-2a / F-20 partial)

- **Severity:** High
- **File:** `apps/web/src/components/lightbox.tsx:41`
- **Action:** Change `className="h-8 w-8"` to `className="h-11 w-11"`. Icon
  `<Maximize className="h-4 w-4" />` stays the same.
- **Verify:** Run e2e if available; visually confirm via dev server.

### T-100.3 — Bump desktop Info sidebar toggle to 44 px (NF-2b / F-20 partial)

- **Severity:** High
- **File:** `apps/web/src/components/photo-viewer.tsx:314-328`
- **Action:** Drop `size="sm"`, use default size with explicit `h-11`:
  ```tsx
  <Button
    variant={isPinned ? "default" : "outline"}
    onClick={...}
    className="gap-2 transition-all hidden lg:flex h-11"
  >
  ```
- **Verify:** Visually confirm at 1440 px viewport via dev server.

### T-100.4 — Bump admin login submit + password toggle to 44 px (NF-1)

- **Severity:** Medium
- **File:** `apps/web/src/app/[locale]/admin/login-form.tsx:84, 102`
- **Action:**
  - Submit Button: `className="w-full h-11"`
  - Password toggle: change `w-9 h-9` to `w-11 h-11`
- **Verify:** Visually confirm at 390 px viewport via dev server.

### T-100.5 — Bump nav topic links to 44 px (NF-4)

- **Severity:** Medium
- **File:** `apps/web/src/components/nav-client.tsx:119`
- **Action:** Add `min-h-[44px]` to the topic link className. Existing `flex
  items-center` will center the text vertically.
- **Verify:** Confirm 44 px height at 1440 px and 390 px viewports.

### T-100.6 — Bump Load More to 44 px (NF-5)

- **Severity:** Low
- **File:** `apps/web/src/components/load-more.tsx:102`
- **Action:** Add `className="h-11"` to the Button.
- **Verify:** Confirm 44 px height in masonry footer.

### T-100.7 — Bump site title link to 44 px (NF-6)

- **Severity:** Low
- **File:** `apps/web/src/components/nav-client.tsx:78`
- **Action:** Add `min-h-[44px]` to the Link className.
- **Verify:** Confirm via dev server.

### T-100.8 — Wire blur_data_url to photo-viewer (F-10 / F-23 partial)

- **Severity:** Low
- **Files:**
  - `apps/web/src/components/photo-viewer.tsx:346` — add inline style
    `style={{backgroundImage: image.blur_data_url ? \`url(${image.blur_data_url})\` : undefined, backgroundSize: 'cover'}}` to the photo container div
- **Verify:** Confirm via dev server that the photo container shows the
  blurred preview while the AVIF decodes. Skip if the image lacks
  `blur_data_url` (graceful fallback).

### T-100.9 — Add fixture-style touch-target audit test (TE-1 / A-2)

- **Severity:** Medium (codifies the cycle's lessons)
- **File:** new `apps/web/src/__tests__/touch-target-audit.test.ts`
- **Action:** Vitest fixture test that walks `apps/web/src/components/`
  and `apps/web/src/app/` for `<Button>`, `<button>`, `<Link>` JSX and
  asserts each has either:
  - `h-11`, `h-12`, `h-14`, `h-16` (≥ 44 px Tailwind utility), OR
  - `min-h-[44px]` or larger arbitrary value, OR
  - `size="lg"`, `size="default"` (≥ 36 px and explicitly justified
    via inline allowlist), OR
  - on the documented allowlist (decorative icons, internal flex
    children, etc.)
- **Initial allowlist:** items intentionally smaller than 44 px due to
  context (decorative icons inside larger flex parents; controls inside
  modals where keyboard nav is primary). Document each entry.
- **Verify:** `npm test --workspace=apps/web` passes.

### T-100.10 — Add unit test locking `getImagesLite` `tag_names` non-null contract (TE-2 / A-1)

- **Severity:** Medium (locks the NF-3 fix against regression)
- **File:** new `apps/web/src/__tests__/get-images-lite-tag-names.test.ts`
  OR extension of `data-pagination.test.ts`
- **Action:** Use the test DB seed harness to create an image with 2+
  tags, call `getImagesLite()`, assert `result[0].tag_names` is a
  non-null string containing both tag names.
- **Verify:** Test passes. (Test will fail against the broken correlated
  subquery, then pass after T-100.1 lands — write the test FIRST as a
  TDD seatbelt.)

## Sequence

1. T-100.10 (write test first; expect failure to confirm the bug).
2. T-100.1 (fix data.ts; expect T-100.10 to pass).
3. T-100.2, T-100.3, T-100.4, T-100.5, T-100.6, T-100.7 (touch-target
   bumps in parallel).
4. T-100.8 (blur placeholder wiring).
5. T-100.9 (fixture-style touch-target audit).
6. Run all gates (`npm run lint`, `npm run lint:api-auth`,
   `npm run lint:action-origin`, `npm test`, `npm run test:e2e`,
   `npm run build`, `npm run typecheck` if available).
7. Per-task fine-grained commit + push, GPG-signed.
8. Run `npm run deploy` after gates green.

## Deferred / not-in-scope

- **F-19 (mobile nav scroll affordance):** Designer-v2 noted this is
  unchanged from prior — not regressed. The mask-gradient is a soft
  affordance. A scroll-snap or visible chevron would help but is a
  design change rather than an accessibility fix. Defer with exit
  criterion: "if mobile users continue to miss horizontal scroll, add
  scroll-snap or visible chevron in a future cycle."
  - **Severity at defer:** Low (carryover from designer-v2; not a
    regression).
  - **File+line citation:** `apps/web/src/components/nav-client.tsx:103-109`.
  - **Reason for deferral:** Tracking-only; not an accessibility hard
    failure since the topics are reachable via keyboard tab order. The
    fix would be design-discretion.
  - **Exit criterion to re-open:** User-reported confusion or analytics
    showing < 30% of mobile users discover topics beyond the visible
    pill row.

- **AGG3L-INFO-03 (`humanizeTagLabel` whitespace edge case):**
  Non-current data shape per AGG3L-INFO-03. Tracking only.
  - **Severity at defer:** Low.
  - **File:** `apps/web/src/lib/photo-title.ts` (helper).
  - **Reason:** Defensive coding for non-current data shape.
  - **Exit criterion:** First report of `_Music__Festival_`-shaped tag
    name appearing.

- **DS-2 (codify 44 px rule in CLAUDE.md):** Optional small doc update.
  Skip unless capacity. Defer to next cycle.
  - **Severity at defer:** Low.
  - **File:** `CLAUDE.md`.
  - **Reason:** Doc-only; the fixture test (T-100.9) will catch
    regressions.
  - **Exit criterion:** Not strict; pick up when next CLAUDE.md edit
    pass occurs.

## Gate work plan (GATE_FIXES bucket)

- After landing T-100.1, run vitest. The existing
  `apps/web/src/__tests__/data-pagination.test.ts` may need adjustment
  if the pagination `total_count` changes shape with the JOIN.
- After landing T-100.9, the new fixture test may surface additional
  46 px / 32 px components beyond the designer-v2 inventory. Treat any
  surfacing failures as in-scope GATE_FIXES (root-cause fix; no
  suppressions).

## Acceptance criteria

- All 10 tasks landed.
- All gates green.
- `npm run deploy` succeeds.
- RSC payload check: `curl /en/tws` shows `tag_names` non-null for image
  348.
- DOM measurement check: LightboxTrigger, admin submit, admin password
  toggle, nav topic link, Load More, site title all measure ≥ 44 px in
  height (per appropriate viewport).
