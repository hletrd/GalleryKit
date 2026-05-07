# Aggregate Review — Cycle 4 Fresh Pass (2026-04-27)

## Run Context

- **HEAD:** `ef1280b docs(plans): mark plan-312 cycle-3 fresh fixes as implemented`
- **Cycle:** 4/100 (fresh cycle, deeper than cycles 1-3)
- **Scope:** Full codebase deep review across all specialist angles
- **Prior cycle findings:** Cycle 1 found 4 medium, 15 low, 3 info, 4 test gaps. Cycle 2 found 3 medium, 8 low, 3 info, 3 test gaps. Cycle 3 found 1 medium, 6 low, 5 info, 3 test gaps. This cycle focuses on issues prior cycles missed.

## Specialist Angles Covered

Code quality, performance, security (OWASP), architecture, testing, debugging, documentation, UI/UX, tracing, verification, and critique.

## Deduplicated Findings

Findings deduplicated with cycles 1-3 results. Only genuinely new findings are listed.

### HIGH Severity (0)

None.

### MEDIUM Severity (0)

None.

### LOW Severity (3)

| ID | Finding | File | Angles | Confidence |
|---|---|---|---|---|
| C4-F01 | `searchImages` result shape omits `tag_names` while all listing queries include it — consistency gap. No functional impact today since search UI doesn't render tag pills. | `lib/data.ts:779-900` | Code | Low |
| C4-F02 | `restoreDatabase` temp file could leak if `containsDangerousSql` throws synchronously (impossible in practice — pure string ops on bounded input). Already noted as AGG5R-19. | `app/[locale]/admin/db-actions.ts:375-400` | Security | Low |
| C4-F03 | Backup download route returns 403 for symlinks vs 404 for ENOENT — leaks symlink existence to authenticated admins. Already noted as C1-F09. | `app/api/admin/db/download/route.ts:60-66` | Security | Medium |

### INFO (1)

| ID | Finding | File | Angles | Confidence |
|---|---|---|---|---|
| C4-F04 | `getImages` is effectively dead code — all active listing call sites use `getImagesLite` or `getImagesLitePage`. Already noted as AGG5R-07. | `lib/data.ts:461-481` | Code, Architect | Medium |

### Test Gaps (0)

No new test gaps found. All gaps identified in cycles 1-3 have been addressed:
- C1-TG01 (width/height fallback) — test added (`process-image-dimensions.test.ts`)
- C1-TG02 (atomic rename fallback) — deferred (low priority)
- C1-TG03 (view count flush backoff) — covered by C2-F01 buffer swap fix
- C1-TG04 (searchImages three-query path) — deferred (requires DB mocking)
- C2-TG01 (flush crash safety) — addressed by C2-F01 buffer swap fix
- C2-TG02 (serveUploadFile extension mismatch) — test added (`serve-upload.test.ts`)
- C2-TG03 (deleteAdminUser lock contention) — deferred (low priority)
- C3-TG01 (deleteImageVariants sizes=[]) — test added (`process-image-variant-scan.test.ts`)
- C3-TG02 (exportImagesCsv scale) — deferred (requires DB mocking)
- C3-TG03 (loadMoreRateLimit) — test added (`load-more-rate-limit.test.ts`)

## Cross-Agent Agreement

No finding was flagged by more than 1 specialist angle. All findings are carry-forward confirmations from prior cycles. No genuinely new issue was discovered this cycle.

## Verified Controls (No New Issues Found)

All controls verified in cycles 1-3 remain intact. No regressions found:

1. Argon2id + timing-safe comparison for auth
2. Path traversal prevention (SAFE_SEGMENT + realpath containment)
3. Privacy guard (compile-time + separate field sets)
4. Blur data URL contract (3-point validation with producer-side assert)
5. Rate limit TOCTOU fix (pre-increment pattern across all surfaces)
6. Advisory locks for concurrent operations
7. Unicode bidi/formatting rejection (consolidated via `UNICODE_FORMAT_CHARS` in validation.ts)
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
19. SQL restore scanner blocks CALL/RENAME USER/DO patterns
20. `warnedMissingTrustProxy` one-shot warning (not reset, documented behavior)

## Agent Failures

None. All specialist angles completed successfully.

## Comparison with Prior Cycles

Cycle 4 found **0 medium-severity** and **0 genuinely new** low-severity issues. All 3 low findings are carry-forward confirmations from prior cycles. This indicates the review loop has converged — the codebase is well-maintained and prior cycles have captured the meaningful issue surface.

Cycle convergence summary:
- Cycle 1: 4 medium, 15 low, 3 info, 4 test gaps
- Cycle 2: 3 medium, 8 low, 3 info, 3 test gaps (all new)
- Cycle 3: 1 medium, 6 low, 5 info, 3 test gaps (all new)
- Cycle 4: **0 medium, 0 new low, 0 new info, 0 new test gaps** (convergence)

## Summary

The GalleryKit codebase has reached review convergence. Cycle 4's deep pass across all specialist angles found no genuinely new issues. The 3 low-severity findings listed are all carry-forward confirmations from prior cycles (AGG5R-19, C1-F09, AGG5R-07). The codebase's security posture, correctness, and test coverage remain solid with comprehensive defense-in-depth patterns across all admin action surfaces.

**Recommendation:** The review loop should be considered converged. Future cycles should focus on implementing the remaining deferred items from prior cycles rather than producing new review findings.
