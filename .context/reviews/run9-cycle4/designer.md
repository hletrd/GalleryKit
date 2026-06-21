# Designer Review — Run-9 Cycle-4 (HEAD `094842a4`)

**Date:** 2026-06-21
**Reviewer:** oh-my-claudecode:designer
**Surface scope:** PUBLIC components (`components/`, `app/[locale]/(public)/`) + skip-link/landmark wiring in `app/[locale]/layout.tsx`.

---

## Verification: cycle-3 fixes

### DES-R9C3-01 — confirmed FIXED and held

`apps/web/src/components/bulk-edit-dialog.tsx`:
- `:184` — `<SelectTrigger>` now has `aria-label={t('imageManager.topic')}` ✓
- `:214` — `<Input>` now has `aria-label={t('imageManager.bulkTitlePrefix')}` ✓
- `:235` — `<Textarea>` now has `aria-label={t('imageManager.descField')}` ✓

All three match the established in-file pattern at `:46` and `:248`. No regression.

### Touch-target audit gate

No new `FORBIDDEN` pattern hits found by manual scan of `components/` and `app/[locale]/(public)/`. The `KNOWN_VIOLATIONS` register in `touch-target-audit.test.ts` does not list `similar-photos.tsx`, which the audit scanner does cover (it is in `SCAN_ROOTS → componentsDir`). The `SimilarThumb` `<Link>` uses no `h-8/h-9/size-sm` sizing tokens — the touch-target gate passes independently of the finding below.

---

## DES-R9C4-01 [LOW, conf HIGH] — `SimilarThumb` links have empty accessible names when photo title and description are both null — PUBLIC surface

**File:** `apps/web/src/components/similar-photos.tsx:179–202`

**DOM structure (SimilarThumb):**

```tsx
<Link
    href={localizePath(locale, `/p/${imageId}`)}
    className="block rounded-md overflow-hidden bg-muted aspect-square min-h-11 ..."
    title={title ?? undefined}          // undefined when title is null → attribute absent
>
    <Image
        src={imgSrc}
        alt={title ?? ''}               // "" when title is null
        ...
    />
</Link>
```

**Accessible name computation (ARIA accname-1.2, step 2F):**
1. No `aria-labelledby`.
2. No `aria-label`.
3. Subtree: the only content is `<Image alt="">`. An `alt=""` explicitly suppresses the image from the accessible name computation (it is the "presentational" sentinel). The subtree yields an empty string.
4. `title` attribute: absent from the DOM (React renders `title={undefined}` as no attribute).

**Result:** accessible name = `""` (empty string).

**Where title is null:** `title` is set from `item.title ?? item.description ?? null` at `:145`. Both `title` (varchar 255) and `description` (text) are optional columns with no DB default, so any photo uploaded without a title and without a description — the common case — produces a null value. The CLIP semantic search API (`/api/search/similar/[id]/route.ts`) returns `title: row.title` and `description: row.description` with no `alt_text_suggested` fallback. `SimilarResult` interface confirms `alt_text_suggested` is absent from the type.

**Surface:** `SimilarPhotos` is rendered in the PUBLIC photo-viewer page (`photo-viewer.tsx:769`) and is ACTIVE in production (`semanticSearchMode === 'production'`, confirmed by CLAUDE.md). It only renders when `semanticSearchMode !== 'production'` returns early (`:101`), so in production every `/p/[id]` page that has similar-photo results exposes this gap.

**WCAG criteria breached:**
- **WCAG 4.1.2 Name, Role, Value (Level A):** interactive element (link) with no determinable accessible name.
- **WCAG 2.4.4 Link Purpose (Level A):** the purpose of the link cannot be determined from link text alone.

**Users affected:** screen reader users on the public photo-viewer page who have semantic search active.

**Confidence:** HIGH. The accessible name algorithm is deterministic for this DOM structure; no UA heuristic salvages an empty-alt image inside a link with no other text content or label attribute.

**Fix (minimal, no API change required):**

Add a generic accessible name derived from the `t` function already in scope. The most appropriate form uses a translation key such as `t('aria.viewPhoto', { title: t('common.photo') })` as a fallback when `title` is null, or add an `aria-label` directly on the `<Link>`:

```tsx
<Link
    href={localizePath(locale, `/p/${imageId}`)}
    className="block rounded-md overflow-hidden bg-muted aspect-square min-h-11 ..."
    aria-label={title ? t('aria.viewPhoto', { title }) : tCommon('photo')}
>
    <Image
        src={imgSrc}
        alt={title ?? ''}
        ...
    />
</Link>
```

