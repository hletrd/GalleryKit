# UI/UX Designer Reviewer - Cycle 17

Repository: `/Users/hletrd/flash-shared/gallery`
Scope: GalleryKit, a Next.js self-hosted finished-photography gallery for visitors, photographers/admins, and operators.

## UI/UX Inventory

Reviewed project guidance first: `AGENTS.md`, `CLAUDE.md` UI/color/HDR/i18n/touch-target sections, `README.md`, `apps/web/README.md`, and prior UI/design review history under `.context/reviews/`, especially the current `ui-ux-designer-reviewer.md`, `ui-ux-designer-reviewer-cycle13.md`, `.context/reviews/ui-ux-r2/_aggregate.md`, photographer-perspective review history, and screenshot/review archive entries.

Current UI surface inventory:

- Locale app routes: 50 TS/TSX files under `apps/web/src/app/[locale]`.
- Public visitor routes: `(public)/page.tsx`, topic pages, photo page/loading/layout, year/timeline/map/privacy/about pages, smart/shared collection pages, uploads route, and feed route.
- Admin routes: dashboard, categories, tags, SEO, settings, tokens, password, users, DB, analytics, admin layout/login/protected loading/error.
- Components: 61 TS/TSX files under `apps/web/src/components`, including public nav/search/home/masonry/photo-viewer/lightbox/info-bottom-sheet/color details/map/upload/admin header/admin nav/image manager/tag inputs/dialog primitives.
- Messages: `apps/web/messages/en.json` and `apps/web/messages/ko.json`.
- Styling/theme: `apps/web/src/app/[locale]/globals.css`, `apps/web/src/components/theme-provider.tsx`, and shadcn/Radix primitives.
- UI-relevant tests/artifacts: 355 test files under `apps/web/src/__tests__`, 10 Playwright e2e files under `apps/web/e2e`, plus current `.context/reviews/*` design artifacts. Detailed validation focused on touch target, focus, i18n, theme token, lightbox, bottom-sheet, settings-save, analytics link, GPS map link, and select touch-target contract tests.

I did not use raw screenshots as finding evidence. Source lines, tests, and live DOM measurements are the evidence basis.

## Validation Evidence

- Targeted UI contract tests passed: `npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/focus-visible-rings-cycle17.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/password-form-a11y.test.ts src/__tests__/theme-token-contract.test.ts src/__tests__/lightbox-controls-contract.test.ts src/__tests__/info-bottom-sheet-ia.test.ts src/__tests__/settings-save-affordance-source.test.ts src/__tests__/analytics-link-touch-targets.test.ts src/__tests__/gps-map-link-touch-targets.test.ts src/__tests__/select-item-touch-target.test.ts` -> 12 files passed, 66 tests passed.
- Local browser execution was limited: `curl http://localhost:3000/en` failed with connection refused, and the previous dev-server start path was blocked by a Next dev-server lock. I did not stop or kill external processes.
- Live public DOM probe against `https://gallery.atik.kr/en`, mobile 390x844: body width 390, first photo link rect `{x:16,y:412,width:358,height:238}`, first photo accessible label `View photo: #Color in Music Festival #DOHOON #JIHOON #348`.
- Live admin login DOM probe against `https://gallery.atik.kr/ko/admin`, mobile dark 390x844: `lang="ko"`, body width 390, visible username/password inputs 308x44, show-password button 44x44, submit 308x44. This supports the login page touch-target and Korean baseline; authenticated admin pages were reviewed from source/tests rather than a live credentialed session.

## Confirmed Issues

### UIUX-C17-01 - Mobile home still pushes the first photo below introductory chrome

Severity: Medium
Confidence: High
Area: visitor workflow, information architecture, responsive layout, keyboard/touch navigation, perceived performance

Evidence:

- `apps/web/src/components/home-client.tsx:287-306` renders the page heading and full `TagFilter` before the photo grid.
- `apps/web/src/components/home-client.tsx:318-330` renders the masonry photo grid only after that header/filter block.
- `apps/web/src/components/tag-filter.tsx:63-122` renders every tag as a real 44 px minimum button in one wrapping `role="group"` with no collapsed/overflow mode.
- Live mobile probe at 390x844 on `https://gallery.atik.kr/en`: the first photo link starts at `y=412`, so the first finished photograph is below about half the viewport. The live site currently had no tag buttons in that locale state; source still shows the issue scales with any non-empty tag list.

Why this is a problem:

GalleryKit's primary visitor promise is finished photography presentation. On small screens, the first visual asset should be the dominant early signal. The current composition lets utility filters consume the pre-gallery space, and each additional tag increases the distance before a visitor sees the work.

Failure scenario:

A photographer shares the public home page after adding 20-40 tags. A phone visitor lands on a heading plus a wall of topic/tag controls, must scroll before seeing a photograph, and experiences the gallery as a catalog/filter UI rather than a finished-photography presentation.

Suggested fix:

Keep one compact active-filter/primary-topic affordance above the grid, then move the full tag set behind a disclosure, horizontal overflow list, or filter sheet. Preserve the existing 44 px target floor inside the expanded mode. Consider showing the first row of photos before secondary filters on mobile.

