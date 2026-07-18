# Security Review — Cycle 1 Group B

Date: 2026-07-18 KST
Start HEAD: `64f6ac63`
Role: security-reviewer

## Inventory and method

I read `AGENTS.md` and `CLAUDE.md` first, then inventoried all 635 files under
`apps/web/src` (81 app files, 61 components, 115 library files, 3 DB files, and
369 tests) plus the root/deploy scripts, Docker/Compose/nginx configuration,
migrations, package manifests, and current review/plan history. The security
sweep covered every exported server action and route, session/PAT auth, origin
checks, rate limiting, public/private projections, upload and restore paths,
filesystem containment, SQL construction, CSP/headers, proxy trust, secrets,
and deployment entry points. I also checked existing review history before
classifying findings so established/accepted risks were not presented as new
confirmed defects.

## Findings

### SEC-C1-01 — A DB failure skips the account-scoped in-memory login increment

- Severity: **High**
- Confidence: **High**
- Status: Confirmed security defect
- Region: `apps/web/src/app/actions/auth.ts:137-175`
- Test gap: `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts:118-130` and
  `apps/web/src/__tests__/auth-actions-behavior.test.ts:114-144,195-196`

The login path intends to maintain two independent brute-force budgets: one by
IP and one by normalized account. It mutates the IP map, then immediately
awaits the durable IP increment at `auth.ts:140-145`. The account map mutation
does not happen until `auth.ts:146-149`, after that await. If the first
`incrementRateLimit(ip, 'login', ...)` rejects because MySQL is unavailable,
control jumps to the shared catch at line 150. The account entry therefore
remains at its old count. The subsequent DB checks also fail, and the fallback
at lines 170-175 observes the unchanged `accountLimitData.count`.

Concrete failure scenario: during a MySQL outage or pool-exhaustion episode, an
attacker distributes guesses for one admin username over many source IPs. Each
IP still gets its five-attempt process-local budget, but the account-wide
process-local budget never advances. This restores the distributed brute-force
class the account limiter was specifically added to stop, precisely when the
code comments claim both in-memory maps are the fallback authority.

The source-order test only proves that both textual DB increment calls appear
before the DB checks; it does not simulate rejection of the first awaited
increment. The behavior test always resolves `incrementRateLimitMock`, so it
also misses this branch.

Suggested fix: synchronously update **both** in-memory entries before the first
await. Execute the two durable increments independently (or with
`Promise.allSettled`) so failure of one cannot skip the other in-memory guard.
Add a behavioral regression test where the first durable increment rejects and
assert that `accountLoginRateLimit` still advances and reaches its cap across
repeated calls.

### SEC-C1-02 — Root-run deploy can source and execute a different user's env file

- Severity: **Medium**
- Confidence: **High**
- Status: Confirmed local privilege-boundary weakness
- Regions: `scripts/deploy-remote.sh:55-85,87-93`,
  `apps/web/deploy.sh:17-43,51-55`

Both deployment scripts detect that their configuration file is not owned by
the current user, but only print a warning (`deploy-remote.sh:61-63` and
`deploy.sh:24-26`). They then source or consume it. The remote helper is the
stronger case: it runs `source "$ENV_FILE"` at lines 82-85 and later passes the
file-controlled `DEPLOY_CMD` to `bash -lc` at lines 87-93.

Concrete failure scenario: an operator invokes the deploy under `sudo` or a
root automation account while `.env.deploy` is owned and writable by a less
privileged workspace user. Mode `0600` passes the permissions check because
root can read it; the ownership warning does not stop execution. That user can
set `DEPLOY_CMD` (or use shell syntax in the sourced file) and obtain code
execution as the deploy account. The runtime deploy script similarly allows an
untrusted owner to select Docker Compose env/build values when run by root.

Suggested fix: fail closed on `! -O "$ENV_FILE"`, not warn. If shared ownership
is a supported operational requirement, define an explicit trusted owner UID
or root-owned config contract and verify it before sourcing. Add shell contract
tests for wrong-owner rejection alongside the existing mode checks.

## Verified defenses / non-findings

- All current admin API exports use `withAdminAuth(...)`; cookie requests get
  same-origin validation and PAT requests require the declared scope.
- Mutating admin server actions consistently guard origin and authentication;
  public exemptions are explicit and rate-limited.
- Public image/search/timeline projections retain compile-time privacy guards;
  GPS is isolated to the map-visible opt-in projection.
- Upload serving validates segments, extensions, realpath containment, and file
  type; backup downloads validate filename, containment, and stream from the
  validated descriptor.
- SQL restore parsing has both dangerous-statement and write-target allowlist
  gates; upload/restore concurrency is fenced by maintenance/advisory locks.
- Session cookies remain HttpOnly, Secure in production, SameSite=Lax, and
  backed by hashed server-side session rows.
- The current `geoip-lite` externalization is consistent across
  `next.config.ts`, production dependencies, Docker copy layout, and startup
  prewarm; no country lookup packaging defect remains at HEAD.

## Final missed-issue sweep

I re-scanned dynamic execution, child processes, SQL templates, filesystem
operations, `dangerouslySetInnerHTML`, suppressions, token/session construction,
proxy header trust, CSP sources, backup permissions, and every route/action
export. No additional high-confidence exploitable issue was found. Existing
topology risks (warn-only single-writer enforcement, host-nginx drift, plaintext
backups, non-expiring PAT defaults, process-local fast-path limiters) remain
documented in the current aggregate/deferred history and are not duplicated as
new findings here.
