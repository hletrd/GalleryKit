# Critic Review — Cycle 4 (review-plan-fix loop, 2026-04-25)

## Cross-cutting concerns

### C4L-CRIT-01 — Unicode-formatting hardening posture is partial

- **Files:** `apps/web/src/lib/validation.ts:37,43-46`
- **Issue:** Cycle 3 closed the `isValidTopicAlias` gap and CSV export already strips the same characters, but `isValidTagName` (also user-controlled, also rendered) was not extended in the same pass. This makes the hardening posture inconsistent across user-controlled string surfaces. Adding parity is the second of three known places.
- **Severity / confidence:** LOW / Medium.
- **Recommendation:** Schedule the parity fix this cycle and co-locate the regex in a shared module to make further parity expansions one-line.

## Cycle hygiene

- `.context/plans/` continues to grow; the deferred-tracker pattern is healthy. No new bookkeeping issues.
- Aggregate files preserved across cycles (pattern: `_aggregate-cycleN-*.md`) — provenance trail intact.
- Recent commits are fine-grained, GPG-signed, gitmoji-tagged.

## Confidence summary

- C4L-CRIT-01 — Medium
