# Aggregate Review — Cycle 3 Fresh Pass (2026-04-27)

## Run Context

- **HEAD:** `9958152 docs(reviews): record cycle-2 fresh review findings and plan`
- **Cycle:** 3/100 (fresh cycle, deeper than cycles 1-2)
- **Scope:** Full codebase deep review across all specialist angles
- **Prior cycle findings:** Cycle 1 found 4 medium, 15 low, 3 info, 4 test gaps. Cycle 2 found 3 medium, 8 low, 3 info, 3 test gaps. This cycle focuses on issues prior cycles missed.

## Specialist Angles Covered

Code quality, performance, security (OWASP), architecture, testing, debugging, documentation, UI/UX, tracing, verification, and critique.

## Deduplicated Findings

Findings deduplicated with cycles 1-2 results. Only genuinely new findings are listed.

### MEDIUM Severity (1)

| ID | Finding | File | Angles | Confidence |
|---|---|---|---|---|
| C3-F01 | `exportImagesCsv` materializes entire CSV in memory (up to 50K rows). Peaks at ~15-25MB heap for large galleries. Incremental builder is better than naive concatenation but still materializes full CSV string + csvLines array. Streaming/chunked response would be more memory-efficient. | `app/[locale]/admin/db-actions.ts:51-99` | Code, Perf, Critic | Medium |

### LOW Severity (6)

| ID | Finding | File | Angles | Confidence |
|---|---|---|---|---|
| C3-F02 | `deleteImageVariants` with `sizes=[]` triggers full directory scan via `opendir` on every image deletion. For directories with 10K+ files, this is expensive I/O. Scan only needed to catch variants from prior configs — after first cleanup, subsequent scans are wasted. | `lib/process-image.ts:186-203` | Code, Perf | Medium |
| C3-F03 | `getImage` next-image query uses `sql\`FALSE\`` literal for undated photos. Correct (NULLs sort last in DESC), but comment is not prominent enough. A future contributor could replace with incorrect NULL-safe comparison, silently breaking next-image navigation for undated photos. | `lib/data.ts:574-600` | Code | Low |
| C3-F04 | Rate-limit eviction boilerplate duplicated across 7 independent Maps with near-identical FIFO eviction logic (~200 lines of copy-paste). Shared `BoundedMap` abstraction would reduce drift risk and maintenance burden. | `lib/rate-limit.ts`, `lib/auth-rate-limit.ts`, `app/actions/public.ts`, `app/actions/sharing.ts`, `app/actions/admin-users.ts` | Architect, Critic | Medium |
| C3-F05 | `getImages` and `getImagesLite` have near-identical query shapes (same JOIN, GROUP BY, ORDER BY, select fields) with only limit calculation differing. Shared base query builder would prevent drift. | `lib/data.ts:375-505` | Architect | Medium |
| C3-F06 | `UNICODE_FORMAT_CHARS` regex literal is duplicated between `validation.ts` and `csv-escape.ts`. Both should import from a single source, and the regex should have a U+XXXX notation comment for editor-invariant readability. | `lib/validation.ts:35`, `lib/csv-escape.ts:43` | Critic, Code | High |
| C3-F07 | `nav-client.tsx` `NEXT_LOCALE` cookie set via `document.cookie` is visible to any JS in the page. Acceptable for a locale preference (not security-sensitive), but defense-in-depth concern if XSS existed. | `components/nav-client.tsx:66` | Security | Low |

### INFO (5)

| ID | Finding | File | Angles | Confidence |
|---|---|---|---|---|
| C3-F08 | `restoreDatabase` `--one-database` flag alone would not provide isolation if SQL scanner were bypassed. Defense-in-depth chain (header validation + SQL scanning + `--one-database`) is sufficient for trusted-admin threat model. | `app/[locale]/admin/db-actions.ts:412-414` | Security | Low |
| C3-F09 | `instrumentation.ts` `process.exit(0)` after partial view-count flush may lose re-buffered entries. Documented as best-effort. | `instrumentation.ts:9-36` | Debug | Medium |
| C3-F10 | `createGroupShareLink` `affectedRows` check is defense-in-depth that can never trigger because uniqueIndex would cause ER_DUP_ENTRY first. Code clarity concern, not a bug. | `app/actions/sharing.ts:261-271` | Code | Info |
| C3-F11 | `escapeCsvField` C0 control character class lists disjoint ranges without comment explaining excluded codepoints (LF=0x0A, CR=0x0D). | `lib/csv-escape.ts:34` | Code | Medium |
| C3-F12 | Advisory-lock naming uses `gallerykit_` prefix but no instance identifier — two instances on same MySQL server share lock namespace (documented in CLAUDE.md). | Multiple | Architect | Info |

### Test Gaps (3)

| ID | Finding | File | Confidence |
|---|---|---|---|
| C3-TG01 | No test for `deleteImageVariants` with `sizes=[]` (directory scan fallback path). | `lib/process-image.ts:186-203` | High |
| C3-TG02 | No test for `exportImagesCsv` at moderate scale. Mock-based test verifying correct CSV output for small dataset would guard the escapeCsvField integration. | `app/[locale]/admin/db-actions.ts:51-99` | Medium |
| C3-TG03 | No test for `loadMoreRateLimit` in `public.ts`. `searchRateLimit` and `ogRateLimit` have dedicated tests but load-more rate limit (120 req/min) has no coverage. | `app/actions/public.ts:35-74` | Medium |

## Cross-Agent Agreement

- C3-F01 (exportImagesCsv memory) was flagged from 3 angles (Code, Perf, Critic)
- C3-F02 (deleteImageVariants directory scan) was flagged from 2 angles (Code, Perf)
- C3-F04 (rate-limit boilerplate) was flagged from 2 angles (Architect, Critic)
- C3-F06 (UNICODE_FORMAT_CHARS duplication) was flagged from 2 angles (Critic, Code)
- All other findings are unique to a single perspective

## Verified Controls (No New Issues Found)

All controls verified in cycles 1-2 remain intact. No regressions found:
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
16. Redundant revalidation removal (C2-F06 fix)
17. CSP GA domain conditional on `NEXT_PUBLIC_GA_ID`
18. Dimension rejection for undetermined images (C1-F01 fix)

## Comparison with Prior Cycles

Cycle 3 found 1 medium-severity, 6 low-severity, 5 info, and 3 test-gap findings that prior cycles did not identify. The most notable new findings are:

1. **C3-F01** (exportImagesCsv memory) — medium severity, potential OOM on large galleries
2. **C3-F02** (deleteImageVariants directory scan) — low severity, unnecessary I/O on every delete
3. **C3-F04** (rate-limit boilerplate) — low severity, maintenance risk from duplicated eviction code

All prior cycle fixes (C2-F01 view count buffer, C2-F06 redundant revalidation, C1-F01 dimension fallback) are confirmed properly implemented.

## Agent Failures

None. All specialist angles completed successfully.

## Summary

The GalleryKit codebase continues to demonstrate strong engineering. This cycle 3 review found 1 new medium-severity issue and 6 low-severity issues, none of which represent immediate security vulnerabilities or data-loss risks. The most actionable finding is the `exportImagesCsv` memory profile (C3-F01), which could be addressed with a streaming response. The codebase's security posture remains solid with comprehensive defense-in-depth patterns across all admin action surfaces.
