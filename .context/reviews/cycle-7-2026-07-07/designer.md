# Cycle 7 — Designer (UI/UX + WCAG 2.2 Accessibility) Review

**Reviewer angle:** static UI/UX + accessibility review of `apps/web/src/components/` and
route pages under `apps/web/src/app/[locale]/`. Review baseline: committed HEAD `14d31ea4`.
No dev server was started (shared worktree, peer session active). All findings derived from
source reading, the shadcn `Button` CVA definition, the project's own Tailwind config, and the
`en.json`/`ko.json` message catalogs. Extra scrutiny applied to peer commits `14d31ea4`
("surface discovery and safer confirmations") and `4d37daa4` ("clarify search and collection
cues") per the briefing.

Findings checked against `.context/plans/deferred-carry-forward.md` and the
`cycle-{1..6}-2026-07-0*-deferred.md` registers before being reported. One candidate finding
(AlertDialog closes on delete failure in `topic-manager.tsx`/`tag-manager.tsx`) matched an
existing deferred row (`C96-10`, "Field-level topic dialog errors") and is NOT re-reported here
since I found no new evidence its exit criterion fired.

---

## C7-DES1 — Production-mode search button drops below the 44px touch-target floor

**[SEV: MED | CONF: High | WCAG 2.5.5 Target Size / touch-target policy]**

**File:** `apps/web/src/components/search.tsx`, lines 371-389 (introduced/changed in commit
`14d31ea4`).

```tsx
if (!isOpen) {
    const showSearchLabel = semanticSearchMode === 'production';
    return (
        <Button
            ref={triggerRef}
            variant="ghost"
            size={showSearchLabel ? 'default' : 'icon'}
            onClick={() => setIsOpen(true)}
            aria-label={t('aria.searchPhotos')}
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            className={showSearchLabel ? "h-11 gap-2 px-3" : "h-11 w-11"}
        >
            <SearchIcon className="h-4 w-4" />
            {showSearchLabel && <span className="hidden lg:inline">{t('aria.searchPhotos')}</span>}
        </Button>
    );
}
```

**Why it's a problem:** when `semanticSearchMode === 'production'` (the exact case this commit
was written to surface — "make production semantic search discoverable"), the trigger button's
`className` becomes `"h-11 gap-2 px-3"` with `size="default"`. Below the `lg` breakpoint (1024px,
unmodified default — confirmed no `screens` override in `apps/web/tailwind.config.ts`), the
`<span className="hidden lg:inline">` is `display:none` and does not participate in flex layout,
so the button's only rendered content is the 16×16px `SearchIcon`. Computed width =
`px-3` (12px) + icon (16px) + `px-3` (12px) = **40px**, against a fixed height of `h-11` = 44px.
That is a 40×44px target — below the 44×44px floor this repository documents and enforces
elsewhere (`CLAUDE.md` "Touch-Target Audit" policy; `apps/web/src/__tests__/touch-target-audit.test.ts`).
This regresses the *default* icon-only path, which was previously always `size="icon"` /
`h-11 w-11` (44×44) regardless of mode — the width floor is lost specifically in the new
`showSearchLabel` branch. It reproduces on **every viewport under 1024px** (virtually all phones
and tablets, and many laptop windows), i.e. precisely the audience for whom the button stays
icon-only (the visible label is `lg:`-gated for desktop only).

**Failure scenario:** an operator running the gallery with real CLIP embeddings enabled
(`SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` + DB `semantic_search_mode='production'`) ships a nav
bar whose search icon button is a 40px-wide tap target on every mobile visit — a measurable,
if modest, WCAG 2.5.5 regression that only appears in this one operator-enabled mode.

