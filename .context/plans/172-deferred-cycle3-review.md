# Deferred Review Coverage — Cycle 3

**Created:** 2026-04-20
**Status:** TODO
**Purpose:** Preserve cycle-3 review findings that remain broader architectural follow-ups rather than narrow repository fixes in this cycle.

## Scheduled in active plans
| Finding IDs | Citation / source | Original severity / confidence | Scheduled in | Notes |
| --- | --- | --- | --- | --- |
| C3-01, C3-02, C3-03, C3-04 | `.context/reviews/_aggregate.md` | MEDIUM/HIGH, MEDIUM/HIGH, LOW/HIGH, MEDIUM/HIGH | Plan 171 C171-01 through C171-04 | Cycle-3 confirmed defects slated for direct implementation this cycle. |

## Deferred / follow-up items
| Finding IDs | Citation / source | Original severity / confidence | Reason for deferral | Exit criterion |
| --- | --- | --- | --- | --- |
| R3-01 | `.context/reviews/_aggregate.md`, `code-reviewer.md` | HIGH / Medium | Establishing a true restore maintenance boundary requires broader queue/app-lifecycle design than the narrow cycle-3 code-fix lane. Existing repo context already tracks the same restore-operability concern as a carry-forward risk in `.context/plans/167-deferred-cycle1-review.md` (row `R1`). | Re-open when restore behavior is expanded, a maintenance mode is scheduled, or queue-drain orchestration is designed as its own plan. |

## Notes
- Rejected/non-actionable review claims are documented in `.context/reviews/_aggregate.md` and are intentionally not duplicated here as deferred work.
- This file preserves original severity/confidence; deferral does not downgrade the risk.
