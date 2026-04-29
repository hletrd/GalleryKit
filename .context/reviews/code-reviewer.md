# Code Review Report — code-reviewer

Repository: `/Users/hletrd/flash-shared/gallery`  
Date: 2026-04-29  
Scope: whole repository, focusing on code quality, logic, SOLID boundaries, and maintainability.  
Verification: `npm run lint --workspace=apps/web` passed.

## Inventory reviewed

Primary application inventory was built from `apps/web/src`, `apps/web/scripts`, config, docs, and tests. Relevant inspected areas:

- App router pages/routes: `apps/web/src/app/[locale]/**`, `apps/web/src/app/api/**`, upload routes, metadata routes, middleware/proxy.
- Server actions: `apps/web/src/app/actions/*.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`.
- Data/auth/storage core: `apps/web/src/lib/*.ts`, `apps/web/src/lib/storage/*`, `apps/web/src/db/*`.
- Client components: `apps/web/src/components/**/*.tsx` and admin protected client pages.
- Operational scripts/config: `apps/web/scripts/*`, `apps/web/next.config.ts`, `apps/web/playwright.config.ts`, package scripts.
- Tests/docs: `apps/web/src/__tests__/*`, root `README.md`, `apps/web/README.md`.

## Summary

- Critical: 0
- High: 0
- Medium: 4
- Low: 0
- Recommendation: **COMMENT / address medium issues before further hardening cycles**

## Findings

### MEDIUM 1. Shared-group view counts are incremented for intra-share photo navigation

- Location: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:99-107`, `apps/web/src/lib/data.ts:844-848`
- Severity: Medium
- Confidence: High

`SharedGroupPage` calls `getSharedGroupCached(key)` without options for both the gallery view and `?photoId=` detail view. `getSharedGroup()` increments the view counter by default after every successful fetch. A single visitor who opens a shared group and browses 10 photos can therefore record roughly 10+ views, because each selected-photo URL render re-fetches the group and reaches the default increment path.

Concrete failure scenario: an owner sends one group share link to one person. That person clicks the first thumbnail, then uses next/previous through the shared photo viewer. The admin dashboard reports many group views even though there was only one external visit.

Suggested fix: separate “share opened” counting from “photo selected” rendering. For example, pass `{ incrementViewCount: !photoIdParam }` from `SharedGroupPage`, or add a small cookie/session-based once-per-key counter. Keep `generateMetadata()` on `{ incrementViewCount: false }` as it already does.

---

### MEDIUM 2. File-serving routes validate one path but stream another raceable path

- Location: `apps/web/src/lib/serve-upload.ts:75-92`, `apps/web/src/app/api/admin/db/download/route.ts:60-83`
- Severity: Medium
- Confidence: Medium

Both handlers perform `lstat()` and `realpath()` containment checks, but then call `createReadStream()` on the original path (`absolutePath` / `filePath`) instead of the already-resolved path. That leaves a time-of-check/time-of-use gap: the file can be swapped after validation and before open.

Concrete failure scenario: in a compromised or mis-permissioned upload/backup directory, an attacker replaces the checked regular file with a symlink between `realpath()` and `createReadStream()`. The route can stream content that was not the file previously validated. The current extension/path validation reduces remote exploitability, but the handler structure is fragile and easy to regress.

Suggested fix: stream from `resolvedPath` / `resolvedFilePath` after validation, or stronger, open a file descriptor with no-follow semantics where available, `fstat()` that fd, then create the stream from the fd. Keep the descriptor-bound identity through validation and streaming.

---

### MEDIUM 3. Settings actions trust `Record<string, string>` at runtime and can throw 500s on malformed Server Action payloads

- Location: `apps/web/src/app/actions/settings.ts:40-65`, `apps/web/src/app/actions/seo.ts:55-94`
- Severity: Medium
- Confidence: High

`updateGallerySettings()` and `updateSeoSettings()` accept `Record<string, string>`, then call `value.trim()` for every entry. TypeScript only protects first-party callers; Server Action payloads can still be malformed at runtime. A non-string value such as `null`, a number, or an array causes a `TypeError` before the action reaches its structured validation/error return path.

Concrete failure scenario: an admin browser extension, stale client bundle, or malicious same-origin script calls the Server Action with `{ seo_title: null }`. Instead of returning a localized validation error, the action throws and the UI receives a generic failure/500. This makes the action surface less robust and complicates incident triage.

Suggested fix: add a shared `normalizeStringRecord(input, allowedKeys)` helper that verifies a plain object, rejects non-string values before trimming, caps total keys/length, and returns `{ error }` rather than throwing. Reuse it for gallery and SEO settings to reduce duplication.

---

### MEDIUM 4. Batch tag update assumes arrays and can treat a string as many one-character tags

- Location: `apps/web/src/app/actions/tags.ts:338-357`, `apps/web/src/app/actions/tags.ts:375-408`
- Severity: Medium
- Confidence: High

`batchUpdateImageTags()` checks `addTagNames.length` and `removeTagNames.length`, but never verifies `Array.isArray()` or that each element is a string. Strings are iterable, so a malformed call like `addTagNames = "travel"` passes the length check and then iterates `t`, `r`, `a`, `v`, `e`, `l` as separate tags. Since one-character tag names are valid, this can create unintended tags and attach them to the image.

Concrete failure scenario: a stale/custom admin client sends `batchUpdateImageTags(42, "travel" as any, [])`. The action may create six tags instead of rejecting the payload, then returns success and refreshes admin state.

Suggested fix: fail closed before the length check:

```ts
if (!Array.isArray(addTagNames) || !Array.isArray(removeTagNames)) { ... }
if (!addTagNames.every((v) => typeof v === 'string') || !removeTagNames.every((v) => typeof v === 'string')) { ... }
```

Then trim/canonicalize/dedupe the arrays once before entering the transaction.

## Final sweep notes

- Auth guards and same-origin checks are consistently applied to mutating Server Actions and admin API routes.
- Public image data selection has explicit privacy boundaries for GPS/original filenames.
- Lint passed with no findings.
- No source files were modified during this review; only this report was written.
