# Plan 89 — Upload Label Accessibility and Admin Checkbox Component Upgrade

**Source review:** Cycle 3 Comprehensive Review (C3-F01, C3-F02)
**Status:** DONE (C3-F01 implemented, C3-F02 deferred)

---

## Implementation Log

- **C3-F01**: Fixed in commit 265d8c3 — added `htmlFor`/`id` to upload dropzone labels
- **C3-F02**: DEFERRED — no Checkbox UI component exists in the project; adding one would be a feature addition
**Created:** 2026-04-19

---

## Findings to Address

| ID | Description | Severity | Confidence |
|----|------------|----------|------------|
| C3-F01 | Upload dropzone `<label>` not associated with `<select>` via `htmlFor`/`id` | MEDIUM | HIGH |
| C3-F02 | Admin image manager checkboxes use native `<input>` instead of Checkbox component | LOW | HIGH |

---

## C3-F01: Upload dropzone label accessibility

**File:** `apps/web/src/components/upload-dropzone.tsx`, lines 222-234

**Current code (line 222):**
```tsx
<label className="text-sm font-medium mb-1 block">{t('upload.topic')}</label>
<select
    className="..."
    value={topic}
    onChange={(e) => setTopic(e.target.value)}
>
```

**Current code (line 234):**
```tsx
<label className="text-sm font-medium mb-1 block">{t('upload.tags')} ({t('home.allTags')})</label>
```

**Fix:**
1. Add `id="upload-topic"` to the `<select>` element
2. Add `htmlFor="upload-topic"` to the topic `<label>`
3. Add `id="upload-tags"` to a wrapper div around the TagInput
4. Add `htmlFor="upload-tags"` to the tags `<label>`

---

## C3-F02: Admin checkbox component upgrade

**File:** `apps/web/src/components/image-manager.tsx`, lines 283-288, 303-309

**Current code (select all checkbox, line 283):**
```tsx
<input
    type="checkbox"
    className="h-4 w-4 rounded border-gray-300 text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    checked={images.length > 0 && selectedIds.size === images.length}
    onChange={toggleSelectAll}
    aria-label={t('aria.selectAll')}
/>
```

**Current code (per-row checkbox, line 303):**
```tsx
<input
    type="checkbox"
    className="h-4 w-4 rounded border-gray-300 text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    checked={selectedIds.has(image.id)}
    onChange={() => toggleSelect(image.id)}
    aria-label={t('aria.selectImage', { title: image.title || image.id })}
/>
```

**Fix:**
1. Import `Checkbox` from `@/components/ui/checkbox`
2. Replace both `<input type="checkbox">` with `<Checkbox>` component
3. Map `checked` -> `checked`, `onChange` -> `onCheckedChange`, `aria-label` stays
4. Remove custom Tailwind classes (Checkbox component provides its own styling)

---

## Implementation Order

1. Fix C3-F01 (upload label htmlFor/id) — simple, isolated
2. ~~Fix C3-F02 (admin checkbox component)~~ — DEFERRED: No Checkbox UI component exists in the project. Creating one would be a new feature addition beyond the scope of a bug fix. The existing native checkboxes have `aria-label` attributes and functional focus styles. Deferring until a Checkbox component is added to the design system.

---

## C3-F02 Deferral Note

- **Reason:** No `@/components/ui/checkbox` component exists in the project. Adding one requires installing `@radix-ui/react-checkbox`, creating the component file, and then migrating the image manager. This is a feature addition, not a bug fix.
- **Exit criterion:** When a Checkbox component is added to the UI library (e.g., via `npx shadcn@latest add checkbox`), re-open this finding and migrate the admin image manager checkboxes.

---

## Verification

- [x] `npm run build` passes
- [x] `npm run lint` passes (0 errors, 1 pre-existing warning)
- [x] `npm test` passes (66/66)
- [x] Deployed to production successfully
