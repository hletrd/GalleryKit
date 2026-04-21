# Deferred Review Coverage — Cycle 5 Ultradeep

**Created:** 2026-04-22  
**Status:** TODO  
**Purpose:** Preserve cycle-5 findings and risks that remain valid but are broader than the bounded implementation lane for Plan 181.

| Finding IDs | Citation / source | Original severity / confidence | Reason for deferral | Exit criterion |
| --- | --- | --- | --- | --- |
| C5-02 (transport remainder) | `.context/reviews/_aggregate.md`, `.context/reviews/dependency-expert.md` | MEDIUM / High | Sharing the 250 MB limit with the UI is bounded; fully separating restore from the global 2 GiB server-action ingress budget likely requires a dedicated route/proxy boundary and is larger than this cycle’s safe patch lane. | Re-open when restore transport/ingress is redesigned or when route-specific body-size enforcement is introduced. |
| C5-04 | `.context/reviews/_aggregate.md`, `.context/reviews/code-reviewer.md`, `.context/reviews/designer.md` | LOW / Medium | The global error shell is client-only and intentionally minimal; aligning it with live SEO branding needs a carefully chosen fallback strategy rather than a hurried patch inside this cycle’s restore-focused lane. | Re-open when branding/runtime-shell consistency is explicitly prioritized. |
| R5-01 | `.context/reviews/_aggregate.md`, `.context/reviews/architect.md` | MEDIUM / Medium | Multi-instance-safe restore maintenance needs a shared/durable authority, but today’s deployment remains single-instance and this cycle is focused on tightening the current process-local barrier first. | Re-open if deployment becomes multi-instance or if restore orchestration moves out of the current app process. |
| R5-02 | `.context/reviews/_aggregate.md`, `.context/reviews/security-reviewer.md` | MEDIUM / High | Historical secret exposure is operational remediation (rotation / history governance / mirror cleanup), not a bounded source-code patch. | Re-open when credential rotation and repo-history governance work is scheduled. |

## Notes
- Severity/confidence are preserved from the aggregate review; deferral does not downgrade risk.
- No confirmed finding from the aggregate is silently dropped.
