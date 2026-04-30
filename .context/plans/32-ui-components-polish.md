# Plan 32: UI Component Polish and UX Improvements

**Priority:** MEDIUM
**Estimated effort:** 2-3 hours
**Sources:** U-03, U-07, U-10, U-11, U-12, U-13, U-19, U-20, U-21
**Status:** COMPLETED (cycle 1, commits 0ea2eb9, 29a873c)

---

## Scope
- Fix preview URL recreation flash in upload dropzone
- Add touch-drag tracking to bottom sheet
- Fix minor component issues (Math.max spread, clipboard fallback, observer recreation, hydration mismatch, click suppression, fullscreen errors, stale refs)

---

## Item 1: Fix preview URL recreation flash (U-03)

**File:** `apps/web/src/components/upload-dropzone.tsx:43-57`

**Problem:** `useMemo` creates new `URL.createObjectURL` calls for ALL files whenever `files` changes. Adding 1 file to 50 existing causes all 51 previews to flash.

**Fix:** Replace the `useMemo` + cleanup effect with a ref-based Map that incrementally manages URLs:

```typescript
const previewUrlsRef = useRef<Map<string, string>>(new Map());

// Sync URLs on files change
useEffect(() => {
    const currentIds = new Set(files.map(f => getFileId(f)));
    const existingIds = new Set(previewUrlsRef.current.keys());

    // Revoke URLs for removed files
    for (const id of existingIds) {
        if (!currentIds.has(id)) {
            URL.revokeObjectURL(previewUrlsRef.current.get(id)!);
            previewUrlsRef.current.delete(id);
        }
    }

    // Create URLs for new files
    for (const file of files) {
        const id = getFileId(file);
        if (!previewUrlsRef.current.has(id)) {
            previewUrlsRef.current.set(id, URL.createObjectURL(file));
        }
    }
}, [files]);

// Cleanup on unmount
useEffect(() => {
    return () => {
        for (const url of previewUrlsRef.current.values()) {
            URL.revokeObjectURL(url);
        }
    };
}, []);
```

Note: Since `useRef` doesn't trigger re-renders, we need a way to force re-render when URLs change. Option: use `useState` for the Map, or use a counter that increments on sync.

Simpler approach: use `useState` with the Map:

```typescript
const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(new Map());

useEffect(() => {
    setPreviewUrls(prev => {
        const next = new Map(prev);
        const currentIds = new Set(files.map(f => getFileId(f)));

        // Revoke removed
        for (const [id, url] of next) {
            if (!currentIds.has(id)) {
                URL.revokeObjectURL(url);
                next.delete(id);
            }
        }

        // Create new
        for (const file of files) {
            const id = getFileId(file);
            if (!next.has(id)) {
                next.set(id, URL.createObjectURL(file));
            }
        }

        return next === prev ? prev : next; // avoid re-render if no change
    });
}, [files]);

// Cleanup on unmount
useEffect(() => {
    return () => {
        for (const url of previewUrls.values()) {
            URL.revokeObjectURL(url);
        }
    };
}, []); // empty deps — only on unmount
```

Wait — the cleanup effect references `previewUrls` which would be stale. Better approach:

```typescript
const urlsRef = useRef<Map<string, string>>(new Map());

useEffect(() => {
    const currentIds = new Set(files.map(f => getFileId(f)));
    let changed = false;

    // Revoke removed
    for (const [id, url] of urlsRef.current) {
        if (!currentIds.has(id)) {
            URL.revokeObjectURL(url);
            urlsRef.current.delete(id);
            changed = true;
        }
    }

    // Create new
    for (const file of files) {
        const id = getFileId(file);
        if (!urlsRef.current.has(id)) {
            urlsRef.current.set(id, URL.createObjectURL(file));
            changed = true;
        }
    }

    // Force re-render if URLs changed
    if (changed) setPreviewVersion(v => v + 1);
}, [files]);

const [previewVersion, setPreviewVersion] = useState(0);
```

---

## Item 2: Add touch-drag tracking to bottom sheet (U-07)

**File:** `apps/web/src/components/info-bottom-sheet.tsx:47-84`

**Problem:** No `onTouchMove` handler — sheet snaps between discrete states instead of following the finger.

**Fix:** Add `onTouchMove` with live translateY tracking and `preventDefault()` to stop background scroll:

