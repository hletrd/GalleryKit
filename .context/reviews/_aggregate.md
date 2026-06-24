# Aggregate Review — review-plan-fix cycle 2

Date: 2026-06-24
HEAD reviewed: `95de4d11`
Review lanes completed: code-reviewer, security-reviewer, perf-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer, product-marketer-reviewer.

## Summary

Cycle 1 fixed 13 findings (AGG-01, 02, 03, 08, 12, 13, 17, 24, 25, 28, 33, 34, 39). Cycle 2 review confirms all fixes are correctly implemented and finds 8 new findings across the review lanes. After deduplication, 6 distinct new findings remain. The remaining 30 open findings from cycle 1 are verified still present.

## New Findings (Cycle 2)

### CR2-01 / TE2-02 — Semantic search test comment drift after AGG-12 fix
- Severity: Medium
- Confidence: High
- Agreement: code-reviewer, test-engineer
- Source: code-reviewer.md, test-engineer.md
- Evidence: `apps/web/src/__tests__/semantic-search-route.test.ts` comments describe old rollback behavior after commit 4264d1d4 removed it.
- Suggested fix: Update test comments to reflect the new no-rollback-after-expensive-work contract.

### CR2-02 / TE2-01 — Action-origin scanner missing star re-export fixture
- Severity: Low
- Confidence: Medium
- Agreement: code-reviewer, test-engineer
- Source: code-reviewer.md, test-engineer.md
- Evidence: Scanner rejects star re-exports (AGG-02 fix) but no test fixture verifies this.
- Suggested fix: Add negative fixture for `export * from` in a mutating action module.

### SEC2-01 — Scanner uses TypeScript import without version pinning
- Severity: Low
- Confidence: Medium
- Source: security-reviewer.md
- Evidence: `apps/web/scripts/check-action-origin.ts` imports `typescript` directly; API changes could break scanner silently.
- Suggested fix: Pin scanner TypeScript version or add self-test validating known violations.

### CRT2-01 — Cycle 1 fix commit bundles unrelated changes
- Severity: Low
- Confidence: High
- Source: critic.md
- Evidence: Commit a22cf041 combined version bumps, overrides, and lockfile regeneration.
- Suggested fix: Separate version changes from lockfile regeneration in future.

### CRT2-02 — Product-marketer-reviewer overlap with existing lanes
- Severity: Low
- Confidence: High
- Source: critic.md
- Evidence: New reviewer found issues already covered by document-specialist and critic.
- Suggested fix: Clarify distinct scopes or merge into document-specialist.

### DOC2-01 — README backfill command missing `--force`
- Severity: Low
- Confidence: High
- Source: document-specialist.md
- Evidence: `apps/web/README.md` documents `--production` backfill but script requires `--force` before activation.
- Suggested fix: Add `--force` to documented command or clarify activation sequence.

### DOC2-02 — `.env.local.example` still missing semantic search env vars
- Severity: Low
- Confidence: High
- Source: document-specialist.md
- Evidence: Despite AGG-16 from cycle 1, `SEMANTIC_SEARCH_ALLOW_PRODUCTION` and `CLIP_MODELS_ROOT` are still absent.
- Suggested fix: Add commented examples with production-only warnings.

### DBG2-01 — Scanner throws unclear error on wrong working directory
- Severity: Low
- Confidence: High
- Source: debugger.md
- Evidence: `check-action-origin.ts` throws if root directory missing but message doesn't indicate expected working directory.
- Suggested fix: Add clearer error message.

## Verified Fixed (from Cycle 1)

All 13 cycle 1 fixes verified correctly implemented at HEAD 95de4d11:
- AGG-01: Action origin scanner hardened
- AGG-02: Star re-exports rejected
- AGG-03: Pre-increment required before mutation
- AGG-08: retryFailedImage restore maintenance guard
- AGG-12: No rate limit refund after expensive work
- AGG-13: README semantic search operator-enabled
- AGG-17: README disabled-by-default note
- AGG-24: Production dependency upgrades
- AGG-25: Dev dependency upgrades
- AGG-28: Token nginx throttle
- AGG-33: Tag chip touch target
- AGG-34: Footer admin link touch target
- AGG-39: retryFailedImage i18n

## Remaining Open (from Cycle 1, verified still present)

- AGG-04: CI omits public-route-rate-limit lint
- AGG-05: Admin photo detail public projection
- AGG-06: DB restore incomplete dumps
- AGG-07: Post-restore async hooks
- AGG-09: Permanent failure durability
- AGG-10: Sidecar backfill safety
- AGG-11: Semantic search CPU guard
- AGG-14: Embedding model isolation
- AGG-15: Backfill pre-activation docs
- AGG-16: Missing env examples (partially fixed)
- AGG-18: Alt-text stub as AI
- AGG-19: Similar photos stale results
- AGG-20: Partial numeric ids — FIXED
- AGG-21: View retention indexes
- AGG-22: Rate limit indexes
- AGG-23: Docker resource limits
- AGG-26: CSP inline styles
- AGG-27: Search LIKE SQL mode
- AGG-29: Token nav missing
- AGG-30: Legacy symlink cleanup
- AGG-31: Storage abstraction risk
- AGG-32: Search modal clipping
- AGG-35: Touch-target audit gaps
- AGG-36: Admin table overflow
- AGG-37: Modal inert missing
- AGG-38: Theme hydration mismatch
- AGG-40: HDR claims misread
- AGG-41: Performance claim unproven
- AGG-42: Demo config leaks
- AGG-43: GitHub trust signal

## Agent Failures

None. All 12 review lanes completed successfully.

## Final Sweep

All per-agent review files were written and verified. The aggregate preserves provenance and elevates duplicates by agreement. Implementation planning must either schedule each aggregate finding or explicitly defer it under `.context/plans/`.
