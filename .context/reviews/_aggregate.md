# Aggregate Review — Cycle 16

Date: 2026-04-29
Reviewers: code-reviewer, security-reviewer, perf-reviewer, critic, verifier

**HEAD:** `bb28118` (feat(ui): sparkles add loading boundary for photo viewer page)

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
| **C16-AGG-01** | C16-CR-01, C16-CT-01, C16-V-01 | `image-queue.ts` comment contradicts code — says "Do NOT reset bootstrapped / scheduleBootstrapRetry" but code does both. The code IS correct (permanentlyFailedIds prevents re-enqueue of the specific failed job), but the comment is wrong and could mislead future developers into removing necessary bootstrap retry logic. | MEDIUM | MEDIUM | 3 agents |
| **C16-AGG-02** | C16-CR-02, C16-CT-02 | `instrumentation.ts` uses `console.log` instead of `console.debug` for shutdown messages. Inconsistent with rest of codebase. | LOW | LOW | 2 agents |

## Priority remediation order (this cycle)

### Must-fix (none — no CRITICAL/HIGH)

None.

### Should-fix

1. **C16-AGG-01** (3 agents): Fix the contradictory comment in `image-queue.ts:346-352`. Update the comment to accurately explain that the bootstrap retry IS correct because `permanentlyFailedIds` prevents re-enqueue of the specific failed job, and the rescan is needed to discover other pending images.

### Consider-fix (LOW — batch into polish patch if time permits)

2. **C16-AGG-02** (2 agents): Change `console.log` to `console.debug` in `instrumentation.ts:9,26`.

## Carry-forward (unchanged — existing deferred backlog)

All prior deferred items from cycles 5-46 remain deferred with no change in status. Full list preserved in `.context/plans/` deferred carry-forward documents.

Key items:
- C32-03: Insertion-order eviction in Maps (also CRI-38-01 DRY concern)
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit (partially addressed by C30-03 retry cap)
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency (partially addressed by isValidTagSlug underscore removal)
- CR-38-05: `db-actions.ts` env passthrough is overly broad
- DOC-38-01 / DOC-38-02: CLAUDE.md version mismatches
- CRI-38-01: DRY violation in Map pruning (5+ copies)
- CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU
- PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory
- ARCH-38-03: `data.ts` is a god module
- TE-38-01 through TE-38-04: Test coverage gaps
- C9R2-04: `queue_concurrency` setting has no effect on live queue
- D1-01 / D2-08 / D6-09: CSP `'unsafe-inline'` hardening
- OC1-01 / D6-08: historical example secrets in git history
- C6-V-02: `bootstrapImageProcessingQueue` cursor continuation path untested
- AGG6R-06 through AGG6R-15: Restore lock complexity, OG clamping, etc.
- C8-TE-02: `countCodePoints` test file does not test action usage patterns
- C7-TE-02 / AGG7R-08: Upload tracker hard-cap eviction path untested
- AGG7R-05: Blur placeholder quality/cap not documented
- AGG7R-06: `(user_filename)` index purpose not documented
- C7-DES-02: Admin settings unsaved-changes protection

## Convergence assessment

Cycle 16 found 2 findings (1 MEDIUM, 1 LOW), both well-established with 2-3 agent agreement. The MEDIUM finding is a comment-code contradiction that could cause future regression if taken at face value. The LOW finding is a minor logging inconsistency.

**Convergence signal**: Finding count remains at the fixed-point (1-3 items per cycle). The codebase is in a stable, well-hardened state. New findings are narrow and targeted.

## Agent failures

No agent failures this cycle. All 5 review agents completed successfully.
