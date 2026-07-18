# Cycle 10 — security-reviewer

Reviewed HEAD: `1e3646e3` (2026-07-18)

## Inventory and method

I inventoried the full 946-file review surface, read the repository security model, and systematically reviewed the security-relevant implementation: session/HMAC/Argon2 flows; login/account rate limits; proxy and same-origin derivation; admin action/API guards; mutation barrier and restore locks; PAT scope/expiry; public route limiters; upload type/size/path/symlink/GPS handling; public projections and privacy type guards; SQL/raw child-process boundaries; backup/restore scanning; OG origin pinning and CSP; upload serving; secret/env/deploy ownership; and dependency/deployment configuration. I also examined all source changes in the newest three commits and ran repository-wide searches for suppressions, dynamic SQL, file/process calls, background writes, and mutable state.

## Result

**No new security finding.** The responsive source descriptor defect documented by the other reviewers is a correctness/performance contract issue, not a confidentiality, integrity, authentication, or authorization weakness. The stale plan ledger is workflow documentation, not a security control failure.

## High-risk invariants revalidated

- Admin route exports remain under `withAdminAuth`; mutating actions retain same-origin and mutation-barrier coverage.
- PAT upload scope, restore-maintenance gating, upload quota claim ordering, private-original storage, symlink/path containment, and GPS fail-closed behavior remain present.
- Public selects continue to omit sensitive filename/GPS/admin-only fields except the explicit map opt-in projection; the compile-time/test privacy guard is still the controlling invariant.
- Raw DB/backup/restore execution uses parameterized queries or argument arrays; no newly introduced untrusted shell concatenation was found.
- Canonical OG fetches remain pinned to trusted configuration, and public expensive routes retain app/edge limiter contracts.
- The detached-config owner/generation change does not create a trust-boundary bypass; settings invalidation happens after the guarded transaction and stale reads cannot republish shared state.
- `master == origin/master` and the newest commits verify as GPG-signed; no tracked credential or new secret-bearing file appeared in the reviewed diff.

## Final missed-issues sweep

I revisited auth rollback paths, session revocation during restore, advisory-lock release-on-error, upload cleanup after DB/file boundary crossings, rate-limit failure behavior, CSP/JSON-LD sinks, and deploy-env ownership. Previously closed/refuted findings were not repeated. No security issue needing manual validation remained from the newest commits.