### UIUX-C17-02 - Admin dashboard image management remains a table-first workbench

Severity: Medium
Confidence: High
Area: photographer/admin workflow, responsive admin ergonomics, professional presentation, perceived efficiency

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-143` places upload and recent uploads in a split layout only at `2xl`, with the image manager inside `max-h-[calc(100vh-16rem)] overflow-auto`.
- `apps/web/src/components/image-manager.tsx:427-451` uses an overflow-x table with columns for selection, preview, title, filename, topic, tags, gamut, date, and actions.
- `apps/web/src/components/image-manager.tsx:475-490` gives each preview a fixed 128x128 cell.
- `apps/web/src/components/image-manager.tsx:502-536` embeds tag editing inside a table cell with a 200 px minimum.
- `apps/web/src/components/image-manager.tsx:555-590` puts edit/delete actions at the far right of the wide row.

Why this is a problem:

The admin's core job is to curate finished work, check color/GPS metadata, and correct titles/tags. A spreadsheet layout is efficient for dense records but weak for visual review: previews are small, horizontal scrolling separates the photo from its actions, and mobile/tablet admin use is a wide-table navigation exercise.

Failure scenario:

An admin uploads a set from a phone or small laptop, notices one photo has the wrong topic or tag, then must pan horizontally from thumbnail/title to tags/actions while keeping row context. The layout increases the chance of editing the wrong row and makes quality-control review feel less like a photographer's workbench.

Suggested fix:

Introduce a responsive card/list workbench below large desktop widths: larger thumbnail, title/filename/topic as the row header, inline chips for color/HDR/GPS status, and grouped primary actions near the image. Keep a dense table as a desktop or "compact" mode for power users.

### UIUX-C17-03 - Admin navigation is a flat ten-link wrap with weak grouping

Severity: Low-Medium
Confidence: High
Area: admin information architecture, responsive layout, navigation clarity

Evidence:

- `apps/web/src/components/admin-nav.tsx:15-26` defines ten peer links: dashboard, categories, tags, SEO, settings, tokens, password, users, DB, analytics.
- `apps/web/src/components/admin-nav.tsx:28-49` renders them as one `flex flex-wrap` navigation group.
- `apps/web/src/components/admin-header.tsx:13-27` places the brand, nav, and logout in a wrapping header without section grouping.

Why this is a problem:

The nav mixes publishing work, taxonomy, site settings, security, user management, database operations, and analytics at one visual level. Wrapping preserves touch targets but does not preserve mental grouping; as the nav grows, spatial memory changes by viewport width and translation length.

Failure scenario:

A Korean admin on a narrower tablet sees the nav wrap differently from desktop. "토큰", "비밀번호", "사용자", "DB", and "분석" compete with day-to-day publishing links, increasing search time for common workflows and making high-risk operational pages feel as prominent as routine editing.

Suggested fix:

Group the admin IA into stable sections such as Publish, Organize, Site, Access, Operations, and Insights. On mobile/tablet, use a drawer or segmented admin menu with the active section visible, rather than a single wrapping strip.

### UIUX-C17-04 - Token revoke confirmation does not identify the token

Severity: Medium
Confidence: High
Area: admin error prevention, destructive action UX, external upload workflow

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:34` stores only `confirmRevokeId`.
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:175-193` shows each token label/scopes and gives the row button a label-specific `aria-label`.
- `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:303-324` renders the confirmation dialog from only `lrToken.revokeTitle` and `lrToken.revokeDesc`; the visible dialog does not include the selected token label, scope, or last-used timestamp.
- `apps/web/messages/en.json:890-891` and `apps/web/messages/ko.json:940-941` are generic: "Revoke token?" / "토큰을 철회하시겠습니까?"

Why this is a problem:

Revoking an upload token immediately blocks external clients. The initiating row has a target-specific accessible name, but the destructive confirmation loses the target. This violates the same error-prevention standard already applied elsewhere in the repo for image/category/tag deletion.

Failure scenario:

An admin opens revoke on a dense token list, is interrupted, returns to a generic confirmation dialog, and confirms without knowing whether the selected token was the Lightroom upload token or a test token.

Suggested fix:

Store the selected token object for confirmation, not just the id. Interpolate the label into the title/description/action, and include secondary context such as scopes and last-used date. Do not display token plaintext; label plus metadata is enough.

### UIUX-C17-05 - Category alias deletion confirmation omits the alias being removed

Severity: Medium
Confidence: High
Area: admin error prevention, routing/share-link compatibility, form/dialog UX

Evidence:

- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:389-397` renders each alias chip and starts deletion with `{ topicSlug, alias }`; the chip button's accessible name includes the alias.
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:431-458` renders the confirmation dialog, but the title and description are generic and do not include `deleteAliasInfo.alias`.
- `apps/web/messages/en.json:95-97` and `apps/web/messages/ko.json:95-97` provide generic alias-confirmation copy, while the button label has an `{alias}` placeholder.

Why this is a problem:

Aliases are URL compatibility affordances. Deleting the wrong one can break older shared links. The visible confirmation should preserve target context at the point of irreversible action.

Failure scenario:

An admin cleans up aliases on a category with several legacy slugs. After opening the confirmation, the dialog says only "Delete this alias?", and the admin cannot verify which shared-link path will stop working.

Suggested fix:

Interpolate the alias and category label into the confirmation title/description, for example `Delete alias "{alias}" from "{label}"?`. Keep the destructive button generic or make it target-specific if space allows.

## Likely Issues

### UIUX-C17-06 - Analytics countries are displayed as raw region codes only

Severity: Low
Confidence: Medium-High
Area: admin analytics ergonomics, i18n/Korean, data legibility

Evidence:

- `apps/web/src/lib/analytics-data.ts:88-132` defines `CountryRow` as `{ country_code, viewCount }` and returns raw codes from the query.
- `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:169-198` renders the country breakdown table.
- `apps/web/src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx:188-191` prints `row.country_code` directly in a monospace cell.
- `apps/web/messages/en.json:936-942` and `apps/web/messages/ko.json:907-912` localize the table heading/columns but not the country values.

Why this is a problem:

Raw `KR`, `US`, or null-like values are compact for logs, but less useful for a self-hosted admin analytics UI, especially in Korean. This is not a WCAG failure, but it weakens scanability and localization completeness.

Failure scenario:

A Korean admin reviewing country traffic sees two-letter ISO codes instead of `대한민국`, `미국`, or a localized unknown state. The admin has to translate codes mentally while comparing view counts.

Suggested fix:

Use `Intl.DisplayNames([locale], { type: 'region' })` for display names, with a localized "Unknown" fallback. Keep the raw code as secondary text or a `title` attribute when helpful for diagnostics.

## Risks Needing Manual Validation

- Authenticated admin flows beyond the login page were not browser-clicked in a local session because no local dev server was available and I did not use production credentials. Source and tests support the findings, but a follow-up credentialed Playwright pass should verify the responsive admin dashboard, token dialog, category alias dialog, and analytics table in the running app.
- RTL is structurally future-proofed at the root (`apps/web/src/app/[locale]/layout.tsx:101-107` sets `lang` and `dir`), but only English and Korean are shipped. I did not classify RTL as a current issue.
- Browser/display-dependent color and HDR behavior still requires physical-device validation. Source/docs show the intended audit surfaces, but a code-only review cannot prove actual P3/HDR rendering on every OS/browser/display combination.

## Positive Coverage And Non-Issues

- Touch target policy is strongly represented: `AGENTS.md:44` requires 44 px minimum targets, and the targeted touch tests passed. Live admin login controls measured 44 px high on mobile.
- Theme and contrast contracts are explicit: root/dark/oled tokens are defined in `apps/web/src/app/[locale]/globals.css:14-101`, and theme selection is wired in `apps/web/src/app/[locale]/layout.tsx:136-144`.
- Reduced motion is handled globally for interactions in `apps/web/src/app/[locale]/globals.css:253-279`.
- Search dialog accessibility is strong: focus trap, `role="dialog"`, combobox/listbox semantics, live status, keyboard instructions, and 44 px close target appear in `apps/web/src/components/search.tsx:410-571`.
- Upload empty/loading/error states are well covered: no-topic first-run state with direct category link, disabled dropzone semantics, skipped-file status, and progressbar appear in `apps/web/src/components/upload-dropzone.tsx:373-483`.
- Prior cycle issue not reopened: image deletion now names the target in the dialog at `apps/web/src/components/image-manager.tsx:458` and `apps/web/src/components/image-manager.tsx:563-572`.
- Prior cycle issue not reopened: photo viewer sidebar transition was reduced to 200 ms in current source (reviewed during source sweep).
- Prior cycle issue not reopened: mobile nav DOM order has been corrected in current source (reviewed during source sweep).

## Requested Area Coverage

- Information architecture: findings C17-01, C17-03.
- Affordances/admin ergonomics: findings C17-02, C17-04, C17-05, C17-06.
- Focus/keyboard navigation: tested focus-visible contracts passed; search and upload source reviewed.
- WCAG 2.2/touch targets: targeted tests passed; remaining issues are IA/error-prevention rather than target-size failures.
- Responsive breakpoints: findings C17-01, C17-02, C17-03.
- Loading/empty/error states: upload/search/photo loading states reviewed; no new blocking issue found.
- Form validation/destructive confirmations: findings C17-04 and C17-05.
- Dark/light mode: token contracts and live dark admin login probe passed; no new blocking issue found.
- i18n/Korean/English copy: finding C17-06 plus live Korean login probe; message parity test passed.
- Perceived performance: finding C17-01 and C17-02 affect perceived speed to content and admin task efficiency.

## Final Missed-Issues Sweep

No UI route, component, message, or prior-review category in the inventory was intentionally skipped. Non-UI backend tests among the 355 test files were not individually reviewed because they are outside this UI/UX lane. The most important unresolved validation gap is a credentialed local/admin browser pass; current findings are still source-backed and test-supported.
