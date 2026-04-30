# Plan 100 — Cycle 12 Fixes

**Created:** 2026-04-19 (Cycle 12)
**Status:** DONE

---

## Findings to Address

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| C12-F01 | `db-actions.ts` exposes raw error messages to client in toast messages | MEDIUM | High | IMPLEMENTED |
| C12-F02 | `uploadImages` disk space check uses dynamic `import('fs/promises')` unnecessarily | LOW | Medium | IMPLEMENTED |
| C12-F03 | `deleteTopicAlias` missing `/admin/tags` revalidation | LOW | High | IMPLEMENTED |
| C12-F04 | `db-actions.ts` backup writeStream error swallowing during flush | LOW | High | IMPLEMENTED |

---

## C12-F01: Error message leakage in DB admin page — IMPLEMENT

**File:** `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:51,80,112`

**Fix:** Replace the three catch blocks that expose raw error messages:

1. Line 51 (handleBackup catch): Replace `e instanceof Error ? e.message : 'Unknown error'` with empty string (server action result already contains localized error)
2. Line 80 (handleRestore catch): Same fix
3. Line 112 (handleExportCsv catch): Same fix

The server actions (`dumpDatabase`, `restoreDatabase`, `exportImagesCsv`) already return localized error strings in their result objects. The catch blocks are for truly unexpected client-side exceptions, where showing internal details is unnecessary and potentially harmful.

**Progress:** [x] Implemented — commit bd111fb

---

## C12-F02: Dynamic import on every upload invocation — IMPLEMENTED

**File:** `apps/web/src/app/actions/images.ts:1,91-93`

**Fix:**
1. Add `statfs` to the top-level import from `fs/promises` (line 4)
2. Remove the `await import('fs/promises')` dynamic import inside the `uploadImages` function (lines 91-93)
3. Use `statfs` directly from the static import

**Progress:** [x] Implemented — commit 2f674a2

---

## C12-F03: deleteTopicAlias missing /admin/tags revalidation — IMPLEMENTED

**File:** `apps/web/src/app/actions/topics.ts:295`

**Fix:** Add `/admin/tags` to the revalidation paths in `deleteTopicAlias`:

```ts
revalidateLocalizedPaths('/admin/categories', '/admin/tags', '/admin/dashboard', `/${alias}`, `/${topicSlug}`);
```

This matches the pattern used in `createTopic` (line 84) and `updateTopic` (line 174).

**Progress:** [x] Implemented — commit a407aeb

---

## C12-F04: Backup writeStream error swallowing during flush — IMPLEMENTED

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:129-156`

**Fix:**
1. Add a `writeError` flag before the writeStream is created: `let writeError = false;`
2. Change the existing `writeStream.on('error', ...)` handler (line 129) to also set `writeError = true`
3. Change the flush-wait error handler (line 154) from `resolveFlush` to a handler that sets `writeError = true` and then calls `resolveFlush`
4. After the flush-wait promise resolves, check `writeError`: if true, delete the output file and resolve with failure

**Progress:** [x] Implemented — commit 81b9acd

---

## Deferred Items

| ID | Reason | Exit Criterion |
|----|--------|----------------|
| C12-F05 | Informational only — keyboard handler deps are correct, no user-visible bug | N/A — will re-evaluate if stale closure causes issues |

---

## Verification

- [x] C12-F01: No raw error messages exposed in DB admin page catch blocks
- [x] C12-F02: `statfs` imported statically at top of images.ts
- [x] C12-F03: `deleteTopicAlias` includes `/admin/tags` in revalidation
- [x] C12-F04: Backup writeStream errors properly tracked and reported
- [x] `npm run lint --workspace=apps/web` passes with 0 errors
- [x] `npm run build` passes
- [x] `cd apps/web && npx vitest run` passes (9 files, 66 tests)
