# Aggregate Review — Cycle 8

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29
Reviewers: code-reviewer, security-reviewer, perf-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer

**HEAD:** `eb0225e` (feat(sanitize): add sanitizeAdminString combining strip + formatting rejection)

## Source reviews (11 files)

| Reviewer | File |
|---|---|
| Code Reviewer | `.context/reviews/code-reviewer.md` |
| Security Reviewer | `.context/reviews/security-reviewer.md` |
| Perf Reviewer | `.context/reviews/perf-reviewer.md` |
| Critic | `.context/reviews/critic.md` |
| Verifier | `.context/reviews/verifier.md` |
| Test Engineer | `.context/reviews/test-engineer.md` |
| Tracer | `.context/reviews/tracer.md` |
| Architect | `.context/reviews/architect.md` |
| Debugger | `.context/reviews/debugger.md` |
| Document Specialist | `.context/reviews/document-specialist.md` |
| Designer | `.context/reviews/designer.md` |

## Deduplicated findings (cross-agent agreement noted)

| Unified ID | Source IDs | Description | Severity | Confidence | Cross-Agent |
|---|---|---|---|---|---|
| **AGG8R-01** | C8-CR-01, C8-SEC-01, C8-V-01, C8-TR-01, C8-ARCH-01, C8-DBG-01, C8-CRIT-01 | `sanitizeAdminString` uses `UNICODE_FORMAT_CHARS_RE` (which has `/g` flag) with `.test()` — stateful regex causes `rejected` flag to alternate between `true` and `false` on repeated calls. Bidi overrides are stripped before storage (no stored XSS), but the admin gets no error feedback on the `rejected: false` path, violating the C7-AGG7R-03 design intent. | MEDIUM | HIGH | 7 agents |
| **AGG8R-02** | C8-CR-02, C8-V-02, C8-TR-02, C8-CRIT-02, C8-TE-02 | `topics.ts` and `seo.ts` still use `.length` (UTF-16 code units) instead of `countCodePoints()` for MySQL varchar length comparisons. The C7-AGG7R-02 fix was only applied to `images.ts` — the follow-up scan called for in plan-158 was not completed. | LOW | MEDIUM | 5 agents |
| **AGG8R-03** | C8-TE-01 | No unit test for `sanitizeAdminString`. The stateful regex bug (AGG8R-01) would have been caught by a simple test calling the function twice on the same input. | LOW | MEDIUM | 1 agent |

## Priority remediation order (this cycle)

### Must-fix (none — no CRITICAL/HIGH)

None.

### Should-fix (MEDIUM — actionable this cycle)

1. **AGG8R-01** (7 agents): Fix the stateful regex in `sanitizeAdminString`. The simplest fix: import and use `UNICODE_FORMAT_CHARS` from `validation.ts` (which is non-`/g`) for the `.test()` check at line 136, keeping `UNICODE_FORMAT_CHARS_RE` (with `/g`) for the `.replace()` call in `stripControlChars`. Add a unit test that calls `sanitizeAdminString` twice on the same bidi-containing input and verifies both calls return `rejected: true`.

2. **AGG8R-03**: Add unit tests for `sanitizeAdminString` covering: normal string, bidi override, same input called twice, null input, C0 controls only.

### Consider-fix (LOW — batch into polish patch if time permits)

3. **AGG8R-02**: Apply `countCodePoints()` to `topics.ts:103,202` and `seo.ts:94-112` for consistency with the `images.ts` fix. Low priority — emoji-heavy topic labels and SEO fields are uncommon.

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
- AGG7R-06 — (user_filename) index purpose documentation
