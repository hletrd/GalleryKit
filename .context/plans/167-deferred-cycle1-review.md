# Deferred Review Coverage — Cycle 1

**Created:** 2026-04-20
**Status:** TODO
**Purpose:** Ensure every cycle-1 review finding is either scheduled in an implementation plan, closed as not reproducible, or explicitly deferred with preserved severity/confidence and a re-open condition.

## Scheduled in active plans
| Finding IDs | Citation / source | Original severity / confidence | Scheduled in | Notes |
| --- | --- | --- | --- | --- |
| AG1-01 | `.context/reviews/_aggregate.md`, `code-reviewer.md`, `verifier.md` | HIGH / High | Plan 165 C165-01 | Direct correctness fix for null-date next-photo navigation. |
| AG1-02 | `.context/reviews/_aggregate.md`, `architect.md`, `code-reviewer.md`, `debugger.md` | HIGH / High | Plan 165 C165-02 | Uses app-wide invalidation for all SEO consumers. |
| AG1-03 | `.context/reviews/_aggregate.md`, `architect.md`, `code-reviewer.md`, `critic.md` | MEDIUM / High | Plan 165 C165-03 | Unifies live branding/SEO consumers around runtime SEO settings. |
| AG1-04 | `.context/reviews/_aggregate.md`, `dependency-expert.md` | MEDIUM / High | Plan 165 C165-04 | Removes auth-wrapper import coupling and queue side effects. |
| AG1-05 | `.context/reviews/_aggregate.md`, `security-reviewer.md` | HIGH / High | Plan 166 C166-01 | Stops normalizing weak bootstrap admin credentials in docs/scripts. |
| AG1-06 | `.context/reviews/_aggregate.md`, `debugger.md`, `test-engineer.md` | MEDIUM / High | Plan 166 C166-02 | Fixes upload quota rollback and replaces the false-confidence test. |
| AG1-07 | `.context/reviews/_aggregate.md`, `debugger.md` | MEDIUM / High | Plan 165 C165-05 | Ensures large deletes invalidate public ISR surfaces too. |
| AG1-08 | `.context/reviews/_aggregate.md`, `debugger.md` | HIGH / High | Plan 166 C166-03 | Serializes admin deletion to preserve the final-admin invariant. |
| AG1-09 | `.context/reviews/_aggregate.md`, `dependency-expert.md`, `test-engineer.md` | MEDIUM / High | Plan 166 C166-04 | Makes local/admin Playwright flows deterministic and local-first. |
| AG1-10 | `.context/reviews/_aggregate.md`, `designer.md` | HIGH / High | Plan 166 C166-05 | Restores small-landscape mobile navigation affordances. |
| AG1-11 | `.context/reviews/_aggregate.md`, `researcher.md` | MEDIUM / Medium | Plan 166 C166-01 | Root docs/env/deploy guidance aligned alongside bootstrap hardening. |

## Closed / not reproducible
| Finding IDs | Citation / source | Original severity / confidence | Reason closed | Exit criterion |
| --- | --- | --- | --- | --- |
| verifier tag-management claim | `verifier.md` item 2 | MEDIUM / High | Direct verification showed `apps/web/src/app/actions/tags.ts` already uses a `LEFT JOIN image_tags` count without the earlier `images.processed = true` filter, so zero-image tags are not hidden by the current code. | Re-open only if a fresh repro or new regression lands in the tag query. |
| researcher missing-template claim | `researcher.md` item 1 (partial) | HIGH / High | Direct verification showed `apps/web/.env.local.example` is present in the repository. The remaining doc issue is the incomplete root env sample, which is scheduled in Plan 166. | Re-open only if the template file is removed or renamed without docs updates. |

## Deferred / follow-up items
| Finding IDs | Citation / source | Original severity / confidence | Reason for deferral | Exit criterion |
| --- | --- | --- | --- | --- |
| R1 | `.context/reviews/_aggregate.md`, `architect.md`, `critic.md` | HIGH / Medium | Live-restore maintenance mode requires broader operational/design work than this cycle’s targeted correctness fixes. Existing repo context already accepted restore as an authenticated admin-only destructive workflow (`.context/plans/done/159-deferred-cycle1-review-coverage.md`, row `S4`). | Re-open when restore is expanded, background workers are distributed, or a maintenance/offline restore mode is scheduled. |
| R2 | `.context/reviews/_aggregate.md`, `architect.md`, `critic.md` | MEDIUM / High | Shared-group counts are currently treated as approximate and buffered in-process; making them durable is broader architectural work than this cycle’s narrow fixes. Repo context already tracks this single-process tradeoff (`.context/plans/done/159-deferred-cycle1-review-coverage.md`, row `A5`). | Re-open when the gallery needs crash-proof counters or multi-instance/shared-worker operation. |
| R3 | `.context/reviews/_aggregate.md`, `architect.md` | MEDIUM / High | Persisting upload quotas in MySQL is broader than this cycle’s narrower rollback/correctness fix; current cycle only fixes the confirmed quota inflation defect. | Re-open when upload limiting is revisited for multi-instance or restart-resilient semantics. |
| R4 | `.context/reviews/_aggregate.md`, `architect.md` | MEDIUM / High | Consolidating `scripts/migrate.js` into a single migration authority is a schema/bootstrap project of its own. It is not a narrow regression in the current app behavior. | Re-open when a migration/bootstrap cleanup cycle is scheduled. |
| R5 | `.context/reviews/_aggregate.md`, `critic.md` | MEDIUM / Medium | Search indexing/workload design is a performance/architecture follow-up rather than a narrow correctness bug this cycle. | Re-open when a performance-focused cycle targets search/query-plan scalability. |
| R6 | `.context/reviews/_aggregate.md`, `security-reviewer.md` | CRITICAL / High | The live `.env.local` secret exposure is a local workspace/ops issue outside tracked source files. It still requires operator remediation, but it is not fixable solely through committed repository changes. | Re-open if plaintext secrets remain in active workspaces or support bundles after operational cleanup. |
| R7 | `.context/reviews/_aggregate.md`, `security-reviewer.md` | MEDIUM / Medium | Share-link TTL is currently a product-policy/privacy tradeoff rather than a confirmed mismatch with existing repo requirements. The current cycle focuses on concrete correctness defects instead of redesigning sharing semantics. | Re-open if product policy changes to require expiring shares or if new compliance/privacy requirements demand TTLs. |
| R8 | `.context/reviews/_aggregate.md`, `test-engineer.md` | MEDIUM / High | The repo still has broad test-surface gaps, but this cycle only addresses the touched upload/admin/e2e coverage gaps needed for the implemented fixes. | Re-open in the next test-focused cycle or immediately if a touched surface still lacks adequate regression coverage. |

## Notes
- This file preserves the original severity/confidence reported by the review batch; deferral does **not** lower severity.
- Deferred entries are limited to current review findings and follow the repo’s standing policy context where prior decisions already exist.
