# Code Review Report — code-reviewer (Cycle 14)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29
Scope: whole repository, focusing on code quality, logic, SOLID boundaries, and maintainability.
Verification: All prior cycle fixes confirmed intact (AGG9R-01 through AGG13-01).

## Inventory reviewed

All primary source files in `apps/web/src/` (237+ files): lib/ (38 files), components/ (30 files), app/ actions and routes (40+ files), db/ (3 files), __tests__/ (79+ files), config files. Focused on audit-log consistency, sanitization pipeline, action-guard coverage, cross-file interaction patterns, and edge cases missed in prior cycles.

## Verified fixes from prior cycles

All prior fixes confirmed intact:

1. AGG13-01 (`batchUpdateImageTags` audit log gated on `added > 0 || removed > 0`): FIXED — `tags.ts:457-460` correctly gates the `tags_batch_update` audit event.
2. AGG12-01 (`batchAddTags` audit on INSERT IGNORE no-ops): FIXED — `tags.ts:329-332` correctly gates on `affectedRows > 0`.
3. AGG11-01 (`removeTagFromImage` audit on no-op DELETE): FIXED — `tags.ts:254` gates on `affectedRows > 0`.
4. AGG10-01 (`addTagToImage` audit on no-op INSERT IGNORE): FIXED — `tags.ts:193` gates on `affectedRows > 0`.
5. AGG9R-01 (`countCodePoints` for DoS-prevention length bounds): FIXED — used in images.ts, topics.ts, seo.ts, public.ts.
6. AGG9R-02 (`withAdminAuth` origin check): FIXED — `api-auth.ts:31-37` checks `hasTrustedSameOrigin`.
7. AGG8R-01 (stateful `/g` regex in `sanitizeAdminString`): FIXED — uses `UNICODE_FORMAT_CHARS` (non-`/g`) for `.test()`.
8. AGG10-02/AGG10-03 (`.length` documentation): FIXED — comments present in `validation.ts`.

## New Findings

### C14-CR-01 (Medium / Medium). `searchImages` LIKE-wildcard injection through tag/alias search sub-queries — `%` and `_` not escaped in tag or alias conditions

- Location: `apps/web/src/lib/data.ts:995-1003`
- The main `searchImages` query at line 953 correctly escapes LIKE wildcards (`%`, `_`, `\`) before building the search term. However, the tag search sub-query at line 995 and the alias search sub-query at line 1000 reuse the SAME `searchTerm` (which includes the `%..%` wrapping) but the LIKE escape is applied correctly there too.
- **On closer inspection**: the `escaped` variable at line 953 is constructed from `query.trim().replace(/[%_\\]/g, '\\$&')` and then wrapped with `%${escaped}%`. Both the tag and alias sub-queries use the same `searchTerm`. This is actually correct — LIKE wildcards are properly escaped.
- **Revised finding**: The real issue is that the `searchTerm` variable is built ONCE at the top level, but `escaped` is derived from `query.trim()`, not from `sanitizedQuery` used later in `public.ts:116`. If `stripControlChars` changes the query (removes a control char), the LIKE term in `data.ts:953` was built from the pre-strip value, while the public action uses the post-strip value. However, `searchImages` in `data.ts` is a pure data-layer function that receives the already-sanitized query from `public.ts`, so the data layer itself does not re-sanitize.
- **Final assessment**: The LIKE escape is correct. The data layer relies on the caller to sanitize, which `public.ts:116` does. No actual bug here.
- **Revised severity**: No finding — LIKE escaping is correct.

### C14-CR-02 (Low / Medium). `deleteAdminUser` uses raw SQL queries with parameterized values instead of Drizzle ORM — inconsistency with the rest of the codebase

- Location: `apps/web/src/app/actions/admin-users.ts:206-229`
- The `deleteAdminUser` function uses raw `conn.query()` with parameterized SQL instead of Drizzle ORM. While this is necessary for the advisory lock (which requires a dedicated connection), the admin count check, user lookup, session deletion, and user deletion are all done with raw SQL instead of Drizzle. This is inconsistent with the rest of the codebase but functionally correct.
- The advisory lock pattern requires a dedicated connection that persists across multiple queries, which Drizzle's connection pool doesn't directly support — hence the raw SQL approach.
- Severity is Low because the code is correct and parameterized. The inconsistency is a maintainability concern, not a bug.
- Suggested fix: Add a code comment explaining why raw SQL is used here (advisory lock requires dedicated connection). The existing `deleteAdminUser` already has good error handling, but the rationale for raw SQL is implicit.

### C14-CR-03 (Low / Low). `audit.ts` metadata truncation re-serializes a truncated preview inside `JSON.stringify`, losing the original JSON structure

- Location: `apps/web/src/lib/audit.ts:29-33`
- When metadata exceeds 4096 bytes, the truncation logic spreads the serialized JSON string into code points, slices to 4000, and then re-wraps it as `{ truncated: true, preview: "..." }` — but the `preview` value is a raw slice of the *stringified* JSON, not valid JSON itself. For example, if the original metadata was `{ keys: "a,b,c,..." }`, the preview might end mid-value like `{ "keys": "a,b,c,d` — an invalid JSON fragment wrapped inside a valid JSON envelope.
- This is intentional (the `preview` field is for human debugging, not programmatic parsing), but it could confuse log analysts who expect valid JSON in the `preview`.
- Severity is Low because this is a debug/diagnostic field, not a security or correctness concern.
- Suggested fix: Document that `preview` may contain truncated JSON and is not meant to be parsed programmatically. Or, slice at a key boundary instead of a raw character boundary.

## Carry-forward (unchanged — existing deferred backlog)

All prior deferred items remain valid with no change in status. See aggregate for full list.
