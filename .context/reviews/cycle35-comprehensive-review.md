# Cycle 35 Comprehensive Code Review (2026-04-19)

**Reviewer:** General-purpose deep review agent
**Scope:** Full codebase, all server actions, data layer, middleware, API routes, components

## Findings

### C35-01: Missing `return` before `notFound()` in 3 locations [LOW, High Confidence]

C34-02 fixed one instance of `notFound()` called without `return` in `s/[key]/page.tsx:63`, but 3 more identical inconsistencies remain:

1. **`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:65`** — `notFound();` without `return`
2. **`apps/web/src/app/[locale]/(public)/[topic]/page.tsx:80`** — `notFound();` without `return`
3. **`apps/web/src/app/[locale]/layout.tsx:66`** — `notFound();` without `return`

Every other `notFound()` call in the codebase uses `return notFound()`. While `notFound()` throws a NEXT_NOT_FOUND error and never returns, omitting `return` is misleading — it implies execution continues past the call, which it does not. TypeScript also cannot infer the correct control flow narrowing without `return`.

**Fix:** Add `return` before each `notFound()` call.

---

### C35-02: DB pool `connectionLimit` (10) is higher than CLAUDE.md documents (8) [LOW, Medium Confidence]

**File:** `apps/web/src/db/index.ts:18`

CLAUDE.md states: "Connection pool: 8 connections, queue limit 20, keepalive enabled."

The actual code uses `connectionLimit: 10`, not 8. While this is a doc-vs-code mismatch rather than a bug, the CLAUDE.md is used as authoritative guidance for AI agents working on this repo. Misleading documentation can cause incorrect assumptions about resource usage.

**Fix:** Update CLAUDE.md to match the actual `connectionLimit: 10`, or change the code to 8 if 8 was the intended value.

---

### C35-03: `escapeCsvField` does not escape double-quote characters before stripping CR/LF [LOW, Medium Confidence]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:20-29`

The `escapeCsvField` function first strips `\r\n` from the value, then checks for formula injection characters, then wraps in double quotes and doubles embedded double quotes. The order is correct functionally, but there is a subtle issue: the formula injection check `value.match(/^[=+\-@\t]/)` runs AFTER the `\r\n` stripping but BEFORE the double-quote doubling. If a value starts with `"` (double-quote) and also contains a formula injection character after embedded newlines, the formula character could shift to the start position after the CR/LF are replaced with spaces.

Example: A value like `"\r=1+1"` after CR stripping becomes `" =1+1"` — the formula check sees it starts with `"` not `=`, so it passes. This is actually fine because `"` is not in the formula injection prefix set and the value will be wrapped in double quotes anyway. However, a value like `\r=1+1` (without leading quote) after stripping becomes ` =1+1` — again the formula check sees it starts with space, not `=`.

On closer inspection, this is actually safe because the `\r\n` replacement with space prevents the value from starting with a formula character after stripping. The real CSV injection risk (formula injection via the first character) is properly handled. **Downgrading to INFORMATIONAL** — no fix needed.

---

### C35-04: `generateMetadata` in photo page does not validate `id` before `parseInt` [MEDIUM, High Confidence]

**File:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:21-26`

In `generateMetadata()`, the `id` parameter is passed directly to `parseInt(id, 10)` on line 25 without any validation. If `id` is not a numeric string (e.g., `abc`), `parseInt` returns `NaN`, and `getImageCached(NaN)` is called. While `getImage` in `data.ts` checks `!Number.isInteger(id) || id <= 0` and returns `null`, this still results in an unnecessary DB query with `NaN` as the ID parameter.

The `default` export function (line 88+) properly validates `id` with `/^\d+$/.test(id)` before calling `parseInt`. The `generateMetadata` function should follow the same pattern for consistency and to avoid the wasted DB round-trip.

**Failure scenario:** A request to `/p/abc` triggers `getImageCached(NaN)`, which queries `WHERE id = NaN`. MySQL treats this as `WHERE id = 0` (since CAST(NaN AS SIGNED) = 0 in MySQL), so it returns no results. The query is wasted but harmless. However, it's an inconsistency that could mask future issues.

**Fix:** Add the same `/^\d+$/.test(id)` validation in `generateMetadata` before calling `parseInt`, and return the not-found metadata early if validation fails.

---

## No-Critical / No-High Findings

No critical or high severity issues found. The codebase is in strong shape after 34 prior cycles of fixes. All previously identified security, correctness, and data-loss issues have been addressed.

## Deferred Carry-Forward

All previously deferred items from cycles 5-33 remain deferred with no change in status:

- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04: `createGroupShareLink` insertId validation inside transaction
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
