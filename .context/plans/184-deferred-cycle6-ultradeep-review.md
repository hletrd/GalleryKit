# Deferred Review Coverage — Cycle 6 Ultradeep

**Created:** 2026-04-22
**Status:** TODO
**Purpose:** Preserve cycle-6 findings and risks that remain valid but broader than the bounded implementation lane for Plan 183.

| Finding IDs | Citation / source | Original severity / confidence | Reason for deferral | Exit criterion |
| --- | --- | --- | --- | --- |
| R5-01 | `.context/reviews/_aggregate.md`, prior `.context/reviews/architect.md`, Plan 182 | MEDIUM / Medium | Multi-instance-safe restore maintenance needs a shared/durable authority, but the current deployment is still single-instance and this cycle is focused on process-local correctness. | Re-open if deployment becomes multi-instance or restore orchestration moves outside the current app process. |
| R5-02 | `.context/reviews/_aggregate.md`, prior `.context/reviews/security-reviewer.md`, Plan 182 | MEDIUM / High | Historical secret exposure is operational remediation (rotation/history governance), not a bounded source-code patch. | Re-open when credential rotation and repo-history governance work is scheduled. |
| C6-05 | `.context/reviews/_aggregate.md`, `.context/reviews/document-specialist.md` | LOW / Medium | Wording cleanup for restore transport-vs-application limits is useful but secondary to fixing the actual restore stream boundary and brand drift first. | Re-open when adjacent restore/docs work is next touched. |

## Notes
- Severity/confidence are preserved from the aggregate review; deferral does not downgrade risk.
- No confirmed finding from the aggregate is silently dropped.