**Why the blocking scanner misses it:** `apps/web/src/__tests__/touch-target-audit.test.ts`
pattern-matches known-bad className *values* (literal `h-8`/`h-9`/`h-10`, sub-44 arbitrary
`min-h-[NNpx]`, sub-44 scale tokens). It has no way to compute an actual rendered width from
flex content, and neither of the two ternary strings here (`"h-11 gap-2 px-3"` / `"h-11 w-11"`)
matches any FORBIDDEN pattern — the bug is an *absence* of a width utility, not a too-small one.
The new regression test the commit added
(`apps/web/src/__tests__/client-source-contracts.test.ts`, "shows visible desktop search copy
when production semantic search is active") only asserts the source strings are present; it does
not assert a width floor either.

**Suggested fix:** add an explicit width floor to the `showSearchLabel` branch, e.g.
`className={showSearchLabel ? "h-11 min-w-11 gap-2 px-3" : "h-11 w-11"}`, so the button never
drops under 44px wide even when the label span is hidden.

**Confidence:** High — derived directly from the committed CVA (`apps/web/src/components/ui/button.tsx`),
the committed className strings, and the project's own (unmodified) Tailwind breakpoints.
Recommend a quick manual/browser measurement to corroborate before merging the fix, but the
arithmetic from the committed source is unambiguous.

---

## C7-DES2 — `SimilarPhotos` thumbnails reintroduce the exact duplicate-label ambiguity `4d37daa4` just fixed in `search.tsx`

**[SEV: MED | CONF: High | WCAG 4.1.2 Name/Role/Value, keyboard/AT disambiguation]**

**Files:** `apps/web/src/components/similar-photos.tsx` lines 177-249 (component wired into both
`info-bottom-sheet.tsx:384` and `photo-viewer.tsx:800` by commit `14d31ea4`).

```tsx
const label = getPhotoResultLabel(item, `${tCommon('photo')} ${item.imageId}`);
return (
    <SimilarThumb key={item.imageId} imageId={item.imageId} label={label} ... />
);
...
function SimilarThumb({ imageId, label, sizedSrc, baseSrc, locale }: SimilarThumbProps) {
    return (
        <Link
            href={localizePath(locale, `/p/${imageId}`)}
            className="block rounded-md overflow-hidden bg-muted aspect-square min-h-11 ..."
            title={label}
            aria-label={label}
        >
            <Image src={imgSrc} alt={label} ... />
        </Link>
    );
}
```

**Why it's a problem:** `getPhotoResultLabel()` (`apps/web/src/lib/photo-title.ts:85-105`) returns
the raw `title` (or tag-derived title, or description) whenever one is present — it does **not**
append the image id for disambiguation. When two or more of the 3-per-row similar-photo results
share the same title (a very plausible case: e.g. a batch of event photos all titled the same, or
several images sharing one tag-derived title), every matching `<Link>` in the grid gets the
identical `aria-label` **and** the identical `title` attribute, with no way for a screen-reader or
keyboard user to distinguish them — they are announced as indistinguishable "photo, link" entries
repeated N times.

This is *literally* the defect that commit `4d37daa4` ("clarify search and collection cues")
fixed one commit earlier for `search.tsx`'s `SearchResultItem` — that commit explicitly rejected
"keep duplicate photo result labels title-only" with the stated rationale "repeated titles produce
indistinguishable option names for assistive tech and keyboard users," and its own commit message
records the directive: *"Keep visible and accessible search-result labels aligned when adding
future disambiguators."* `SimilarPhotos`/`SimilarThumb` is a **new** result-list surface (wired
into both the mobile bottom sheet and the desktop sidebar by the very next commit, `14d31ea4`) that
uses the same `getPhotoResultLabel()` helper and the same result-grid pattern, but was not updated
to carry the `#{imageId}` (or any other) disambiguator search.tsx now uses. The fix landed in one
sibling and was not propagated to the other, despite the directive calling for exactly that.

**Failure scenario:** a screen-reader user expands "Similar photos" on a photo whose gallery
contains several same-titled shots (e.g., "IMG event edit" batch-titled by an admin, or several
photos sharing one tag so `getPhotoDisplayTitleFromTagNames` yields the same fallback) and tabs
through the 3×N thumbnail grid — every duplicate announces the identical name, so there is no way
to tell which link leads to which photo without opening each one.

**Suggested fix:** mirror the `search.tsx` fix — append a stable unique disambiguator (e.g.
`` `${label} #${item.imageId}` ``) to both the visible `title` attribute and the `aria-label`
(and optionally the `Image alt`) in `SimilarThumb`, consistent with the "keep visible and
accessible labels aligned" directive from `4d37daa4`.

**Confidence:** High — confirmed via `getPhotoResultLabel`'s implementation (returns bare title
with no id suffix) and via direct comparison against the sibling fix in `search.tsx` committed
one revision earlier in the same review cycle.

---

## Verified — no new issue found

- **i18n key parity (en/ko):** ran a full flatten-and-diff of `apps/web/messages/en.json` vs
  `ko.json` — 0 keys missing in either direction, including every key touched by `14d31ea4` and
  `4d37daa4` (`footer.timeline`, `footer.map`, `search.similarPhotos`, `search.similarError`,
  `search.similarEmpty`, `categories.deleteConfirmTitle`/`deleteConfirm`,
  `tags.deleteConfirmTitle`/`deleteConfirm`, `aria.searchPhotos`, etc.). No drift.
