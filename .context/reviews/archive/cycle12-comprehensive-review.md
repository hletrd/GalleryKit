# Comprehensive Code Review — Cycle 12 (2026-04-19)

**Reviewer:** Single multi-angle reviewer
**Scope:** Full codebase review focusing on new findings not previously reported

---

## Methodology

Reviewed all server actions, data layer, middleware, image processing pipeline, admin UI components, security architecture, and cross-file interactions. Cross-referenced against prior cycle reviews (cycles 1-11) to avoid re-reporting resolved issues.

---

## Findings

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| C12-F01 | `db-actions.ts` exposes `e instanceof Error ? e.message : 'Unknown error'` to client in toast messages | MEDIUM | High | IMPLEMENT |
| C12-F02 | `uploadImages` disk space check uses dynamic `import('fs/promises')` on every invocation | LOW | Medium | IMPLEMENT |
| C12-F03 | `deleteTopicAlias` missing `/admin/tags` revalidation (inconsistent with other topic ops) | LOW | High | IMPLEMENT |
| C12-F04 | `db-actions.ts` backup writeStream error swallowing during flush returns success on corrupt file | LOW | High | IMPLEMENT |
| C12-F05 | `photo-viewer.tsx` keyboard handler stale closure — informational only | LOW | Low | DEFER |

---

### C12-F01: Error message leakage in DB admin page [MEDIUM]

**File:** `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:51,80,112`

The `handleBackup`, `handleRestore`, and `handleExportCsv` functions all include raw error messages in toast notifications:

```tsx
toast.error(`${t('errorBackup')}: ${e instanceof Error ? e.message : 'Unknown error'}`);
```

Server-side errors (MySQL connection failures, file system errors, etc.) could contain internal details like DB hostnames, file paths, or stack trace fragments. These should be sanitized or replaced with generic user-facing messages.

**Fix:** Replace `e instanceof Error ? e.message : 'Unknown error'` with a generic fallback like `t('errorUnknown')`. The server actions already return localized error strings in their result objects — only the catch blocks need fixing.

---

### C12-F02: Dynamic import on every upload invocation [LOW]

**File:** `apps/web/src/app/actions/images.ts:91-93`

The disk space check uses `await import('fs/promises')` on every `uploadImages` call:

```ts
const { statfs } = await import('fs/promises');
```

While this works, `statfs` has been available since Node.js 18.15+ (stable in Node 20+). Since the project requires Node.js 24+, the dynamic import is unnecessary and adds a micro-overhead on every upload call.

**Fix:** Replace the dynamic import with a top-level static import of `statfs` from `fs/promises`.

---

### C12-F03: deleteTopicAlias missing admin categories revalidation [LOW]

**File:** `apps/web/src/app/actions/topics.ts:295`

The `deleteTopicAlias` function calls:

```ts
revalidateLocalizedPaths('/admin/categories', '/admin/dashboard', `/${alias}`, `/${topicSlug}`);
```

Comparing with `createTopic` (line 84) and `updateTopic` (line 174), both also revalidate `/admin/tags`. If a topic alias deletion affects tag-related displays, this could cause stale cache. More importantly, the inconsistency itself is a maintainability risk.

**Fix:** Add `/admin/tags` to the revalidation paths in `deleteTopicAlias` to match the pattern of other topic operations.

---

### C12-F04: Backup writeStream error swallowing during flush [LOW]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:154`

```ts
writeStream.on('error', resolveFlush); // Don't hang on write error
```

During the flush-wait after `mysqldump` exits successfully, if the `writeStream` emits an error, the promise resolves immediately without checking whether the backup file was actually written correctly. The function then returns `{ success: true, ... }` even though the file on disk may be truncated or corrupt.

**Fix:** Add a flag to track whether the writeStream error occurred. If it did, delete the output file and return a failure instead of success.

---

### C12-F05: photo-viewer.tsx keyboard handler stale closure [LOW] (DEFERRED — informational)

**File:** `apps/web/src/components/photo-viewer.tsx:138-152`

The keyboard event handler's `useEffect` depends on `[navigate, showLightbox]`, which is correct. The `navigate` callback properly captures the current `currentIndex`, `images`, etc. No actual bug found — the dependency array is correct. Marking as informational only.

**Status:** Deferred. No code change needed.

---

## Final Sweep — Commonly Missed Issues Check

1. **Null byte injection in validation:** Checked `isValidTopicAlias` — regex correctly excludes `\x00`. Other validators handle appropriately.

2. **Mass assignment in uploadImages:** The `insertValues` object is built from server-generated data (not directly from user input). No mass assignment risk.

3. **Open redirect in db page:** The `handleBackup` function validates `result.url.startsWith('/api/admin/db/download')`. The download route uses `SAFE_FILENAME` regex and path containment check. Good.

4. **TOCTOU in file operations:** `serveUploadFile` does `lstat` then `createReadStream` — minor TOCTOU window but upload directory is admin-controlled. Low risk.

5. **Memory leaks in rate-limit Maps:** All Maps have pruning functions with hard caps. All look correct.

6. **Transaction safety:** All multi-step DB operations use transactions where needed. Good.

7. **Cookie security:** Session cookie uses `httpOnly`, `secure` (in production), `sameSite: lax`. Session token uses HMAC-SHA256 with `timingSafeEqual`. Good.

8. **Privacy guard:** The `selectFields` compile-time privacy guard excludes `latitude`, `longitude`, `filename_original`, `user_filename`. Good.

---

## PREVIOUSLY FIXED — Confirmed Resolved

All cycle 1-11 findings remain resolved. No regressions detected.

---

## DEFERRED CARRY-FORWARD

All previously deferred items from prior cycles remain deferred with no change in status (see plan 99-deferred-cycle11.md for full list).

---

## TOTALS

- **0 CRITICAL/HIGH** findings
- **1 MEDIUM** finding requiring implementation (C12-F01)
- **3 LOW** findings recommended for implementation (C12-F02, F03, F04)
- **1 LOW** finding deferred (C12-F05)
- **4 total** actionable new findings (1M + 3L, excluding deferred)
