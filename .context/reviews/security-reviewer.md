# Security Review — Cycle 3

Date: 2026-07-18 KST
Review HEAD: `afa11cf4`
Role: security-reviewer
Mode: review-only

## Inventory and validation

I inventoried all 3,645 tracked files, then scoped the security review to the
764 non-review/non-plan repository files: 265 non-test app source files (81 app,
61 components, 115 libraries and supporting entry files), 53 exported server
actions, 12 route handlers, 29 scripts, 31 SQL migrations plus journal/snapshots,
368 Vitest files, 12 Playwright/support files, deployment/proxy/container files,
CI, env examples, and the governing docs. The closing pass traced OWASP-relevant
auth/session/PAT paths, authz and same-origin gates, rate limits, privacy
projections, upload and backup path containment, SQL restore scanning and child
processes, secrets, CSP/JSON-LD sinks, proxy trust, migrations, and deployment
ownership. The Cycle-2-to-HEAD production diff was separately reviewed.

Executed evidence:

- API-auth, action-origin/mutation-barrier, and public-route-rate-limit scanners passed.
- ESLint, typecheck, build, full Vitest (3,410 passed, 4 skipped), and production
  dependency audit (zero vulnerabilities) passed.
- Secret-pattern and dangerous-sink sweeps found placeholders/historical
  redactions only; no working-tree credential was confirmed.
- The built sitemap is dynamic and absent from `.next/prerender-manifest.json`.

## Genuinely new Cycle-3 findings

No new security defect was confirmed at this HEAD. The Cycle-2 changes affect a
public sitemap cache, public image preload hints, combobox state, and operator
wording; they introduce no new authentication, authorization, secret, private
field, filesystem-write, SQL, or child-process boundary.

## Revalidated carry-forward security risk

### SEC-C3-R1 — Multi-process safety remains warn-only

- Severity: **High**
- Confidence: **High**
- Status: **Revalidated carry-forward; not new**
- Regions: `apps/web/src/instrumentation.ts:18-27`;
  `apps/web/src/lib/single-writer-guard.ts:6-16,218-235`; process-local
  coordination in `apps/web/src/lib/admin-mutation-barrier.ts`,
  `apps/web/src/lib/rate-limit.ts`, and `apps/web/src/lib/image-queue.ts`

The startup singleton probe explicitly continues after persistent contention.
A second live process therefore has independent restore slots, abuse budgets,
upload accounting, and queue state while sharing MySQL and mutable file stores.

Concrete failure: a recovery or scale-out starts a second replica. Both accept
writes; a restore drains only one process's foreground slots, process-local rate
limits split, and duplicate background work competes on shared state despite the
loud log message.

Suggested fix: either hold a required process-lifetime lease and fail closed on
persistent contention, or move every affected coordinator to shared durable
state before replicas are supported.

## Final missed-issue sweep

The final sweep rechecked every route/action export, auth and rate-limit ordering,
public field projections and `_PrivacySensitiveKeys`, raw SQL/child processes,
filesystem realpath/open ordering, proxy-derived origins/IPs, cookie defaults,
backup/restore maintenance, deployment env ownership, CSP construction, JSON-LD
sinks, and the changed sitemap/preload/search paths. Apart from the documented
single-writer constraint and already-registered architecture/operator risks, no
additional confirmed or likely security issue survived revalidation.
