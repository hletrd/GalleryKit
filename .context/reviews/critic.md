# Cycle 2 Deep Review — Critic

Date: 2026-06-24
HEAD: 95de4d11

## Summary

Cycle 1 was productive with 13 fixes. Cycle 2 review finds the codebase is stable with good test coverage. The main remaining concerns are architectural debt items and documentation/marketing truth gaps.

## New Findings (Cycle 2)

### CRT2-01 — Cycle 1 fix commits bundle unrelated changes

- Severity: Low
- Confidence: High
- Type: Process issue

Evidence: Commit a22cf041 (AGG-24/25) upgraded next, vitest, postcss AND added root overrides AND regenerated lockfile in one commit. While all related to dependency security, the lockfile regeneration is a distinct operation.

Failure scenario: Difficult to bisect if the lockfile regeneration caused issues separate from the version bumps.

Suggested fix: Future dependency upgrades should separate version changes from lockfile regeneration.

### CRT2-02 — `product-marketer-reviewer` findings overlap with existing reviewer lanes

- Severity: Low
- Confidence: High
- Type: Process issue

Evidence: The new product-marketer-reviewer (added this cycle) found issues that were already covered by document-specialist and critic (AGG-13, AGG-17, AGG-40, AGG-41, AGG-42, AGG-43). This suggests reviewer overlap rather than new coverage.

Failure scenario: Redundant review effort without new findings.

Suggested fix: Consider merging product-marketer-reviewer into document-specialist or clarifying distinct scopes.

## Verified Fixed (from Cycle 1)

- AGG-01, 02, 03: Scanner hardening — verified
- AGG-08: Restore maintenance guard — verified
- AGG-12: Rate limit refund — verified
- AGG-13, 17: README semantic search clarity — verified
- AGG-28: Token nginx throttle — verified
- AGG-33, 34: Touch targets — verified
- AGG-39: i18n retry error — verified

## Remaining Open (from Cycle 1)

- AGG-05: Admin photo detail public projection
- AGG-06: DB restore incomplete dumps
- AGG-07: Post-restore async hooks
- AGG-09: Permanent failure durability
- AGG-10: Sidecar backfill safety
- AGG-11: Semantic search CPU guard
- AGG-14: Embedding model isolation
- AGG-15: Backfill pre-activation docs
- AGG-16: Missing env examples
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
