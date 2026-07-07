# Cycle 10 UI/UX Designer Reviewer - 2026-07-07

Review persona: professional UI/UX critical reviewer adapted to GalleryKit's Next.js photo-gallery product. I treated the local `ui-ux-designer-reviewer.md` as a perspective source only; its BurstPick/native-app workflow requirements do not apply to this web gallery. No source files were edited.

## Executive Summary

GalleryKit's current public UI is much stronger than a typical self-hosted gallery: touch targets, focus rings, live regions, lightbox controls, reduced-motion handling, and localized routes have substantial existing coverage. The distinct missed UI issue I found is in search result legibility: keyword search can match tags and topic aliases, but untitled result rows do not display those matched tags, so high-volume searches like "JIHOON" render a list of generic "Photo 348", "Photo 347" rows. That is a workflow failure for browsing dense event galleries because the UI confirms that something matched without showing why it matched.

## Inventory Built First

- Project guidance and architecture: AGENTS instructions from the prompt and `CLAUDE.md`.
- Prior cycle 10 artifacts: `designer.md`, `code-reviewer.md`, `critic.md`, `debugger.md`, `perf-reviewer.md`, `security-reviewer.md`, `test-engineer.md`, `tracer.md`, `verifier.md`.
- Public UI routes/components: home/topic masonry, timeline/year, photo viewer, lightbox, info bottom sheet, map, shared group/link pages, search, nav, footer.
- Admin UI routes/components: login, dashboard/upload, image manager, settings, SEO, analytics, users, tokens, DB/password pages.
- Design-system/a11y sources: `globals.css`, Tailwind config, shadcn UI primitives, `touch-target-audit.test.ts`, focus/i18n/password a11y tests.
- Browser evidence: live `https://gallery.atik.kr/en`, `/en/p/348`, search dialog, and lightbox at 390 px mobile and 1440 px desktop.

## Findings

### UIUX-C10-01 - Search matches tag-heavy photos but renders generic result labels

- Severity: Medium
- Confidence: High
- Exact region:
  - `apps/web/src/lib/data.ts:1556-1569` defines `SearchResult` without `tag_names` or `alt_text_suggested`.
  - `apps/web/src/lib/data.ts:1599-1605` selects only title/description/topic/camera/lens/date fields for search rows.
  - `apps/web/src/lib/data.ts:1673-1695` explicitly searches matching `tags.name`, but still selects the same tag-less row shape.
  - `apps/web/src/components/search.tsx:71` builds the visible row label with `getPhotoResultLabel(image, "Photo {id}")`.
  - `apps/web/src/lib/photo-title.ts:85-99` makes `getPhotoResultLabel` fall back to the generic ID when title and description are empty.
- Browser evidence:
  - Live Playwright check on `https://gallery.atik.kr/en`, search query `JIHOON`, returned rows with visible labels `Photo 348`, `Photo 347`, `Photo 346`, `Photo 345`, `Photo 344`.
  - The same rows showed only topic/camera/lens/date secondary metadata, even though the query matched a visible gallery tag and the photo page title for `/en/p/348` is `#JIHOON #DOHOON #Color in Music Festival`.
- Failure scenario:
  - A visitor searches for a performer, client name, location, or event tag in a gallery where most photos are intentionally untitled. The app returns the right set, but every row looks like a generic numbered file. Keyboard and screen-reader users moving through the list cannot tell which result matched which tag without opening each photo, returning to search, and trying the next one. For a concert or event set with dozens of near-duplicate images, this makes search feel unreliable even when the backend result set is correct.
- Concrete fix:
  - Return public-safe display context with search results. The most direct option is adding `tag_names: tagNamesAgg` to keyword search results and using the same display-title path as masonry cards, such as `getPhotoDisplayTitleFromTagNames(image, fallback)`.
  - If adding `GROUP_CONCAT` to every main search query is too expensive, keep the current matching query lean, then run a second bounded aggregate query for the returned image IDs and merge `tag_names` into the 20 displayed rows.
  - Include the same enrichment in semantic search result rows or normalize both keyword and semantic result data through one client-safe result-label helper.
  - Add a regression test with an untitled, tag-matched photo asserting that the rendered search label includes the humanized tag text rather than only `Photo {id}`.

## Validated Prior Finding Not Duplicated

The existing cycle 10 `designer.md` finding about duplicate accessible names in Timeline and Year archive cards is valid and distinct from this report. I verified the source shape still differs from `MasonryCard`: timeline/year cards pass `aria-label={tAria('viewPhoto', { title: displayTitle })}` without the unique `#id` suffix used by home masonry. I did not re-file it as a new finding because the current cycle already records it with browser evidence.

## No-Finding Areas With Evidence

- Touch target and focus gates passed: `touch-target-audit`, `focus-visible-links-scan`, `i18n-key-parity`, and `password-form-a11y` all passed in a targeted run.
- Live home at 390 px had no horizontal overflow; first photo-card links include unique accessible labels such as `View photo: #Color in Music Festival #DOHOON #JIHOON #348`.
- Live photo viewer at 390 px had no horizontal overflow and exposed a named zoom button: `JIHOON, DOHOON, Color in Music Festival. Click to zoom in`.
- Lightbox auto-hide was checked: after controls hid, Tab focus revealed the close button within about 600 ms, so I did not count hidden-but-focusable controls as a current blocker.
- Search modal structure is generally sound: dialog label, combobox, listbox/options, IME guards, focus restore, scroll lock, and keyboard instructions are present.
- Existing admin/upload UI shows mature patterns: 44 px controls, settle-before-close confirmation dialogs, field-level errors on key forms, and focus restoration after pending states.

## Verification

Targeted test command:

```sh
npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/i18n-key-parity.test.ts src/__tests__/password-form-a11y.test.ts
```

Result: 4 test files passed, 34 tests passed.

Browser checks used Playwright against the live site for home, search, photo viewer, and lightbox. Console noise was limited to the known Google Analytics CSP/headless external request failures and a preload warning; I did not observe app runtime exceptions.

## Final Missed-Issues Sweep

I swept UI/a11y source patterns for ARIA roles/labels, `tabIndex`, hidden focusables, compact buttons, truncation, overflow containers, and prior cycle 10 reports. I did not find another distinct UI/UX defect that met the bar without duplicating existing designer, performance, or test-engineer findings. The remaining notable admin-mobile table concern is already covered in prior designer history, and the archive accessible-name problem is already filed in this cycle.
