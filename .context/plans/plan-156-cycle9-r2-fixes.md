# Plan -- Cycle 9 Round 2 CSV Export Tab Stripping Fix

## Status: COMPLETE

## Findings to Address

### F1: C9R2-F01 -- `escapeCsvField` does not strip tab (0x09) [LOW] [Medium confidence]

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` line 23

**Current code (line 23):**
```typescript
value = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
```

The regex strips \x00-\x08, then skips \x09 (tab), then continues at \x0B. This means tab characters in legacy data (stored before `stripControlChars` was added) survive into CSV output. While double-quote wrapping prevents formula injection, tabs could cause column misalignment in strict CSV parsers.

**Fix:** Change the regex to `/[\x00-\x1F\x7F]/g` which strips ALL C0 control characters including tab uniformly. The subsequent `\r\n` replacement (`value.replace(/[\r\n]/g, ' ')`) becomes a no-op for those characters since they're already stripped, but keeping it is clearer and handles any edge case where the regex might be changed later.

**Implementation plan:**
1. In `escapeCsvField`, change line 23 from:
   ```typescript
   value = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
   ```
   to:
   ```typescript
   value = value.replace(/[\x00-\x1F\x7F]/g, '');
   ```
2. The \r\n replacement on line 25 (`value.replace(/[\r\n]/g, ' ')`) is now redundant since \r (\x0D) and \n (\x0A) are already stripped by the updated regex. However, keeping it is harmless (no-op) and provides defense-in-depth clarity. Remove or keep — either is acceptable. I'll remove it since it's now dead code and removing it makes the intent clearer.

**Wait** — actually, let me reconsider. The original code had a specific intent: strip most C0 controls entirely, but replace \r\n with spaces (preserving some visual separation). If I change to `/[\x00-\x1F\x7F]/g`, I strip \r\n entirely instead of replacing with spaces. For legacy data that has newlines in text fields, this would collapse multi-line values into a single line rather than preserving space-separated words.

Better approach: Keep the two-step process but include tab in the first step (strip it entirely like other C0 controls):
1. Change line 23 to: `value = value.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');` (adds \x09/tab to the strip range)
2. Keep line 25 as-is: `value = value.replace(/[\r\n]/g, ' ');` (replaces \r\n with spaces, preserving word separation)

This preserves the original intent: strip all C0 controls EXCEPT \r\n (which get space replacement), and now also strips tab (which was previously missed).

## Progress Tracking

- [x] F1: Fix `escapeCsvField` regex to include tab stripping — commit 000000065b
- [x] Run gates (eslint, next build, vitest) — all pass
- [x] Commit and push

## Deferred Items

No findings are deferred. The single LOW finding is scheduled for implementation.
