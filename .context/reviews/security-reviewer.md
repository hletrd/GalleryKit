# Security reviewer — cycle 4 provenance

Review target: `01d39653`, 2026-07-18 KST. Review only.

## Inventory and validation

I inventoried the full repository and reviewed every security-relevant maintained surface: 27 route/action path files plus all 53 exported server actions, authentication/session/PAT handling, proxy/origin/IP trust, rate limits, public/admin projections, upload and backup path containment, restore SQL scanning and child processes, CSP/JSON-LD sinks, secrets/env handling, schema migrations, queues/locks, deployment ownership, and their tests. I separately traced all Cycle 3-to-HEAD changes. Those changes affect public UI disclosure/focus, image priority, browser tests, and release documentation; they add no new server trust boundary.

Executed evidence: API-auth lint, action-origin plus restore-mutation-barrier lint, public-route-rate-limit lint, full typecheck, and focused tests passed. The current diff contains no credential material; `.env.deploy` remains ignored and was not read.

## New security findings

No new security defect was confirmed at this HEAD. The nav focus handler and tag disclosure do not alter authorization or expose hidden data. The masonry change removes resource hints and does not change public field selection or asset authorization.

## Revalidated carry-forward security finding

### SEC-C4-R1 — Multi-process safety remains warn-only while coordinators are process-local

- Severity: **High**
- Confidence: **High**
- Status: **Confirmed carry-forward; not new under the documented single-instance topology**
- Regions: `apps/web/src/instrumentation.ts:18-27`; `apps/web/src/lib/single-writer-guard.ts:6-16,218-235`; `apps/web/src/lib/admin-mutation-barrier.ts`; `apps/web/src/lib/rate-limit.ts`; `apps/web/src/lib/image-queue.ts`; `apps/web/src/lib/upload-tracker-state.ts`

Persistent singleton-lock contention logs but does not terminate the second process. Restore slots, abuse budgets, upload accounting, and queue state remain process-local.

Concrete failure: a recovery or scale-out starts two web processes against one DB and mutable file store. A restore drains only one process's foreground slots, rate-limit capacity splits, and background work can duplicate or race.

Suggested fix: either acquire a required process-lifetime lease and fail closed after persistent contention, or migrate every affected coordinator to shared durable state before supporting replicas.

## Final missed-issue sweep

The final sweep rechecked every route/action export and guard ordering, auth and PAT paths, cookie/proxy defaults, public privacy projections and `_PrivacySensitiveKeys`, raw SQL and child-process arguments, filesystem realpath/open ordering, backup/restore cleanup, CSP construction, JSON-LD sanitization, and the changed client paths. No additional confirmed or likely security issue survived validation.
