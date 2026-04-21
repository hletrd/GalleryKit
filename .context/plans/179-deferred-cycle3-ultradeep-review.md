# Deferred Review Coverage — Cycle 3 Ultradeep

**Created:** 2026-04-22
**Status:** TODO
**Purpose:** Preserve cycle-3 ultradeep findings that are valid but broader than the bounded implementation lane for Plan 178.

| Finding IDs | Citation / source | Original severity / confidence | Reason for deferral | Exit criterion |
| --- | --- | --- | --- | --- |
| C3-02 | `.context/reviews/_aggregate.md`, `.context/reviews/code-reviewer.md` | HIGH / High | A true restore maintenance barrier needs coordinated queue lifecycle control plus broad write-path gating. This cycle is already addressing adjacent restore hardening (TLS, docs) but not a full maintenance-mode design. | Re-open when restore/ops hardening is taken as its own focused lane or when a shared maintenance-mode primitive is approved. |
| C3-03 | `.context/reviews/_aggregate.md`, `.context/reviews/critic.md` | MEDIUM / High | Fixing the restore ingress/body-size mismatch cleanly likely requires moving restore off the current server-action transport or adding a dedicated upload boundary. That is larger than the bounded code-fix lane in this pass. | Re-open when the restore surface is moved to a route/transport with its own body-size control, or when server-action upload policy is redesigned. |
| C3-08 | `.context/reviews/_aggregate.md`, `.context/reviews/code-reviewer.md` | MEDIUM / High | Shared-group thumbnail sizing is real, but lower-impact than the correctness/security fixes scheduled in Plan 178. | Re-open when the shared-group page or image-delivery strategy changes next. |
| C3-09 | `.context/reviews/_aggregate.md`, `.context/reviews/code-reviewer.md` | MEDIUM / High | A true streaming CSV export changes the action/consumer contract more broadly than this cycle’s bounded lane. | Re-open when DB tools are revisited or when export memory pressure becomes an observed operational issue. |
| C3-10 | `.context/reviews/_aggregate.md`, `.context/reviews/debugger.md` | MEDIUM / High | Durable cleanup/retry for post-delete filesystem failures needs a background cleanup strategy or persisted retry surface. | Re-open when delete/recovery workflow or storage architecture is revisited. |
| C3-18 | `.context/reviews/_aggregate.md`, `.context/reviews/verifier.md`, `.context/reviews/document-specialist.md`, `.context/reviews/architect.md` | LOW / High | The dormant storage abstraction is real architectural drag, but deleting or fully integrating it is a broader architecture decision than this cycle can safely finish. | Re-open when storage architecture is explicitly simplified or completed end-to-end. |
| C3-19 | `.context/reviews/_aggregate.md`, `.context/reviews/dependency-expert.md` | HIGH / High | The buffered S3 `writeStream()` path is only reachable through the unfinished storage abstraction and does not affect the current supported local-filesystem product path. | Re-open if/when storage backend integration becomes a supported feature. |
| C3-20 | `.context/reviews/_aggregate.md`, `.context/reviews/dependency-expert.md` | MEDIUM / High | Removing native-toolchain/dead dependency weight is worthwhile but non-blocking versus the higher-signal correctness/security fixes above. | Re-open when Docker/build surface is revisited next. |
| C3-21 | `.context/reviews/_aggregate.md`, `.context/reviews/document-specialist.md` | MEDIUM / High | The site-config fallback drift is primarily documentation/deploy-policy work and is lower impact than the scheduled correctness fixes. | Re-open when build/deploy policy is next updated. |
| C3-23 | `.context/reviews/_aggregate.md`, `.context/reviews/security-reviewer.md` | MEDIUM / High | The historical secret exposure is real, but remediation is operational (rotation / history governance), not a narrow source-code fix in this cycle. | Re-open when repo-history governance or credential-rotation work is scheduled. |
| R3-01, R3-02, R3-03 | `.context/reviews/_aggregate.md`, `.context/reviews/architect.md` | MEDIUM-HIGH / Medium-High | These are architectural restructuring concerns rather than bounded patch-level fixes. | Re-open when an architecture-focused cleanup/refactor lane is approved. |
| R3-04, R3-05, R3-06, R3-07, R3-08, R3-09 | `.context/reviews/_aggregate.md` | LOW-MEDIUM / Medium-High | Valid operational/product risks, but not the highest-value code fixes for this cycle. | Re-open when those specific subsystems (S3/bootstrap, deployment topology, standalone runtime verification, share-rate-limit policy, storage docs) are next revisited. |

## Notes
- Severity/confidence are preserved from the aggregate review; deferral does not downgrade risk.
- No security/correctness/data-loss finding was silently dropped; each non-scheduled finding is explicitly preserved here with a re-open condition.