`tCommon` is already imported in the parent `SimilarPhotos` component (`const tCommon = useTranslations('common')`). The `SimilarThumbProps` interface does not currently receive the `t` function; the cleanest approach is to pass `ariaLabel` as a pre-computed prop from the parent, or to accept `locale`-scoped translation inline. An equally valid alternative is a plain `alt` non-empty fallback: `alt={title ?? tCommon('photo')}` — this would propagate into the `<Link>` accessible name via the subtree algorithm and requires no extra prop.

Lowest-risk one-liner: change `:186` from `alt={title ?? ''}` to `alt={title ?? tCommon('photo')}`. `tCommon` is not in scope inside `SimilarThumb` itself; the prop must either be passed from the caller or the component must call `useTranslations('common')` internally (one hook call, no new translation key needed).

**Severity:** LOW under the high-bar policy (this feature is gated on production semantic search; admin can turn it off; no security or data-loss consequence; fix is a one-line alt text fallback). Does not rise to CRIT/HIGH because the photo page itself retains its full accessible title, and AT users can navigate to the photo by other means (main gallery listing). Filed because it is a firm WCAG Level A failure on a public surface that is currently live in production.

---

## All other public surfaces — no new defects found

| Surface | Evidence |
|---|---|
| Skip link → `#main-content` | `layout.tsx:124` + `(public)/layout.tsx:12`: `<main id="main-content" tabIndex={-1}>` — correctly wired. |
| `<nav aria-label>` landmark | `nav-client.tsx:78` — present. |
| Masonry photo Links | `home-client.tsx:296–299` — `aria-label={t('aria.viewPhoto', { title: displayTitle })}`. `getPhotoDisplayTitle` always returns non-empty (falls back to `t('common.photo')`). |
| Lightbox | `lightbox.tsx:447–671` — `role="dialog"`, `aria-label`, FocusTrap, all nav buttons `h-11 w-11` with `aria-label`, close on Escape confirmed by code. |
| Tag filter chips | `tag-filter.tsx:67–95` — `<button>` inside `<Badge asChild>` with `min-h-11`, `role="group"` wrapper, `aria-pressed`. |
| Back-to-top | `home-client.tsx:441–456` — `min-h-11 min-w-11`, `aria-label`, `tabIndex={-1}` when hidden. |
| Photo navigation (prev/next) | `photo-navigation.tsx:219–243` — `<Button>` with `h-12 w-12`, `aria-label`. |
| Search dialog | `search.tsx` — `role="dialog"`, `aria-modal`, combobox pattern fully wired, live region at `:389`. |
| Similar-photos toggle | `similar-photos.tsx:111–117` — `<button>` with `min-h-11`, `aria-expanded`, `aria-controls`. |
| Color-details accordion | `color-details-section.tsx:288–304` — toggle button gets accessible name from `{accordionLabel}` text child. |
| Info bottom-sheet | `info-bottom-sheet.tsx` — `role="dialog"`, `aria-modal`, `aria-label`, close button with `aria-label`. |
| On-this-day widget | `on-this-day-widget.tsx:37,59,68` — `<aside aria-label>`, per-link `aria-label`, `alt` on images. |
| Shared group page (`/g/[key]`) | Links have `alt={getPhotoDisplayTitle(image, t('photo'))}` (always non-empty). |
| `alt_text` fallback chain | `getConcisePhotoAltText` (`photo-title.ts:85`) always returns non-empty string (title → tags → alt_text_suggested → fallback). Used in home-client, photo-viewer, lightbox, on-this-day — all correct. |
| DES-R9C3-02 deferred item | Re-confirmed admin-only; exit criterion unchanged; not re-filed. |
| DEF-C11-01 deferred item | Search `<Input>` 32 px; out-of-scope per policy; not re-filed. |

---

## Summary

- **Cycle-3 fixes verified:** DES-R9C3-01 holds (3 aria-labels in bulk-edit-dialog). Touch-target gate passes.
- **New defect: DES-R9C4-01 [LOW, conf HIGH]** — `SimilarThumb` links at `similar-photos.tsx:179` produce empty accessible names when `title` AND `description` are both null (common case). WCAG 4.1.2 + 2.4.4 Level A failure on the PUBLIC photo-viewer surface while semantic search is production-active. Minimal fix: change `alt={title ?? ''}` to `alt={title ?? tCommon('photo')}` in `SimilarThumb` (requires passing/importing `tCommon`).
- **All other public-surface interactive elements** reviewed: named, sized, landmarked, and focus-managed correctly.
- **Convergence status:** not yet — one new WCAG Level A defect on a live public surface.