```typescript
const [liveTranslateY, setLiveTranslateY] = useState<number | null>(null);

const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    e.preventDefault(); // prevent background scroll
    const deltaY = e.changedTouches[0].clientY - touchStartY.current;
    setLiveTranslateY(deltaY);
}, []);

const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartY.current === null || touchStartTime.current === null) return;
    setLiveTranslateY(null); // reset live tracking

    const deltaY = e.changedTouches[0].clientY - touchStartY.current;
    // ... existing snap logic ...
}, [onClose]);
```

And update the style to use liveTranslateY when available:
```typescript
style={{
    transform: `translateY(${liveTranslateY !== null
        ? `calc(${getTranslateY(sheetState)} + ${liveTranslateY}px)`
        : getTranslateY(sheetState)})`,
    transition: liveTranslateY !== null ? 'none' : undefined, // disable transition during drag
    ...
}}
```

---

## Item 3: Fix Math.max spread in histogram (U-10)

**File:** `apps/web/src/components/histogram.tsx:86, 107`

**Fix:** Replace `Math.max(...bins, 1)` with `bins.reduce((max, v) => v > max ? v : max, 1)`.

Two occurrences:
- Line 86: `const max = Math.max(...bins, 1);` in `drawChannel`
- Line 107: `const maxAll = Math.max(...data.r, ...data.g, ...data.b, 1);` in RGB mode

For line 107, the fix:
```typescript
const maxAll = [...data.r, ...data.g, ...data.b].reduce((max, v) => v > max ? v : max, 1);
```

---

## Item 4: Remove deprecated execCommand clipboard fallback (U-11)

**File:** `apps/web/src/lib/clipboard.ts`

**Fix:** Remove the `execCommand('copy')` fallback. If `navigator.clipboard.writeText()` is unavailable, show an error message.

---

## Item 5: Fix IntersectionObserver recreation in load-more (U-12)

**File:** `apps/web/src/components/load-more.tsx:69-84`

**Fix:** Remove `hasMore` from the dependency array of the observer `useEffect`. The callback already checks `hasMore` via `loadMoreRef.current`.

```typescript
useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
        (entries) => {
            if (entries[0].isIntersecting) {
                loadMoreRef.current();
            }
        },
        { rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
}, []); // empty deps — create once
```

---

## Item 6: Fix sessionStorage hydration mismatch (U-13)

**File:** `apps/web/src/components/photo-viewer.tsx:46-48`

**Fix:** Initialize with `false` and read `sessionStorage` in a `useEffect`:

```typescript
const [showLightbox, setShowLightbox] = useState(false);
useEffect(() => {
    try {
        if (sessionStorage.getItem('gallery_auto_lightbox') === 'true') {
            setShowLightbox(true);
        }
    } catch {}
}, []);
```

---

## Item 7: Fix click preventDefault in image-zoom (U-19)

**File:** `apps/web/src/components/image-zoom.tsx:41-51`

**Fix:** Only prevent default on the zoom container itself, not on interactive children:

```typescript
const handleClick = useCallback((e: React.MouseEvent) => {
    // Don't intercept clicks on interactive elements inside the zoom
    if (e.target instanceof HTMLAnchorElement || e.target instanceof HTMLButtonElement) return;
    e.preventDefault();
    setIsZoomed(prev => { ... });
}, [applyTransform]);
```

---

## Item 8: Add fullscreen error feedback (U-20)

**File:** `apps/web/src/components/lightbox.tsx:101-104`

**Fix:** Add toast feedback on fullscreen failure:

```typescript
const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {
            toast.error(t('viewer.fullscreenUnavailable'));
        });
    } else {
        document.exitFullscreen().catch(() => {});
    }
}, [t]);
```

And add the translation key to `en.json` and `ko.json`.

---

## Item 9: Fix stale search refs accumulation (U-21)

**File:** `apps/web/src/components/search.tsx:24`

**Fix:** Reset the refs array when results change:

```typescript
useEffect(() => {
    resultRefs.current = [];
}, [results]);
```

---

## Deferred Items

- **U-15 (connection limit docs mismatch):** Very low priority — either update CLAUDE.md to match the code (10 connections) or update the code. Recommend updating the documentation.
- **U-18 (enumerative revalidatePath):** Low priority — the current approach works correctly. A `revalidatePath('/', 'layout')` alternative exists for batch operations but would invalidate more cache than necessary for small mutations.
