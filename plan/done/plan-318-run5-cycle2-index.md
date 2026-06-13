# Run-5 Cycle 2 — Plan Index

**Date:** 2026-06-12 · **Input:** `.context/reviews/run5-cycle2/_aggregate.md` (48 merged findings from 11 agents, 73 raw; 1 disproven)

## Counts

| Document | Work items | Finding IDs covered |
|---|---|---|
| `plan-319-run5-cycle2-fixes.md` | 6 | 6 HIGH (AGG-R5C2-01..06; item 6 also implements plan-315 item 6 / TRC-R5C1-16) |
| `plan-320-run5-cycle2-medium.md` | 13 | 13 MED (AGG-R5C2-07..19, incl. doc-half of -11) |
| `plan-321-run5-cycle2-low-docs.md` | 4 units (25 rows) | 4 MED-doc + 21 LOW (AGG-R5C2-20..23, 30, 32, 33, 37..54) |
| `plan-322-run5-cycle2-deferred.md` — deferred | 4 entries (+1 split-half) | AGG-R5C2-31, 34, 35, 36 + index-half of -11 |
| `plan-322-run5-cycle2-deferred.md` — disproven | 1 | BUG-R5C2-06 (Response-wrap claim — disproved: helper returns string) |
| **Total** | | **48 / 48 merged findings accounted** ✓ |

## Implementation order (cycle 2)

1. **plan-319 in its dependency order:** constant extraction (item 2) → caption tests (5) → semantic honesty cluster (1) → batching-test rewrite (3) → checkout unknown-IP fix+test (6) → Firefox doc correction (4).
2. **plan-320** sections A (correctness/honesty) → C (test hardening) → B/D.
3. **plan-321** Unit A (CLAUDE.md truth pass, zero-regression) → B → C → D.
4. Continue plan-315/316 backlog as budget allows (this cycle pulls forward plan-315 item 6; riders recorded on items 14, 16, 19).

## Open plans carried from cycle 1

- `plan-315-run5-cycle1-medium.md` — 33 items, none implemented yet (item 6 pulled into this cycle via plan-319 item 6).
- `plan-316-run5-cycle1-low-docs.md` — 5 units open.
- `plan-317-run5-cycle1-deferred.md` — deferred registry, unchanged.

## Archived plan files (moved to `plan/done/`, never deleted)

- `plan-314-run5-cycle1-fixes.md` → `plan/done/` — verified complete this cycle by the verifier lane: 17/17 items VERIFIED at HEAD with per-item code evidence (`.context/reviews/run5-cycle2/verifier.md`), 1881 tests green, 3 security lint gates green.

**Left in place:** plan-313 (cycle-1 index; references still-open 315/316), plan-315/316/317 (open/registry), all older deferred registries and scoping docs (per plan-313's own archiving notes).
