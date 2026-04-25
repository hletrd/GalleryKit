# Critic — Cycle 7 (review-plan-fix loop, 2026-04-25)

## Lens

What's wrong, what's missing, what's brittle.

## Findings

### C7L-CRIT-01 — `images.ts:147` count comparison is brittle
- File: `apps/web/src/app/actions/images.ts:141-149`
- Severity: LOW
- Confidence: High
- Issue: `tagNames.length !== tagsString.split(',').filter(t => t.trim().length > 0).length` will fire on any tag that fails ANY of the three filters in line 142 (`length>0 && isValidTagName && isValidTagSlug`). One legitimate failure (e.g. one tag with `<`) means the entire upload returns `invalidTagNames`, even if other tags were valid.
- Failure scenario: Admin uploads with five tags, one bad → entire batch aborts with no signal which tag was bad.
- Fix: Optionally collect rejected names into an error or warning. Or simply note the design rationale next to the check (defense-in-depth strict mode).

### C7L-CRIT-02 — Mutating-action boilerplate cleaved across files
- File: Many (every mutating action)
- Severity: INFO
- Confidence: High
- Issue: Every mutating action duplicates 3-4 lines: `getTranslations`, `getRestoreMaintenanceMessage`, `isAdmin`, `requireSameOriginAdmin`. Correct under lint gates but generates 200+ lines of repeated boilerplate. A `withAdminMutation()` wrapper would cut ~40% of the boilerplate.
- Fix: Defer; refactor candidate.

### C7L-CRIT-03 — `image-queue.ts:382-459` bootstrap state-flag combinatorial complexity
- File: `apps/web/src/lib/image-queue.ts:384`
- Severity: INFO
- Confidence: Medium
- Issue: Early-return condition is `bootstrapped || shuttingDown || isRestoreMaintenanceActive() || bootstrapContinuationScheduled`. Each has its own meaning, and order matters: if `shuttingDown` becomes true mid-bootstrap, the loop short-circuits. Combination is correct but hard to reason about; one more flag would push it over the edge.
- Fix: Document the invariant; consider a single `isBootstrapEligible()` predicate.

### C7L-CRIT-04 — Upload partial-success messaging buries `failedFiles`
- File: `apps/web/src/app/actions/images.ts:410-415`
- Severity: INFO
- Confidence: Medium
- Issue: Returning `success: true` with a `failed` array can mislead UI to show a cheerful success toast even when half the batch failed.
- Status: Pre-existing UX concern. No change this cycle without a UI audit.
