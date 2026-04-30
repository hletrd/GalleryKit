# Plan 108 — Cycle 3 Fresh Review Fixes

**Source:** Cycle 3 fresh deep review (`cycle3-comprehensive-review.md`, `_aggregate-cycle3-fresh.md`)
**Created:** 2026-04-19

---

## Tasks

### Task 1: Fix photo-viewer GPS guard — use `isAdmin` instead of `canShare` [C3R-01]

**File:** `apps/web/src/components/photo-viewer.tsx` line 474
**Severity:** MEDIUM | **Confidence:** HIGH

**Current code:**
```tsx
{(canShare && image.latitude != null && image.longitude != null) && (
```

**Fix:** Add an `isAdmin` prop to `PhotoViewer` (matching the `isAdminProp` pattern in `info-bottom-sheet.tsx`) and use it for the GPS guard. Pass it from the page component.

**Steps:**
1. Add `isAdmin?: boolean` to `PhotoViewerProps`
2. Change the GPS guard from `canShare` to `isAdmin`
3. Update all call sites to pass the `isAdmin` prop
4. Add a comment explaining the guard

**Status:** pending

---

### Task 2: Apply name-first lookup in `batchAddTags` and `addTagToImage` [C3R-02]

**File:** `apps/web/src/app/actions/tags.ts` lines 123, 212-213
**Severity:** LOW | **Confidence:** MEDIUM

**Current code:** Both `addTagToImage` (line 123) and `batchAddTags` (line 212-213) look up tags by slug only after INSERT IGNORE.

**Fix:** Apply the same name-first, slug-fallback lookup pattern already used in `removeTagFromImage` and `batchUpdateImageTags` remove path:
```ts
// After INSERT IGNORE, look up by name first, then fall back to slug
let [tagRecord] = await db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.name, cleanName));
if (!tagRecord) {
    [tagRecord] = await db.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.slug, slug));
}
```

**Steps:**
1. Update `addTagToImage` to use name-first lookup
2. Update `batchAddTags` to use name-first lookup (inside the transaction, using `tx`)
3. Verify slug collision warning still fires correctly
4. Run existing tests

**Status:** pending

---

### Task 3: Fix document.title stale restoration in photo-viewer [C3R-03]

**File:** `apps/web/src/components/photo-viewer.tsx` lines 72-78
**Severity:** LOW | **Confidence:** MEDIUM

**Current code:** The useEffect captures `previousTitle` and restores it on cleanup, causing stale title flash.

**Fix:** Use a ref to track the site title and only update the document title when the image changes, without restoring on cleanup:
```tsx
const siteTitleRef = useRef(document.title);
useEffect(() => {
    if (image?.title) {
        document.title = `${image.title} — ${siteConfig.nav_title}`;
    } else {
        document.title = siteTitleRef.current;
    }
}, [image?.id, image?.title]);
```

**Steps:**
1. Replace the current useEffect with the ref-based approach
2. Test photo navigation

**Status:** pending

---

### Task 4: Remove eslint-disable in info-bottom-sheet by tracking previous isOpen [C3R-04]

**File:** `apps/web/src/components/info-bottom-sheet.tsx` lines 30-35
**Severity:** LOW | **Confidence:** HIGH

**Current code:** Uses `eslint-disable-next-line react-hooks/set-state-in-effect` for `setSheetState('peek')`.

**Fix:** Track previous `isOpen` via a ref and only call `setSheetState('peek')` when transitioning from false to true:
```tsx
const prevIsOpenRef = useRef(isOpen);
useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
        setSheetState('peek');
    }
    prevIsOpenRef.current = isOpen;
}, [isOpen]);
```

**Steps:**
1. Add `prevIsOpenRef` ref
2. Update the useEffect to use the ref-based guard
3. Remove the eslint-disable comment
4. Verify the bottom sheet still resets on open

**Status:** pending

---

## Deferred Items

No findings deferred this cycle — all 4 findings are scheduled for implementation.

Carried-forward deferred items remain in their respective plan files:
- `105-deferred-cycle38.md`
- `107-deferred-cycle39.md`
- And all earlier deferred-item plans (see `.context/plans/` directory)

---

## Progress Tracking

| Task | Status | Commit |
|-------|--------|--------|
| Task 1: photo-viewer GPS guard | done | 0000000d48812bc44539fb36e8607bd4204dc0ac |
| Task 2: batchAddTags name-first lookup | done | 0000000457667a7c72d4ff7ef3d347d2b00449a7 |
| Task 3: document.title stale restoration | done | 0000000d48812bc44539fb36e8607bd4204dc0ac (included in Task 1 commit) |
| Task 4: info-bottom-sheet eslint-disable | done | 0000000284b6769451b91bb51e3c8689af3d457c |
