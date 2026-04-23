# Code Reviewer — Cycle 39

## Review Scope

Full codebase review covering all server actions, data layer, middleware, auth, image processing, frontend components, and utility modules.

## New Findings

### CR-39-01: `batchUpdateImageTags` remove path still uses slug-only lookup [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/app/actions/tags.ts` lines 309-318
- **Description:** While `removeTagFromImage` was fixed in C38-01 to look up by exact name first, the remove path inside `batchUpdateImageTags` still uses slug-only lookup (`eq(tags.slug, slug)`). This means the same slug collision bug that was fixed in `removeTagFromImage` still exists in `batchUpdateImageTags`.
- **Fix:** Apply the same name-first lookup pattern from `removeTagFromImage` to the remove loop in `batchUpdateImageTags`.

### CR-39-02: `processImageFormats` hard link then copy fallback can overwrite an in-use file [LOW] [MEDIUM confidence]
- **File:** `apps/web/src/lib/process-image.ts` lines 381-389
- **Description:** In the 2048-size base filename creation, the code does `fs.unlink(basePath)` before `fs.link()`. If the unlink succeeds but the link fails, the fallback `fs.copyFile` recreates the file. However, there is a brief window where the base file doesn't exist (after unlink, before link/copy), which could cause a 404 for a concurrent request. In practice, processing is queue-serialized (concurrency 1), so this window is tiny, but it exists.
- **Fix:** Write to a temp file first, then rename (atomic on most filesystems) instead of unlink+link.

### CR-39-03: `admin-user-manager.tsx` uses `htmlFor`-less `<label>` without `id` on input [LOW] [HIGH confidence]
- **File:** `apps/web/src/components/admin-user-manager.tsx` lines 93-94, 97-98
- **Description:** The create user dialog uses `<label className="text-sm font-medium">` without `htmlFor`, and the `<Input>` elements lack matching `id` attributes. Clicking the label text does not focus the input. Screen readers cannot associate labels with fields.
- **Fix:** Add `htmlFor` to labels and matching `id` to inputs (e.g., `htmlFor="create-username"` / `id="create-username"`).

### CR-39-04: `info-bottom-sheet.tsx` GPS block uses `isAdminProp` but data is always excluded [LOW] [HIGH confidence]
- **File:** `apps/web/src/components/info-bottom-sheet.tsx` lines 288-301
- **Description:** Same dead GPS code issue as C38-02 but in the mobile bottom sheet component. The `isAdminProp` check is used to conditionally render GPS coordinates, but `latitude`/`longitude` are never included in the public query results (`selectFields`). This mirrors the dead code in `photo-viewer.tsx` that was annotated in C38-02.
- **Fix:** Add the same comment block explaining the GPS block is unreachable, matching the C38-02 fix in photo-viewer.tsx.

## Previously Deferred Items Confirmed

All previously deferred items remain valid and unchanged. No regressions introduced.
