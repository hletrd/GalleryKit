# Code Reviewer — Cycle 3 Deep Review (2026-04-27)

**HEAD:** `9958152 docs(reviews): record cycle-2 fresh review findings and plan`
**Scope:** Full codebase — 222 TypeScript/TSX source files
**Prior cycles:** Cycle 1 (4 medium, 15 low, 3 info, 4 test gaps), Cycle 2 (3 medium, 8 low, 3 info, 3 test gaps). This cycle focuses on issues prior cycles missed.

## Methodology

Read every source file in `apps/web/src/` systematically: all server actions, lib modules, API routes, middleware, components, schema, and tests. Analyzed individual file quality and cross-file interactions. Verified all prior-cycle findings for resolution status.

## Findings (New — Not in Prior Cycles)

### MEDIUM Severity (1)

| ID | Finding | File | Confidence |
|---|---|---|---|
| C3-F01 | `exportImagesCsv` materializes the entire CSV in memory before returning. The function caps results at 50K rows and builds a `csvLines[]` array, then joins into a single string. For a gallery at the 50K cap with verbose tag lists (GROUP_CONCAT can produce long strings), this can consume ~10-20MB of heap. The incremental approach (building `csvLines` then joining) is better than string concatenation but still materializes the full CSV string plus the DB results array simultaneously. The code releases `results` before joining (`results = [] as typeof results`) which helps, but the csvLines array + final joined string still coexist briefly. A streaming response or chunked building would be more memory-efficient for large galleries. | `app/[locale]/admin/db-actions.ts:51-99` | Medium |

### LOW Severity (3)

| ID | Finding | File | Confidence |
|---|---|---|---|
| C3-F02 | `deleteImageVariants` called with `sizes=[]` in `deleteImage` and `deleteImages` triggers a full directory scan via `opendir` + iteration on every delete. For directories with thousands of files (a gallery with 10K+ images generates 10K+ files per format dir), this readdir scan is expensive I/O. The `sizes=[]` path is only needed to catch leftover variants from prior configs, but it runs unconditionally. A per-directory flag or timestamp tracking "last config-era cleanup" would avoid rescanning on every subsequent delete. | `lib/process-image.ts:186-203` | Medium |
| C3-F03 | `getImage` in `data.ts` prev/next query logic uses `sql\`FALSE\`` literal for undated photos in the next-image query. This is correct (NULLs sort last in DESC, so there are no "older" undated images by capture_date), but the comment explaining the FALSE literal is not prominent enough for a future contributor who doesn't understand the NULLs-sort-last-in-DESC invariant. Replacing `sql\`FALSE\`` with an incorrect NULL-safe comparison would silently break next-image navigation for undated photos. | `lib/data.ts:574-600` | Low |
| C3-F04 | `buildContentSecurityPolicy` adds `style-src 'self' 'unsafe-inline'` in production. While `'unsafe-inline'` in `style-src` is standard for Tailwind CSS apps (runtime style injection), it reduces the CSP's ability to block style-based exfiltration attacks. This is a known trade-off. | `lib/content-security-policy.ts:74` | Info |

### INFO (2)

| ID | Finding | File | Confidence |
|---|---|---|---|
| C3-F05 | `createGroupShareLink` uses `Number(linkResult.affectedRows ?? 0) !== uniqueImageIds.length` to verify all link inserts. This check can never trigger under normal operation because the uniqueIndex on `(groupId, imageId)` would cause an ER_DUP_ENTRY before the affectedRows check could differ. The check adds defense-in-depth but no practical benefit — it's a code clarity concern, not a bug. | `app/actions/sharing.ts:261-271` | Info |
| C3-F06 | `escapeCsvField` strips C0 controls but intentionally preserves LF (0x0A) and CR (0x0D) for the subsequent collapse pass. The character class `[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F]` is hard to audit because it lists disjoint ranges without a comment explaining which codepoints are excluded and why. | `lib/csv-escape.ts:34` | Medium |

### Test Gaps (2)

| ID | Finding | File | Confidence |
|---|---|---|---|
| C3-TG01 | No test for `deleteImageVariants` with `sizes=[]` (directory scan fallback path). A regression in the scan logic could silently fail to delete leftover variants from prior configs. | `lib/process-image.ts:186-203` | Medium |
| C3-TG02 | No test for `exportImagesCsv` at moderate scale (e.g., 1000 rows). While the function has clear logic, an integration test verifying it completes without errors would guard against regressions in the CSV builder. | `app/[locale]/admin/db-actions.ts:51-99` | Low |

## Prior Cycle Findings — Resolution Status

| Prior ID | Status | Notes |
|---|---|---|
| C1-CR-03 (width fallback to 2048) | **Fixed** | Code now throws an error instead of defaulting to 2048 (`data.ts:278-280`) |
| C1-CR-04 (GA domains unconditional) | **Fixed** | CSP now conditional on `NEXT_PUBLIC_GA_ID` |
| C1-CR-01 (indentation) | **Fixed** | Try/finally indentation corrected |
| C2-F01 (view count buffer loss) | **Fixed** | Atomic Map swap pattern implemented |
| C2-F06 (redundant revalidation) | **Fixed** | Redundant `revalidateLocalizedPaths` calls removed |
| C1-CR-02 (deleteImageVariants sizes=[] intent) | **Open** | Still uses `sizes=[]` — documenting the intent would help (C3-F02 above) |
| C2-F02 (locale cookie SameSite) | **Open** | Cookie now has explicit `SameSite=Lax` — resolved |

## Verified Controls (No New Issues)

All controls from prior cycles remain intact. No regressions found in:
1. Argon2id + timing-safe comparison for auth
2. Path traversal prevention (SAFE_SEGMENT + realpath containment)
3. Privacy guard (compile-time + separate field sets)
4. Blur data URL contract (3-point validation with producer-side assert)
5. Rate limit TOCTOU fix (pre-increment pattern)
6. Advisory locks for concurrent operations
7. Unicode bidi/formatting rejection
8. CSV formula injection prevention
9. Touch-target audit fixture
10. Reduced-motion support
11. `safeJsonLd()` properly sanitizes JSON-LD output
12. `serveUploadFile` has extension-to-directory mismatch protection
13. `requireSameOriginAdmin()` on all mutating server actions
14. Upload tracker TOCTOU closed with pre-claim pattern
15. View count buffer swap (C2-F01 fix)