- **`nav-client.tsx` mobile expand-toggle reorder:** the diff moves the 44×44 hamburger-style
  toggle button from before `#primary-nav-topics` (previously visually pushed to the end via
  CSS `order-last`, which meant Tab/focus order didn't match visual order — a real prior bug) to
  physically after `#primary-nav-controls` in the DOM. Confirmed the new DOM order now matches
  both visual order (search → theme → locale → menu) and focus/AT reading order in every layout
  branch I traced (collapsed mobile row and the `isExpanded` wrapped multi-row layout, since the
  `w-full` topics/controls rows force line-wraps in the `flex-wrap` container ahead of the toggle
  either way). This is a genuine, correctly-executed fix — no residual issue found.
- **`photo-navigation.tsx` `aria-keyshortcuts="ArrowLeft"/"ArrowRight"`:** confirmed the global
  `ArrowLeft`/`ArrowRight` handler actually exists and is live on the same page
  (`photo-viewer.tsx` lines 401-409, gated off when the lightbox is open or the event target is
  editable) and mirrors the identical, pre-existing `aria-keyshortcuts` pattern already used on
  `lightbox.tsx`'s own prev/next buttons (lines 656/677) for consistency. Not a dead/inaccurate
  ARIA hint.
- **`search.tsx` `SearchResultItem` disambiguation (`4d37daa4`):** visible text and `aria-label`
  are now both `` `${label} #${image.id}` `` — same string in both places, so the fix does not
  introduce a Label-in-Name (WCAG 2.5.3) mismatch, and the id suffix is guaranteed unique per
  photo. Confirmed correct.
- **`topic-manager.tsx` / `tag-manager.tsx` delete-target naming:** confirmed `deleteTopicTarget`/
  `deleteTarget` resolve from the still-in-scope `initialTopics`/`initialTags` prop by id/slug, so
  the interpolated `"Delete category \"{label}\"?"` / `"Delete tag \"{name}\"?"` titles are correct
  for the common (fast, non-networked) case. Traced a theoretical race where a `router.refresh()`
  landing between the delete resolving and `setDeleteSlug(null)`/`setDeleteId(null)` running could
  transiently blank the interpolated name — did not report this: `router.refresh()` requires a
  network round-trip (a macrotask), while the dialog-closing `setDeleteSlug(null)`/`setDeleteId(null)`
  runs synchronously in the same microtask chain immediately after the awaited delete resolves, so
  this window is not realistically observable. The separately-known dialog-closes-on-error gap for
  the same two files is already tracked as deferred item `C96-10` and is not re-reported.
- **`SimilarPhotos` heading structure:** the disclosure toggle uses a plain `<button>` rather than
  a heading-wrapped control. Checked this against the codebase's own established convention
  (`color-details-section.tsx`'s disclosure toggles use the same plain-`<button>` pattern) — this
  is consistent with existing practice in this app, not a new deviation, so not reported.
- **`footer.tsx` new Timeline/Map links:** both `/timeline` and `/map` are always-present public
  routes (not gated behind a feature flag or admin setting), both keep the existing `min-h-11
  min-w-11` touch-target treatment, and both render translated labels in en/ko. No issue found.
- **Reduced motion:** `photo-navigation.tsx`'s swipe-feedback code already respects
  `prefers-reduced-motion` (checked via `matchMedia` + a live `change` listener) and this was
  untouched by the reviewed commits.

## Final sweep for commonly-missed issues

Checked, beyond the two flagged commits: `nav-client.tsx`, `search.tsx` (full file),
`photo-navigation.tsx` (full file), `info-bottom-sheet.tsx` (full file), `similar-photos.tsx`
(full file), `footer.tsx` (full file), `topic-manager.tsx` and `tag-manager.tsx` (delete-dialog
regions + handlers), `photo-viewer.tsx` (keyboard-nav wiring + `SimilarPhotos`/
`InfoBottomSheet` call sites), `color-details-section.tsx` (disclosure-pattern precedent), and
`lightbox.tsx` (aria-keyshortcuts precedent). Cross-checked `apps/web/tailwind.config.ts` and the
shadcn `button.tsx` CVA definitions for the touch-target math. Searched for other
conditionally-sized `<Button size={... ? ... : ...}>` call sites (only the one flagged in
`search.tsx` exists) and re-checked `en.json`/`ko.json` key parity programmatically rather than by
eye. Did not start a dev server per the shared-worktree instruction; did not run the Vitest/Playwright
suites to avoid contending with the peer session — all findings are static/source-derived.

Two new, evidence-backed findings reported (`C7-DES1`, `C7-DES2`), both MED severity, both scoped
to the peer commits under extra scrutiny (`14d31ea4`). No CRIT/HIGH findings from this angle this
cycle.
