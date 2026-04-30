# Aggregate Review — Cycle 9

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29
Reviewers: code-reviewer, security-reviewer, perf-reviewer, critic, verifier

**HEAD:** `89f8795` (fix(topics,seo): use countCodePoints for varchar length checks)

## Source reviews (5 files)

| Reviewer | File |
|---|---|
| Code Reviewer | `.context/reviews/code-reviewer.md` |
| Security Reviewer | `.context/reviews/security-reviewer.md` |
| Perf Reviewer | `.context/reviews/perf-reviewer.md` |
| Critic | `.context/reviews/critic.md` |
| Verifier | `.context/reviews/verifier.md` |

## Deduplicated findings (cross-agent agreement noted)

| Unified ID | Source IDs | Description | Severity | Confidence | Cross-Agent |
|---|---|---|---|---|---|
| **AGG9R-01** | C9-CR-01, C9-SEC-02, C9-CRIT-01, C9-V-02 | Remaining `.length` usages for DoS-prevention bounds in `images.ts:139` and `public.ts:116` — inconsistent with the `countCodePoints()` adoption pattern from AGG7R-02/AGG8R-02. These are DoS bounds, not MySQL varchar boundaries, so the functional impact is nil (slightly more restrictive, not less). | LOW | LOW | 4 agents |
| **AGG9R-02** | C9-SEC-01, C9-CRIT-02, C9-V-01 | `withAdminAuth` wrapper in `api-auth.ts` lacks `hasTrustedSameOrigin` origin verification. Every mutating server action uses `requireSameOriginAdmin()`, but API routes using `withAdminAuth` get no origin check. The only admin API route (`/api/admin/db/download`) adds its own explicit check, mitigating the immediate risk. However, a future admin API route added with only `withAdminAuth` would lack origin verification. | LOW | MEDIUM | 3 agents |
| **AGG9R-03** | C9-CR-02 | `createAdminUser` username length checks use `.length` instead of `countCodePoints()`, but the regex `/^[a-zA-Z0-9_-]+$/` already restricts to ASCII where `.length === countCodePoints()`. No functional impact — documentation only. | LOW | LOW | 1 agent |
| **AGG9R-04** | C9-PERF-01 | `searchImages` in `data.ts` could cascade tag→alias queries instead of always running both in parallel when the main query underfills. Minor optimization at personal-gallery scale. | LOW | LOW | 1 agent |

## Priority remediation order (this cycle)

### Must-fix (none — no CRITICAL/HIGH)

None.

### Should-fix (none — no MEDIUM with HIGH confidence)

None.

### Consider-fix (LOW — batch into polish patch if time permits)

1. **AGG9R-01** (4 agents): Switch `tagsString.length > 1000` and `sanitizedQuery.length > 200` to `countCodePoints()` for consistency, or add comments documenting intentional `.length` use.

2. **AGG9R-02** (3 agents): Add `hasTrustedSameOrigin` check to `withAdminAuth` wrapper so future admin API routes get automatic origin verification. Low risk since the only current route already has its own check.

3. **AGG9R-03** (1 agent): Add a comment in `admin-users.ts` noting that `.length` is safe for username validation because the regex restricts to ASCII. No code change needed.

4. **AGG9R-04** (1 agent): Consider cascading tag→alias query in `searchImages` for marginal performance improvement. Low priority — only matters at higher scale.

### Defer (LOW — documented for future)

None new this cycle.

## Carry-forward (unchanged — existing deferred backlog)

All prior deferred items remain valid with no change in status:

- AGG4R2-04 through AGG4R2-12 — named error classes, requireCleanInput, batched view-count, JsonLdScript, etc.
- D1-01 / D2-08 / D6-09 — CSP hardening
- D2-01 through D2-11 — various LOW items
- D6-01 through D6-14 — cursor/keyset scroll, scoped navigation, visual regression, etc.
- OC1-01 / D6-08 — historical example secrets
- Font subsetting, Docker node_modules, various PERF/UX items
- C6R2-F01 through C6R2-F14 — storage backend integration, settings tests, etc.
- C15-02 — share-link ownership validation (by design)
- AGG6R-02 — searchImages over-fetch (cosmetic at scale)
- AGG6R-03 — BigInt coercion is safe
- AGG6R-06 — Restore lock complexity
- AGG6R-07 — OG tag clamping (cosmetic)
- AGG6R-08 — data.ts extraction (larger refactor)
- AGG6R-09 — Preamble repetition (intentional)
- AGG6R-10 — Log noise from orphaned tmp cleanup (appropriate)
- AGG6R-13 — Test gaps for upload-tracker hard-cap and queue cursor continuation
- AGG6R-14 — CLAUDE.md size values verified correct
- AGG7R-04 — `as const` inconsistency (cosmetic)
- AGG7R-07 — Sequential tag processing (acceptable at scale)
- AGG7R-08 — Upload tracker hard-cap test (carry-forward from C6)
- AGG7R-05 — Blur placeholder quality/cap documentation
- AGG7R-06 — `(user_filename)` index purpose documentation

## Convergence assessment

Cycle 9 found only LOW-severity findings. No CRITICAL or HIGH findings, and no MEDIUM findings with HIGH confidence. The codebase is in a stable, well-hardened state with all prior cycle fixes verified. The remaining issues are consistency improvements and defensive documentation.

**Convergence signal**: Finding count and severity have been monotonically decreasing since cycle 6. The review is approaching a fixed point where only cosmetic consistency issues remain.
