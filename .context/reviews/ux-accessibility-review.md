# GalleryKit UX/Accessibility Review — Round 4

**Reviewer**: Critic Agent (claude-sonnet-4-6)
**Date**: 2026-04-11
**Scope**: All frontend components, pages, i18n messages (en.json + ko.json), live site (https://gallery.atik.kr)
**Context**: Fourth round. Round 3 grade: B+ (ACCEPT-WITH-RESERVATIONS). 16 issues (0C/1M). Major changes this cycle: all aria-labels i18n'd (commit bb134f0), search keyboard nav (7c096f9), back-to-top button (b5a9f40), loading.tsx skeletons (db5a92c), admin skip-to-content (2e976e9), admin nav responsive (2e976e9), clipboard fallback (a91b25d, 1671b4c), topic active state fix (1a3c23f), photo counter fix (1671b4c), bottom sheet dialog semantics (7b30e2f), Korean 해요체 naturalization, ImageZoom keyboard activation (1c1118b), PhotoViewer loading spinner (af601d9), search locale prefix (f262278), SSR-safe locale switch (068364e), hardcoded fallback strings i18n (59f6d6e).

---

## VERDICT: ACCEPT-WITH-RESERVATIONS

**Overall Assessment**: Round 4 is a large-scope fix cycle that addressed every single Major finding and most Minors from Round 3 with real, verified commits. The aria-label internationalization, bottom sheet dialog semantics, ImageZoom keyboard activation, search keyboard nav, back-to-top button, and SSR-safe locale switch are all confirmed implemented. The codebase is genuinely good. What remains is a cluster of low-severity residual issues — hardcoded English in error boundaries (not solvable without i18n context), hardcoded English in two admin aria-labels, the sr-only navigation announcement being static English, and the topic slug vs. label mismatch in the masonry overlay — none of which affect normal interactive users but are real a11y gaps for screen reader users. Grade improves to A-.

**UX/A11y Grade: A- (up from B+)**

---

## Pre-commitment Predictions vs Actual

Based on the Round 3 outstanding list (m1–m10), my predictions before detailed investigation:

| Prediction | Result |
|---|---|
| SSR locale switch fix (m1) verified — useSearchParams used | **CORRECT** — commit 068364e confirmed; `nav-client.tsx` now uses `useSearchParams()` |
| ImageZoom keyboard (m2) — expected to be a 1-line onKeyDown add | **CORRECT** — commit 1c1118b, one line added |
| Bottom sheet dialog semantics (m3) — expected FocusTrap + role="dialog" | **CORRECT** — commit 7b30e2f, FocusTrap + role + aria-modal + Escape key all present |
| Topic slug vs. label in overlay (m4) — likely still not fixed | **CORRECT** — `home-client.tsx:266` still uses `image.topic` (raw slug) |
| sr-only announcement static English (m5) — likely still not fixed | **CORRECT** — `photo-navigation.tsx:203` still hardcoded English, not updated on navigation |
| Search locale prefix (m6) — expected trivial fix | **CORRECT** — commit f262278 confirmed |
| Admin nav locale prefix (m7) — likely still not fixed | **CORRECT** — `admin-nav.tsx` links still use bare `/admin/...` paths |
| PhotoViewer loading fallback (m8) — expected | **CORRECT** — commit af601d9 confirmed |
| Error boundaries still hardcoded English | **CORRECT** — all three error files remain hardcoded (architectural constraint) |
| Two admin aria-labels still hardcoded English | **NEW FINDING** — `image-manager.tsx:278`, `upload-dropzone.tsx:253` |

---

## VERIFICATION OF CLAIMED FIXES

### Fix 1: All aria-labels i18n'd (commit bb134f0)
**STATUS: VERIFIED — WITH TWO EXCEPTIONS**

The commit description says "all 14 remaining hardcoded English aria-labels." Verified in source:
- `lightbox.tsx`: `t('aria.openFullscreen')`, `t('aria.close')`, `t('aria.lightbox')`, `t('aria.previousImage')`, `t('aria.nextImage')` — CONFIRMED
- `histogram.tsx`: `t('aria.expandHistogram')`, `t('aria.collapseHistogram')`, `t('aria.cycleHistogram')` — CONFIRMED
- `photo-navigation.tsx`: `t('aria.previousPhoto')`, `t('aria.nextPhoto')` — CONFIRMED
- `image-zoom.tsx`: `t('aria.zoomIn')`, `t('aria.zoomOut')` — CONFIRMED
- `search.tsx`: `t('aria.searchPhotos')` — CONFIRMED
- `histogram.tsx` canvas: `aria-label={\`Color histogram, ${MODE_LABELS[mode]} mode\`}` — **STILL HARDCODED ENGLISH** (not in commit)

Two admin-component aria-labels were not covered by this commit:
- `image-manager.tsx:278`: `aria-label="Select all images"` — hardcoded
- `upload-dropzone.tsx:253`: `aria-label="Remove file"` — hardcoded

Both have existing i18n keys: `t('aria.selectAll')` = "Select all images"/"전체 선택" and `t('aria.removeFile')` = "Remove file"/"파일 제거" are already present in both `en.json` and `ko.json` (verified at lines 278-279). The keys exist but were not used.

### Fix 2: Search keyboard navigation (commit 7c096f9)
**STATUS: VERIFIED CORRECT**

`search.tsx:120-131`: ArrowDown increments `activeIndex` (clamped to `results.length - 1`), ArrowUp decrements (floor at -1), Enter on `activeIndex >= 0` clicks the active result ref. Active result gets `bg-muted` highlight class at line 154. `activeIndex` resets to -1 on query change at line 119. All correct. Focus stays in the input during arrow navigation — correct UX pattern for search comboboxes.

One note: the result `<Link>` elements are not wrapped in a listbox/option ARIA pattern. The results div has no `role="listbox"` and individual links have no `role="option"` or `aria-selected`. The keyboard mechanics work, but the semantic relationship between the input and the result list is not announced to screen readers. This is a MINOR gap, not a blocker.

### Fix 3: Back-to-top button (commit b5a9f40)
**STATUS: IMPLEMENTED — WITH A CORRECTNESS ISSUE**

`home-client.tsx:302-318`: Button is rendered, uses `aria-label={t('home.backToTop')}` (i18n'd). Visibility controlled by Tailwind arbitrary variant `[.scrolled_&]:opacity-100` which requires the `scrolled` class on a parent element.

The scroll listener is attached via a `ref` callback on the button (`ref={(el) => { ... window.addEventListener('scroll', handleScroll) }`). This pattern has a known problem: the `ref` callback fires on every render (not just mount), and the returned cleanup function from the ref callback is called on the *next* render's ref call, not on unmount. React's ref callback cleanup behavior changed in React 19 — cleanup is now supported. However, the pattern also registers a new listener on every render if React calls the ref callback again. Verified: the `scroll` listener adds `{ passive: true }` so there is no performance hazard, but the listener registration on each render means a large number of scroll handlers could accumulate if the component re-renders frequently (e.g., during image loading).

The more direct issue: on the Korean `/ko` page, the `scrolled` class is toggled on `document.documentElement`. The Tailwind selector `[.scrolled_&]` requires `.scrolled` to be an ancestor of the button. `document.documentElement` is `<html>`, which IS an ancestor of the button, so this works. Verified in `globals.css` — no `.scrolled` class defined there, but it's a Tailwind arbitrary variant, not a CSS class defined in the stylesheet.

**Functional concern**: The back-to-top button only exists inside `HomeClient` (`home-client.tsx`). It does not render on photo pages (`/p/[id]`), topic pages (which DO render `HomeClient`), or any admin page. For topic pages with many photos (infinite scroll), the button works. For a long photo info panel on desktop, there is no back-to-top. This is a scope limitation, not a bug.

### Fix 4: loading.tsx skeletons (commit db5a92c)
**STATUS: VERIFIED — BARE SPINNER, NOT SKELETON**

Both `apps/web/src/app/[locale]/loading.tsx` and `apps/web/src/app/[locale]/admin/(protected)/loading.tsx` render a centered `animate-spin` spinner. The commit description says "skeleton screens" but these are spinners, not skeleton screens with layout placeholders. This is a cosmetic discrepancy — spinners are adequate loading indicators, but they provide no layout hint (CLS-neutral by definition since the spinner has no spatial relationship to the incoming content). Not a finding, noting for accuracy.

The spinner div has no `aria-label`, no `role`, and no `aria-busy` announcement. A screen reader hitting the loading state sees nothing (the spinner is a `div` with border styling, not a semantic element). Add `role="status"` and `aria-label={...}` for screen reader users. The `common.loading` key ("Loading..." / "로딩 중...") exists in both locales but is not used here.

### Fix 5: Admin skip-to-content + responsive nav (commit 2e976e9)
**STATUS: VERIFIED CORRECT**

`admin/(protected)/layout.tsx:16-17`: Skip link `href="#admin-content"` present, correctly styled with `sr-only focus:not-sr-only`. `AdminNav` at `admin-nav.tsx:22` uses `flex items-center flex-wrap gap-x-6 gap-y-2` — wraps on mobile correctly.

**Note**: The skip link text is hardcoded English "Skip to content" — same as the public layout. On Korean admin pages this shows English. This is a consistent architectural issue (both layouts do the same thing) but is technically present here as an untranslated string.

### Fix 6: Bottom sheet dialog semantics (commit 7b30e2f)
**STATUS: VERIFIED CORRECT**

`info-bottom-sheet.tsx:136-142`: `FocusTrap active={isOpen}`, `role="dialog"`, `aria-modal="true"`, `aria-label={t('viewer.bottomSheet')}`. Escape key handler at lines 95-102. All items from Round 3 m3 are addressed. The FocusTrap uses `allowOutsideClick: true` and `initialFocus: false` — same options as the search overlay, which is appropriate since the sheet starts in peek state (not fully modal).

One edge case: the FocusTrap wraps the entire sheet including when `sheetState === 'collapsed'` (only the drag handle is visible). In collapsed state, the focus trap is active but there's nothing meaningful to focus inside. The `initialFocus: false` option prevents an immediate focus-steal, which mitigates this, but keyboard users who tab into a collapsed sheet will find their focus trapped with no actionable content until they swipe/expand. A strict interpretation would say the focus trap should only be active when `sheetState === 'expanded'`. This is a MINOR UX edge case.

### Fix 7: ImageZoom keyboard activation (commit 1c1118b)
**STATUS: VERIFIED CORRECT**

`image-zoom.tsx:132`: `onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(e as unknown as React.MouseEvent); } }}` is present. WCAG 4.1.2 met for keyboard activation.

### Fix 8: SSR-safe locale switch (commit 068364e)
**STATUS: VERIFIED CORRECT**

`nav-client.tsx:8`: `useSearchParams` imported. `nav-client.tsx:37-39`: `const search = searchParams.toString(); return search ? \`${path}?${search}\` : path;` — no `window.location` usage. SSR-safe.

### Fix 9: Search locale prefix (commit f262278)
**STATUS: VERIFIED CORRECT**

`search.tsx:152`: `href={\`/${locale}/p/${image.id}\`}` — locale prefix present. `locale` comes from `useTranslation()` at line 13. Correct.

### Fix 10: Hardcoded fallback strings i18n (commit 59f6d6e)
**STATUS: VERIFIED CORRECT**

`home-client.tsx:185`: `t('common.photo')` for alt text fallback. `home-client.tsx:193`: `t('common.untitled')`. `photo-viewer.tsx` analogous replacements. `info-bottom-sheet.tsx` uses `t('imageManager.untitled')` (line 110) and `t('common.unknown')` for date — confirmed.

---

## CRITICAL FINDINGS

None.

---

## MAJOR FINDINGS

None.

---

## MINOR FINDINGS

### m1 (PERSISTS from R3 m5). sr-only photo navigation announcement is static English and never updates

**Confidence: HIGH**
**Evidence**: `photo-navigation.tsx:202-204`:
```
<div className="sr-only" aria-live="polite" aria-atomic="true">
    {prevId !== null || nextId !== null ? `Photo navigation: ${prevId ? 'previous' : ''} ${nextId ? 'next' : ''} available` : ''}
</div>
```

Two problems: (1) the string is hardcoded English — Korean users get "Photo navigation: previous next available". (2) The content is computed from `prevId`/`nextId` props which don't change during in-page navigation in the single-photo viewer (only during shared-group multi-photo navigation). It announces once on mount and then goes silent. It does not announce "Photo 3 of 12" or any indication of the current position as the user navigates.

**Why this matters**: The `aria-live="polite"` region is the only screen reader navigation aid in the photo viewer. It currently says "Photo navigation: previous  available" in English, once, on load.

**Fix**: Replace the static string with a translated, dynamic announcement. Pass `currentIndex` and `totalCount` as props:
```tsx
<div className="sr-only" aria-live="polite" aria-atomic="true">
    {t('aria.photoNavStatus', { current: currentIndex + 1, total: totalCount, hasPrev: !!prevId, hasNext: !!nextId })}
</div>
```
Add keys `"photoNavStatus"` to both locale files. Update on each navigate call in `photo-viewer.tsx` by passing a changing `key` or trigger value to force the `aria-live` region to re-announce.

### m2 (PERSISTS from R3 m4). Topic slug shown instead of label in masonry tile overlay

**Confidence: HIGH**
**Evidence**: `home-client.tsx:266`: `<p className="text-white/80 text-xs truncate">{image.topic}</p>`

`image.topic` is the raw slug (e.g., `"tws"`, `"nature"`). The human-readable label (e.g., `"TWS"`, `"Nature"`) is not available in `GalleryImage` because `getImagesLite` does not join the `topics` table.

**Why this matters**: Hover overlay on gallery tiles shows the slug, not the display name. For slugs that differ from labels (e.g., a topic slug `"bts"` with label `"BTS - Beyond The Scene"`) the slug appears as a raw identifier rather than a meaningful label.

**Fix**: Pass a `topicsMap: Record<string, string>` prop from the server component (cheaply constructed from the already-fetched `topics` array) into `HomeClient`, then use `topicsMap[image.topic] ?? image.topic` in the overlay.

### m3 (PERSISTS from R3 m7). Admin nav links lack locale prefix

**Confidence: HIGH**
**Evidence**: `admin-nav.tsx:13-18`: all hrefs are bare `/admin/...` paths, no locale prefix.

`AdminNav` is used inside `AdminHeader` inside the `(protected)/layout.tsx`. The admin layout at line 16 has a skip link to `#admin-content`. The admin area is accessible under `/en/admin/...` and `/ko/admin/...` via next-intl routing. Current bare links `/admin/dashboard` trigger a middleware redirect to `/[locale]/admin/dashboard`, adding an extra hop on every admin nav click. For admin users this is a minor inconvenience but it's architecturally inconsistent with the rest of the routing and will produce flicker on each navigation.

**Fix**: Import `useLocale()` from `next-intl` in `admin-nav.tsx` and prefix each href: `` href={`/${locale}${link.href}`} ``.

### m4 (NEW). Two admin aria-labels still hardcoded English despite i18n keys existing

**Confidence: HIGH**
**Evidence**:
- `image-manager.tsx:278`: `aria-label="Select all images"` — the key `aria.selectAll` exists in both `en.json` ("Select all images") and `ko.json` ("전체 선택") but is unused here.
- `upload-dropzone.tsx:253`: `aria-label="Remove file"` — the key `aria.removeFile` exists in both locales ("Remove file" / "파일 제거") but is unused here.

**Why this matters**: Korean admin users hear "Select all images" and "Remove file" from a screen reader in English. The infrastructure to fix this exists and is already wired — the components use `useTranslation()` and have `const { t } = useTranslation()` available.

**Fix**: In `image-manager.tsx:278`, replace with `aria-label={t('aria.selectAll')}`. In `upload-dropzone.tsx:253`, replace with `aria-label={t('aria.removeFile')}`.

### m5 (NEW). Histogram canvas aria-label is hardcoded English

**Confidence: HIGH**
**Evidence**: `histogram.tsx:244`:
```
aria-label={`Color histogram, ${MODE_LABELS[mode]} mode`}
```
`MODE_LABELS` is a hardcoded `Record<HistogramMode, string>` with English values (`'Lum'`, `'RGB'`, `'R'`, `'G'`, `'B'`). Korean users get "Color histogram, Lum mode".

Note: the expand/collapse/cycle buttons above this canvas correctly use `t('aria.expandHistogram')` etc. Only the canvas label itself is hardcoded.

**Fix**: Add a translation key `"histogramLabel"` to the `aria` namespace in both locales. Add locale-aware mode labels (or keep the short technical abbreviations as-is — `RGB`, `R`, `G`, `B` are internationally understood; `Lum` vs `명도` is debatable). Minimum fix: translate "Color histogram" to "컬러 히스토그램" and keep the mode abbreviations.

### m6 (NEW). Error boundaries all hardcoded English — architectural constraint acknowledged

**Confidence: HIGH**
**Evidence**:
- `error.tsx:15-29`: "Something went wrong loading this page.", "Try again", "Return to Gallery" — all hardcoded
- `admin/(protected)/error.tsx:15-29`: "Something went wrong in the admin panel.", "Try again", "Back to Dashboard" — all hardcoded
- `global-error.tsx:15`: "Something went wrong.", "Try again" — hardcoded (acceptable: no layout context)

`error.tsx` and `admin/error.tsx` run inside the layout context and DO have access to `next-intl` client providers. Unlike `global-error.tsx` (which replaces the entire `<html>`), these error boundaries can use `useTranslations` from `next-intl/client`.

**Why this matters**: Korean users who hit a route error see English error messages. This was identified in Round 3 and deferred — it's still present.

**Fix**: In `error.tsx` and `admin/(protected)/error.tsx`, add `'use client'` is already present. Import `useTranslations` from `next-intl` and use keys from a new `error` namespace. Note: `error.tsx` components are special Next.js boundaries — they must be client components and cannot use async server functions, but synchronous `useTranslations()` is fine.

### m7 (NEW). Skip-to-content links hardcoded English in both layouts

**Confidence: HIGH**
**Evidence**:
- `layout.tsx:80`: `Skip to content` — hardcoded English
- `admin/(protected)/layout.tsx:16`: `Skip to content` — hardcoded English

On the Korean site (`/ko`), keyboard users who trigger the skip link hear/see "Skip to content" in English. Since these are server components, `useTranslations` is not directly available — but `getTranslations` from `next-intl/server` is.

**Fix**: Convert the layout to use `const t = await getTranslations('common');` and add a `skipToContent` key to both locale files, then use `{t('skipToContent')}` in the link text. Alternatively, add a dedicated `a11y` namespace.

### m8 (NEW). Search keyboard shortcut hint "to toggle search" hardcoded English

**Confidence: HIGH**
**Evidence**: `search.tsx:187`:
```tsx
<kbd ...>{isMac ? '⌘' : 'Ctrl+'}K</kbd> to toggle search
```
The text "to toggle search" is hardcoded English inside the search panel footer. On `/ko`, the placeholder says "사진, 태그, 카메라 검색..." (translated) but the footer hint says "⌘K to toggle search" in English.

**Fix**: Add `"toggleHint": "to toggle search"` / `"toggleHint": "검색 열기/닫기"` to the `search` namespace in both locale files, then use `t('search.toggleHint')`.

### m9 (PERSISTS). Back-to-top button scroll listener may accumulate via ref callback

**Confidence: MEDIUM**
**Evidence**: `home-client.tsx:306-313`:
```tsx
ref={(el) => {
    if (!el) return;
    const handleScroll = () => { ... };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
}}
```

In React 19 (which this project uses per CLAUDE.md), ref callbacks do support returning a cleanup function. However, the cleanup is only called when the ref is detached (unmount or the element changes). On each render that does NOT detach/reattach the element, the cleanup is not called and no new listener is added either — React only calls the callback when the ref assignment changes. With a stable element, this is safe. But if React ever remounts the button (e.g., due to parent re-renders with key changes, Strict Mode double-invocation in dev), the listener could accumulate. In production this is likely fine; in development with Strict Mode enabled, this fires twice. The safer pattern is `useEffect(() => { window.addEventListener('scroll', handleScroll, { passive: true }); return () => window.removeEventListener(...); }, [])`.

**Fix**: Move the scroll listener to a `useEffect` in `HomeClient` and control button visibility via a `showBackToTop` state variable instead of the CSS class trick.

### m10 (PERSISTS). Focus ring absent on masonry card containers

**Confidence: MEDIUM**
**Evidence**: `home-client.tsx:199-213`: The card `div` has `group` class and `group-focus-within:opacity-100` on the hover overlay, which reveals the title on keyboard focus. However, the card itself has no `focus-within:ring` or `focus-visible:ring` style. The only visible feedback for keyboard focus is the title overlay appearing — there is no border/ring indicator on the card itself.

WCAG 2.4.7 requires a visible focus indicator. The overlay appearing is *a* visual change, but it is subtle (opacity transition on the text, no clear border around the focused element). This does not clearly satisfy "visible keyboard focus indicator."

**Fix**: Add `focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2` to the card `div` className.

### m11. FocusTrap in collapsed bottom sheet traps focus with no actionable content

**Confidence: MEDIUM**
**Evidence**: `info-bottom-sheet.tsx:136`: `<FocusTrap active={isOpen} ...>` is always active when `isOpen === true`, regardless of `sheetState`. When `sheetState === 'collapsed'` (only 28px of drag handle visible), focus is trapped inside the sheet with no interactive elements visible. The `initialFocus: false` option prevents immediate focus-steal, but a keyboard user who tabs will eventually get trapped with no focusable element in view.

**Fix**: Change the FocusTrap `active` prop to `active={isOpen && sheetState === 'expanded'}`. For peek and collapsed states, the sheet is not fully modal and does not warrant a focus trap.

---

## WHAT'S MISSING (Gap Analysis)

- **No `<title>` update on in-page photo navigation**: When prev/next navigation happens inside `PhotoViewer` (state change, no page reload), the browser `<title>` does not change. Screen readers using page title as navigation landmark get no feedback. This requires either `router.push()` on each navigation (full page reload) or a custom `useEffect` updating `document.title`.
- **No `aria-describedby` on error boundaries**: `error.tsx` exposes `error.digest` for support reference but never displays or announces it. Useful for accessibility-aware error reporting.
- **No `role="status"` on loading spinners**: `loading.tsx` and the `PhotoViewer` dynamic import spinner have no role or aria-label. Screen readers see nothing while loading.
- **No `aria-label` on the `<nav>` in `NavClient`**: The `<nav>` element at `nav-client.tsx:43` has no `aria-label`. With multiple `<nav>` landmarks (public nav + admin header nav), screen reader users cannot distinguish them by name. WCAG technique ARIA11 recommends unique labels for each navigation landmark.
- **Lightbox has no swipe navigation on mobile**: The main photo viewer has full swipe with rubber-band feedback. The lightbox (full-black overlay) only has keyboard arrows and click buttons. On mobile, there is no touch-to-navigate in lightbox mode.
- **`LoadMore` sentinel has no `aria-live` region**: When new images load via intersection observer, there is no screen reader announcement that new content has been added to the page. The Loader2 spinner has no accessible label either.

---

## AMBIGUITY RISKS

- `home-client.tsx:294`: `<Link href={topicSlug ? \`/${topicSlug}\` : '/'}...>` — the "Clear filter" link uses a bare path without locale prefix. From `/ko?tags=...`, this navigates to `/[topic]` or `/` without locale, triggering a redirect. The locale-prefixed variant would be `` `/${locale}${topicSlug ? `/${topicSlug}` : '/'}` ``. Low severity since middleware handles the redirect, but inconsistent with the rest of the locale-aware routing.

---

## MULTI-PERSPECTIVE NOTES

**Executor**:
- m4 (two admin aria-labels): 2-line fix each, keys already exist in both locales. Fastest win.
- m7 (skip-to-content i18n): Server component constraint — requires `getTranslations()`. ~10 lines.
- m8 (search toggle hint): Add one key to each locale file + 1 line in search.tsx. ~5 lines total.
- m3 (admin nav locale prefix): Import `useLocale()` + string interpolation. ~5 lines.
- m1 (sr-only announcement): Requires new i18n key + passing currentIndex to PhotoNavigation. ~15 lines.
- m6 (error boundary i18n): Medium effort — add new `error` namespace, 2 keys per locale, update 2 components. ~30 lines.

**Stakeholder**:
The application is production-quality. The live site works correctly: tag filtering, locale switching with query param preservation, keyboard search navigation, back-to-top, and photo navigation all function as claimed. For a bilingual photography portfolio this is ready for public use. The remaining issues are concentrated in edge cases (error states, admin-only flows, screen reader announcements) that affect a small percentage of users.

**Skeptic**:
The error boundaries being hardcoded English has now persisted through three rounds (R2 identified it, R3 carried it, R4 still present). The fix is straightforward — `useTranslations()` works in Next.js error boundary client components. The argument that it's an "architectural constraint" is not accurate: `global-error.tsx` is the only truly constrained one. `error.tsx` and `admin/error.tsx` have access to the NextIntlClientProvider context. This should be fixed rather than deferred again.

---

## VERDICT JUSTIFICATION

**Review mode: THOROUGH** — no critical findings, no ADVERSARIAL escalation warranted.

**Realist Check recalibrations**:
- m4 (two admin aria-labels hardcoded): Kept at MINOR. Affects only Korean admin users using screen readers. The keys exist. Detection: immediate with a screen reader on `/ko/admin/dashboard`. Fix is 2 lines.
- m6 (error boundaries English): Kept at MINOR. Affects only Korean users who hit error states. Error states are rare. The fix is ~30 lines and is genuinely solvable. Prior deferral reasoning ("no i18n context") is incorrect for `error.tsx`; correct only for `global-error.tsx`.
- m1 (sr-only navigation announcement static/English): Kept at MINOR. Only screen reader users are affected, and the current announcement at least signals that navigation exists. Not misleading — just incomplete.
- m9 (back-to-top scroll listener in ref): Downgraded from MINOR concern to low-severity note. Mitigated by: React 19 ref cleanup support, passive listener (no perf impact), and the button is static in the DOM during normal use. Detection: only manifests in React Strict Mode dev double-invocation.

**What would upgrade to ACCEPT (clean bill)**:
1. Fix m4: Use existing `t('aria.selectAll')` and `t('aria.removeFile')` in `image-manager.tsx` and `upload-dropzone.tsx`. This is a 2-line change.
2. Fix m8: Translate the "to toggle search" footer hint in `search.tsx`.
3. Fix the skip-to-content text (m7) — or at minimum acknowledge it as a tracked deferral.
The remaining items (m1, m2, m3, m5, m6) are all legitimate polish items that could reasonably be batched into a future a11y sweep.

**What is genuinely excellent this round**:
- All 14 aria-label i18n conversions confirmed — Korean screen reader users now hear navigation in Korean.
- Bottom sheet dialog semantics fully correct with FocusTrap + role + Escape key.
- ImageZoom keyboard activation correct — WCAG 4.1.2 met.
- SSR-safe locale switch with `useSearchParams()` — idiomatic Next.js.
- Search keyboard navigation (arrow keys + Enter) is well-implemented and accessible.
- Back-to-top button is present, labeled, and functional.
- PhotoViewer loading spinner eliminates the blank-content flash.
- Hardcoded fallback strings ('Photo', 'Untitled', 'Unknown') are all i18n'd.
- This is a codebase with serious a11y investment — the gap between Round 1 and Round 4 is substantial.

---

## SCORING SUMMARY

| Category | R1 | R2 | R3 | R4 | Delta R3→R4 |
|---|---|---|---|---|---|
| Critical | 3 | 0 | 0 | 0 | — |
| Major | 6 | 3 | 1 | 0 | -1 |
| Minor | 13 | 11 | 10 | 11 | +1 (net: new findings) |
| Missing | 10 | 8 | 5 | 6 | +1 (new gaps found) |
| **Total** | **32** | **22** | **16** | **17** | — |

Note: total count is slightly higher than R3 because this review found new issues (m4–m8) while resolving R3's Major and several Minors. Net quality is substantially higher — all Major findings eliminated.

### Round-3 findings resolved this round:
- [x] M1 (R3): Hardcoded aria-labels (14 instances) — FIXED via commit bb134f0
- [x] m1 (R3): SSR locale switch hydration mismatch — FIXED via commit 068364e
- [x] m2 (R3): ImageZoom keyboard activation — FIXED via commit 1c1118b
- [x] m3 (R3): Bottom sheet dialog semantics — FIXED via commit 7b30e2f
- [x] m6 (R3): Search result links missing locale prefix — FIXED via commit f262278
- [x] m8 (R3): PhotoViewer dynamic import no loading fallback — FIXED via commit af601d9
- [x] R3 open question: topic active state — FIXED via commit 1a3c23f

### Round-3 findings still open:
- [ ] m4 (R3 → m2 here): Topic slug vs. label in masonry overlay
- [ ] m5 (R3 → m1 here): sr-only photo nav announcement static/English
- [ ] m7 (R3 → m3 here): Admin nav locale prefix absent
- [~] M1 sub-issue (R3): Error boundaries hardcoded English — partially (global-error.tsx genuinely constrained; error.tsx and admin/error.tsx are fixable, now tracked as m6)

### New findings this round:
- m4: Two admin aria-labels use hardcoded English despite i18n keys existing
- m5: Histogram canvas aria-label hardcoded English
- m6: Error boundaries (error.tsx, admin error.tsx) fixable but still hardcoded English
- m7: Skip-to-content links hardcoded English in server layouts
- m8: Search keyboard shortcut hint "to toggle search" hardcoded English
- m9: Back-to-top scroll listener ref callback pattern (low severity)
- m10: Focus ring absent on masonry card containers (WCAG 2.4.7)
- m11: FocusTrap active during collapsed bottom sheet state

---

## OPEN QUESTIONS (unscored)

1. **Lightbox swipe on mobile**: Three rounds of review have noted the lightbox has no swipe. The main photo viewer has excellent swipe implementation. Is the lightbox intentionally desktop-primary? If so, document it. If not, the swipe handler from `photo-navigation.tsx` could be extracted and reused.

2. **`<title>` update on in-page photo navigation**: `PhotoViewer` navigates between images via state change without a page reload. The browser title doesn't update. Is this intentional (treating the viewer as a single route with client-side image switching) or an oversight? For screen reader users and browser history, this matters.

3. **`revalidatePath` staleness on photo metadata update** (carried from R3): Admin edits to photo titles/tags don't revalidate individual photo pages (`/[locale]/p/[id]`) due to the 1-week ISR and missing `revalidatePath` calls for specific photo URLs. Outside UX/a11y scope but is a data-freshness bug.

4. **`home-client.tsx:81` SSR column count flash** (carried from R3): `useState(4)` as the default column count causes a layout shift on mobile (4 columns → 1 column after hydration). This has been present across all four rounds. The fix requires either a server-side width hint or accepting a compromise default (e.g., 2) that's closer to the median viewport.

5. **`LoadMore` no screen reader announcement**: When infinite scroll loads new images, there is no `aria-live` announcement. Users navigating by keyboard or screen reader have no indication that new content appeared below the fold.

---

*Review conducted by Critic agent (claude-sonnet-4-6). All findings verified against source at `/Users/hletrd/flash-shared/gallery/apps/web/src/`. Live site verified at https://gallery.atik.kr. Commits verified via `git log` against local repository.*
