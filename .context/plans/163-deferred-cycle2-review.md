# Deferred Review Coverage — Cycle 2

**Created:** 2026-04-20
**Status:** TODO
**Purpose:** Ensure every cycle-2 review finding is either scheduled in an implementation plan or explicitly deferred with preserved severity/confidence and a re-open condition.

## Scheduled in active plans
| Finding IDs | Citation / source | Original severity / confidence | Scheduled in | Notes |
| --- | --- | --- | --- | --- |
| AG2-01, AG2-02, AG2-03 | `.context/reviews/_aggregate.md`, `architect.md`, `critic.md`, `verifier.md` | HIGH/HIGH, MEDIUM/HIGH, HIGH/HIGH | Plan 160 C160-01, C160-02, C160-03 | Removes unsupported control-plane knobs instead of continuing to advertise broken behavior. |
| AG2-04 | `.context/reviews/_aggregate.md`, `code-reviewer.md`, `tracer.md` | MEDIUM / High | Plan 162 C162-01 | Covers both hard-coded `_640` usage and deletion cleanup drift. |
| AG2-05 | `.context/reviews/_aggregate.md`, `code-reviewer.md`, `debugger.md` | HIGH / High | Plan 161 C161-01 | Boundary fix must preserve pre-increment TOCTOU protection. |
| AG2-06, AG2-08 | `.context/reviews/_aggregate.md`, `verifier.md`, `security-reviewer.md` | HIGH / High, MEDIUM / Medium | Plan 161 C161-03 | One backup-focused fix bundle: shared filename contract + owner-only file permissions. |
| AG2-07 | `.context/reviews/_aggregate.md`, `security-reviewer.md`, `verifier.md`, `tracer.md` | HIGH / High | Plan 161 C161-02 | Fixing the shipped deployment path rather than deferring a security finding. |
| confirmed portion of AG2-10 | `debugger.md`, `tracer.md` (`flush stalls after a full failure`) | MEDIUM / Medium | Plan 161 C161-04 | The retry-stall defect is implemented now; crash-loss risk is tracked separately below. |
| AG2-09 | `.context/reviews/_aggregate.md`, `debugger.md` | MEDIUM / Medium | Plan 162 C162-02 | Search should return unique image hits up to the requested limit. |
| AG2-12, AG2-16 | `.context/reviews/_aggregate.md`, `debugger.md`, `verifier.md` | MEDIUM / High, MEDIUM / Medium | Plan 162 C162-03 | Narrow correctness/schema fixes with direct regression coverage where possible. |
| AG2-13 | `.context/reviews/_aggregate.md`, `document-specialist.md` | MEDIUM / High | Plan 160 C160-03 | Docs/templates updated in the same cycle as the product-surface changes. |

## Deferred / follow-up items
| Finding IDs | Citation / source | Original severity / confidence | Reason for deferral | Exit criterion |
| --- | --- | --- | --- | --- |
| remainder of AG2-10 | `architect.md` risk 1, `tracer.md` risk 2 | MEDIUM / Medium | Single-process buffered view-count loss on crash/scale-down remains an architectural tradeoff after fixing the concrete retry stall. Repo context already treats this as a known single-process tradeoff (`.context/plans/done/159-deferred-cycle1-review-coverage.md`, row `A5`). | Re-open when the gallery needs crash-proof counters or multi-instance/shared-worker operation. |
| AG2-11 | `critic.md`, `tracer.md`, `verifier.md`, `test-engineer.md` | MEDIUM / Medium | The live-restore maintenance barrier is a broader operational change than this cycle’s narrow correctness/security fixes. Repo context already documents restore operational risk acceptance for the authenticated admin-only feature (`.context/plans/done/159-deferred-cycle1-review-coverage.md`, row `S4`). | Re-open when restore is expanded, background workers are distributed, or a dedicated maintenance mode is scheduled. |
| AG2-14 | `perf-reviewer.md` | MEDIUM / Medium | Performance follow-up only; does not block correctness/security gates for this cycle. | Re-open when a performance-focused cycle targets shared-page media selection, search query plans, or queue/bootstrap scaling. |
| AG2-15 | `test-engineer.md`, `verifier.md`, `critic.md` | MEDIUM / High | Large test-surface expansion (admin upload flows, DB flows, share flows, privacy/upload-tracker rework) is broader than the minimal cycle-2 fix set. Existing configured gates still run and must stay green this cycle. | Re-open in the next test-focused cycle or immediately if a touched surface lacks adequate regression coverage. |
| designer agent failure | `.context/reviews/_aggregate.md` agent failure note, `.context/reviews/ui-ux-artifacts-cycle2/` | n/a | The browser audit artifacts were captured but the designer subagent failed twice to emit a final markdown review. This is a tooling/process failure, not a code finding. | Re-open next cycle by rerunning the designer agent or manually converting the saved artifacts into a review. |

## Notes
- This file preserves the original severity/confidence reported by the review batch; deferral does **not** lower severity.
- Deferred entries are limited to findings that remain after the scheduled implementation plans above. No extra feature ideas were added here.
