# Aggregate Review: Cycle 2 Fresh (2026-05-04)

**Reviewer**: Single-pass comprehensive review (no agent fan-out available in this environment)
**Focus**: Professional photographer workflow -- upload/ingest, EXIF handling, gallery browsing UX, sharing, organization, search, download/export, mobile experience

---

## GATE STATUS

| Gate | Status |
|------|--------|
| eslint | PASS |
| typecheck | **FAIL** -- `upload-dropzone.tsx:124` TS2695 comma operator |
| vitest | PASS (118 files, 1012 tests) |
| lint:api-auth | PASS |
| lint:action-origin | PASS |
| lint:public-route-rate-limit | PASS |

---

## FINDINGS

### C2-TS01: TypeScript build error -- comma operator in upload-dropzone.tsx [HIGH/High]

**File**: `apps/web/src/components/upload-dropzone.tsx:124`

```typescript
const previewUrls = (previewVersion, previewUrlsRef.current);
```

The comma operator evaluates both operands and returns the right one. TypeScript's `TS2695` flags the left side as unused with no side effects. This is a **blocking build error** -- `tsc --noEmit` fails.

**Fix**: Replace with an explicit `void` statement to register the reactivity dependency:

```typescript
void previewVersion; // force re-render when preview URLs change
const previewUrls = previewUrlsRef.current;
```

---

### C2-ADMIN01: Admin dashboard shows upload date instead of capture date [LOW/High]

**File**: `apps/web/src/components/image-manager.tsx:486`

```typescript
<TableCell suppressHydrationWarning>{image.created_at ? new Date(image.created_at).toLocaleDateString(locale, ...) : '-'}</TableCell>
```

The admin image table displays `created_at` (upload timestamp) rather than `capture_date` (EXIF capture date). The gallery and all listing queries sort by `capture_date DESC, created_at DESC, id DESC`, so the date column in the admin dashboard is inconsistent with the actual sort order.

For a photographer managing their gallery, seeing the capture date is more useful since it corresponds to when the photo was taken, which is the primary sort dimension. The admin listing query already fetches `capture_date` via `adminListSelectFields`, so the data is available -- only the display needs to change.

**Severity**: Low -- admin-only, does not affect public visitors.

---

## SUMMARY

The codebase is in excellent shape after extensive prior cycle work. Only **2 findings** were identified: one blocking TypeScript build error and one minor admin UX inconsistency. The photographer workflow is well-served -- EXIF extraction is thorough, gallery browsing is responsive with masonry layout and lazy loading, sharing works correctly with share link generation and view counting, and the upload flow handles validation, progress tracking, and per-file tag assignment.

No JSON-LD exposure time bug exists: the stored values are rational strings without the "s" suffix, and the template correctly appends it.

The 19 deferred items from cycle 1 remain correctly deferred -- they require schema migrations, new infrastructure (SSE/WebSocket), or significant feature design.