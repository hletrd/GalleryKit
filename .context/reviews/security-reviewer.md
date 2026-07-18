# Security Review — Cycle 2

Date: 2026-07-18 KST
Review HEAD: `ba4bc60a`
Role: security-reviewer
Mode: review-only

## Inventory and method

I read `AGENTS.md` and the repository architecture/security/operations rules in
`CLAUDE.md`, then inventoried 263 non-test TypeScript runtime files (80 app
files, 61 components, 115 library files), 12 route handlers, 53 exported
action functions, 31 migrations, 31 operational scripts, and 374 unit/e2e test
files. The security pass traced authentication and session rotation, PAT scope
checks, action origin and restore barriers, public rate limiting, upload and
backup path containment, privacy projections, restore SQL scanning and child
processes, CSP/proxy trust, secrets, migrations, and deploy ownership checks.
The cycle-1-to-HEAD diff was reviewed separately so regressions in the auth and
deploy fixes were not hidden by the broader inventory.

Executed evidence:

- `lint:api-auth`, `lint:action-origin`, and
  `lint:public-route-rate-limit`: all passed.
- `npm run audit:prod`: zero production vulnerabilities.
- Live `https://gallery.atik.kr/en` response headers include a per-response
  nonce CSP, HSTS, `nosniff`, `SAMEORIGIN`, restrictive permissions policy,
  and strict referrer policy.
- The targeted auth/deploy/analytics regression suite passed (106 tests across
  eight files).

## New findings

No new security defect was confirmed at this HEAD.

The cycle-1 fixes were specifically revalidated: both in-memory login budgets
advance before the first durable await and durable increments are independent
(`apps/web/src/app/actions/auth.ts:137-158`); deploy files are rejected unless
owned by the caller or the repository owner and are still required to be
private (`scripts/deploy-remote.sh:55-97`, `apps/web/deploy.sh:17-55`). Trusting
the repository owner does not create an additional privilege boundary because
that owner can already edit the executed deploy script itself.

## Revalidated carry-forward security risk

### SEC-C2-R1 — Multi-process safety remains warn-only

- Severity: **High**
- Confidence: **High**
- Status: Revalidated carry-forward; confirmed architecture constraint, not new
- Regions: `apps/web/src/instrumentation.ts:18-27` and
  `apps/web/src/lib/single-writer-guard.ts` (startup advisory-lock guard);
  process-local coordinators in `apps/web/src/lib/admin-mutation-barrier.ts`,
  `apps/web/src/lib/rate-limit.ts`, and `apps/web/src/lib/image-queue.ts`

The startup check intentionally warns and continues when another writer is
present. A second app process therefore has independent in-memory mutation
slots, request budgets, and queue state even though both processes use the same
database and mutable file stores.

Concrete failure scenario: an operator temporarily starts a second replica
during recovery. Both accept writes; a restore can drain only one process's
in-memory slots, process-local public abuse budgets split, and duplicate image
work competes against the shared DB/filesystem. The warning is easy to miss and
does not make the topology fail closed.

Suggested fix: either enforce the documented single-writer topology by holding
a required process-lifetime lease, or move every affected coordinator to a
shared durable primitive before supporting replicas. Keep this explicitly
listed as unsupported until that is complete.

## Final missed-issue sweep

The closing sweep rechecked every route/action export, auth and rate-limit
ordering, dynamic SQL/child processes, filesystem opens and realpath checks,
public field projections, `dangerouslySetInnerHTML` sites, proxy-derived IPs,
cookie settings, backup permissions, environment sourcing, and security
header construction. Current restore scanners, privacy type guards, upload
serving, and authenticated backup download all retain their defenses. Apart
from the documented single-writer constraint, no additional confirmed or
likely security issue survived the final sweep.
