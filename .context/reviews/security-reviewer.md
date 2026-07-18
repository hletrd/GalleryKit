# Security Reviewer — Cycle 8 Provenance

Review target: `ff8c5f48`. Review only.

## Inventory and validation

I inventoried the maintained repository and governing documentation, including
516 source `.ts` files, 113 source `.tsx` files, 12 App Router route handlers,
13 action modules plus the action barrel and admin DB actions, 31 migration SQL
files with journal/reconcile machinery, 369 unit-test files, 16 Playwright
files, scripts/configuration, deployment assets, current plans/reviews, and the
consolidated carry-forward register.

The security sweep traced session/password/PAT authentication, proxy and origin
trust, public/admin rate limits, mutation barriers, public/private projections,
upload and derivative path containment, backup/restore child processes, SQL and
JSON-LD/OG sinks, CSP, secrets/config validation, migration promotion, and
single-writer/background-job boundaries. The Cycle 7 implementation diff is
confined to client-side masonry measurement plus tests and review ledgers; it
does not alter credential, authorization, privacy, persistence, file, SQL, or
process-execution boundaries.

Fresh checks passed:

- `lint:api-auth`
- `lint:action-origin` including mutation-barrier enforcement
- `lint:public-route-rate-limit`
- production dependency audit with zero vulnerabilities

## New Cycle 8 findings

**Zero.** The confirmed ultrawide derivative-selection issue is bandwidth and
test-policy debt, not a new resource-exhaustion primitive or trust-boundary
failure. The stale release ledger is provenance state rather than a security
control failure.

## Revalidated, not new

Warn-only single-writer enforcement, process-local fast-path buckets, plaintext
DB backups at the operator boundary, production `style-src 'unsafe-inline'`,
host-applied nginx policy, upload/restore buffering, shared background pool
budgeting, and operator-owned proxy/secret checks remain documented or present
in `.context/plans/deferred-carry-forward.md`. None of their exit criteria was
triggered by the current client-only implementation.

## Final missed-issue sweep

The final sweep rechecked guard ordering/exemptions, token scope/expiry/revoke,
session cookies, account/IP buckets, trusted proxy selection, privacy type
guards, SQL and process arguments, path/symlink containment, restore drains and
finalizers, CSP/OG origin pinning, analytics disclosure, runtime secrets,
migration assertions, and the complete Cycle 7 diff. No current-HEAD security
finding survived source, history, and guard-check validation.
