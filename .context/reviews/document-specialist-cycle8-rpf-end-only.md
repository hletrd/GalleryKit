# Document-Specialist Review — Cycle 8 RPF (end-only)

## Doc-code coherence pass

Reviewed comment headers in checkout, webhook, sales, download routes
for staleness against the cycle 7 fixes. All headers + inline comments
reflect the cycle 5/6/7 contract correctly.

## Finding

#### C8-RPF-DOC-01 — Inline comment on the C8-RPF-CR-01 fix

- File: `apps/web/src/app/api/download/[imageId]/route.ts:151`
- Severity: **Low** | Confidence: **High**
- **What:** when applying the C8-RPF-CR-01 fix, add an inline comment
  citing the cycle 8 plan + reference to the cycle 5/6/7 contract that
  the fix extends. Mirrors the existing pattern in cycle 7 in-cycle fixes
  (e.g., webhook:67 "Cycle 7 RPF / P392-02 / C7-RPF-02: structured-object
  log shape...").

## Carry-forward

C7-RPF-D08 (JSDoc Stripe error mapping table — add cycle 6 unknown-warn
note) remains deferred per its original exit criterion.
