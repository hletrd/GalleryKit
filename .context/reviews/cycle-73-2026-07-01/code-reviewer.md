# Cycle 73 Code Reviewer Review

HEAD reviewed: `96459b7a` (`fix(cycle-72): preserve restore and preview invariants`).
Scope: correctness, latent bugs, recent restore/OG/reduced-motion changes, and current plan state.

## Findings

### C73-01 - Unprocessed photo IDs can cache the default OG fallback as a success

- Severity/confidence: Low / Medium.
- File/line: `apps/web/src/app/api/og/photo/[id]/route.tsx:74`, `apps/web/src/lib/data.ts:1052`.
- Problem: `/api/og/photo/[id]` uses `getImageCached()`, which filters to `processed = true`. A real row that is still processing is indistinguishable from a missing ID, so the route can return the long success fallback cache.
- Failure scenario: a crawler hits a copied OG URL while processing is pending and caches the default card for up to a day after the photo becomes available.
- Suggested fix: distinguish existing pending rows from missing rows with a minimal processing-state lookup; keep pending-row fallbacks non-cacheable.

## Non-Findings

- Restore-maintenance durable marker fail-closed behavior is present and covered.
- Color sidecar write-guard wiring is present; broader behavior-level rollback coverage is handled by the test-engineer finding.
- C72 feed conditional coverage was not re-raised as a new source defect; it is scheduled now as a carry-forward coverage fix.
