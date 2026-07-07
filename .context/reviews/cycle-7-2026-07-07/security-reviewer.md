# Cycle 7 Security Review

**Scope:** Committed HEAD `14d31ea4`. Focus: OWASP Top 10, authn/authz, secrets, injection
(SQL/path/command/header), SSRF, path traversal, upload safety, session/cookie handling,
rate-limit bypass, CSP/headers, deserialization, ReDoS, unsafe crypto, PII leakage
(GPS/original filenames/admin-only color columns) via public select fields. Special focus
on the freshest peer commits (least soak time): d8fcb3d6, 57e2c5d3, 05fa5cd1, 9cd8d3e8,
14d31ea4, plus lib/sql-restore-scan.ts, lib/gps-exif-strip.ts, lib/data.ts,
lib/api-auth.ts, lib/admin-tokens.ts, proxy.ts, OG image routes, and lint-gate
invariants (withAdminAuth, requireSameOriginAdmin, public-route rate-limit).

**Risk Level:** LOW (no new CRIT/HIGH/MED findings; one INFO-level clarification)

## Summary
- Critical Issues: 0
- High Issues: 0
- Medium Issues: 0
- Low/Info Issues: 1 (informational clarification, not a vulnerability)

This cycle found no new substantive security defects. The four freshest commits
(d8fcb3d6, 57e2c5d3, 05fa5cd1, 9cd8d3e8) are all legitimate hardening changes and
were verified line by line against actual runtime behavior (nginx config, request-origin
logic, CSP builder, Drizzle/runtime TLS parity, DB pool connection handling). All three
security lint gates were re-run and pass, and their invariants were spot-checked against the
handler code (not just trusted from script exit code).

## Findings

### C7-SEC1 -- d8fcb3d6 Host-preference fix is a no-op under the shipped nginx template; real protection is BASE_URL
**Severity:** INFO
**Confidence:** High (confirmed against apps/web/nginx/default.conf)
**Category:** A05 Security Misconfiguration / CSRF provenance (defense-in-depth clarification)
**Location:** apps/web/src/lib/request-origin.ts:68-77 (the getExpectedOrigin host-selection
branch changed by commit d8fcb3d6); apps/web/nginx/default.conf:105-243 (every
proxy_set_header Host $host; / proxy_set_header X-Forwarded-Host $host; pair)

**What I checked:** commit d8fcb3d6 changes getExpectedOrigin() to prefer the Host
header over X-Forwarded-Host (previously the reverse, when TRUST_PROXY=true), with the
stated goal of preventing a spoofed X-Forwarded-Host from redefining same-origin. I traced
this against the shipped nginx template and found every proxied location block sets
both Host and X-Forwarded-Host to the identical $host nginx variable (the Host the
client sent to nginx). So under the documented/shipped topology, this change is behaviorally
a no-op: whichever header wins, the value is the same client-supplied string. The commit's
own test suite (request-origin.test.ts) correctly exercises the header-preference logic in
isolation but does not (and cannot, at the unit level) prove anything about the real nginx
wiring.

**Why this matters:** the meaningful defense for CSRF/same-origin provenance in production is
BASE_URL being configured (getExpectedOrigin short-circuits to the configured canonical
origin before ever consulting Host/X-Forwarded-Host, request-origin.ts:60-66). That
requirement is already tracked as deferred rows C1-11 / C3-12op ("operator confirms
production edge topology"). This finding is NOT a new vulnerability -- it does not
regress anything, since the previous X-Forwarded-Host-preferred behavior was equally
protected by BASE_URL, and both old and new code paths degrade identically if BASE_URL
is unset and a different reverse-proxy/CDN topology is used that sets Host and
X-Forwarded-Host to different values (e.g., an edge that intentionally rewrites Host
to an internal name while preserving the original in X-Forwarded-Host). I'm flagging it
only so the team doesn't read the d8fcb3d6 commit message ("prefer host for origin checks")
as having independently closed the topology-trust gap for the shipped deployment -- it hasn't;
BASE_URL still does the actual work, exactly as already tracked in the deferred register.

**Suggested action:** none required functionally. Optionally, add a one-line comment in
request-origin.ts near the host-preference branch noting that the shipped nginx template
sets Host/X-Forwarded-Host identically, so this branch only matters for non-default
proxy topologies where the two diverge and BASE_URL is unset -- to prevent a future
contributor from believing this fallback path is the primary CSRF defense.

**Confirmed / likely / needs-manual-validation:** Confirmed (read the exact nginx config and
request-origin.ts diff; behavior is deterministic, not conditional on runtime data).

## Areas verified with no findings

- Lint-gate invariants, verified against actual code (not just exit codes):
  - npm run lint:api-auth -- passes; both api/admin/* routes (db/download,
    lr/upload) wrap withAdminAuth(...). Read lib/api-auth.ts end-to-end: same-origin
    check runs before isAdmin(), token path (allowTokenScope) correctly rate-limits
    (preIncrementAdminTokenAuthAttempt) before verifyToken, uses constant-time hash
    compare (tokenHashesEqual via timingSafeEqual), sets Cache-Control: no-store /
    X-Content-Type-Options: nosniff on every exit path (error and success).
  - npm run lint:action-origin -- passes; every mutating export in
    apps/web/src/app/actions/*.ts (spot-checked admin-users.ts, topics.ts, tags.ts,
    sharing.ts) returns early on requireSameOriginAdmin(), wrapped by
    acquireAdminMutationSlot() (restore-window fence) before isAdmin().
  - npm run lint:public-route-rate-limit -- passes; all 6 routes under api/**
    (excluding admin) and the public feed/uploads routes either call a rate-limit
    pre-increment helper or carry a reasoned @public-no-rate-limit-required exemption.
  - npm audit --omit=dev --audit-level=moderate gave 0 vulnerabilities. package.json
    overrides (postcss 8.5.16, next's nested postcss, esbuild 0.28.1 for a
    dev-only transitive) are genuine version bumps to patched releases, not audit
    suppression.

- d8fcb3d6 (prefer Host for origin checks): see C7-SEC1 above -- correct, no
  regression, but currently redundant under the shipped topology.
- 57e2c5d3 (release gate hardening): Dockerfile now pins node:24-slim to a digest;
  .github/dependabot.yml already has a docker ecosystem entry for apps/web, so the
  pinned digest will get automated bump PRs (not an unmaintained freeze). GA_CONNECT_SOURCES
  gained https://www.google.com, correctly gated behind includeGoogleAnalytics (only
  emitted when a GA id is configured) -- does not broaden CSP for sites without GA.
- 05fa5cd1 (image-base/TLS CA sanitization): sanitizeImageBaseUrlSafely correctly
  rejects credentials/query/hash/non-http(s) and is used both server-side (constants.ts
  IMAGE_BASE_URL, sourced from process.env, not attacker input) and client-side
  (image-url.ts, reading document.documentElement.dataset.imageBase) -- traced that
  data-image-base is stamped server-side directly from the already-sanitized
  IMAGE_BASE_URL constant (app/[locale]/layout.tsx:117), so the client-side sanitization
  is defense-in-depth, not a compensating control for a new hole. drizzle.config.ts's new
  "DB_SSL_CA required for non-local TLS" throw now matches the pre-existing runtime contract
  in db/index.ts and scripts/mysql-connection-options.js (all three now fail closed
  identically) -- closes a previous drizzle-kit/runtime inconsistency, no new gap introduced.
- 9cd8d3e8 (proxy/db-timeout hardening): db/index.ts's connection.release() to
  connection.destroy() on init-query timeout is correct -- releasing a connection whose
  SET group_concat_max_len may still be in flight back to the pool for reuse was the
  actual latent bug; destroy() lets mysql2 open a fresh replacement on next demand instead
  of returning a session in unknown state to a future borrower. db-actions.ts's watchdog
  reorder (onTimeout now called after markSettled's guard is armed, and markSettled
  gated on !fired) closes a double-settle race on child-process timeout; verified no path
  leaves the DB restore/backup child process unreaped.
- 14d31ea4 (UI surface discovery): the topic/tag delete-confirmation dialogs now
  interpolate label/name into next-intl t() calls (ICU message format, React-escaped,
  not raw HTML) -- no XSS vector; admin-only surface regardless.
- lib/sql-restore-scan.ts: re-verified the destructive-SQL denylist, the
  APP_BACKUP_TABLES allowlist superset invariant, the raw-byte-bridge chunk-boundary
  keyword-splitting defense, and the schema-qualified-identifier / write-target scanner. No
  new gaps found; this file has had many dedicated hardening cycles (C1RPF/C3RPF/C4R-RPL/
  C5R-RPL/C6-01/C6-AGG6R prefixes in comments) and nothing in it changed in this cycle's
  commits.
- lib/gps-exif-strip.ts: re-verified JPEG (incl. post-EOI trailer rejection, standard +
  ExtendedXMP GPS token reconstruction across chunk boundaries), TIFF, ISOBMFF/HEIF (walkAborted
  unconditional fail-closed), and WebP RIFF GPS strippers. Every path fails closed (null) on
  structural anomaly, forcing the caller's re-encode path. No new gaps; unchanged this cycle.
- lib/data.ts privacy guards: re-verified adminSelectFields to
  publicSelectFields/publicMapSelectFields derivation, the _PrivacySensitiveKeys
  compile-time Extract<...> guards (main + map variant), and the _LargePayloadKeys
  guard. lib/search-enrichment-fields.ts (used by both semantic + similar-image public
  routes) carries its own independent compile-time PII guard sharing the same
  PrivacySensitiveKeys type. No sensitive field reachable from any public code path found.
- lib/admin-tokens.ts: SHA-256 hash storage (plaintext never persisted), constant-time
  hash comparison, expires_at enforced, scope-set enforcement via tokenHasScope,
  fail-closed on missing table. No issues.
- proxy.ts: admin route matcher correctly excludes /admin login page itself; cookie
  presence/format pre-check (length >= 100, 3 non-empty colon-separated segments) is a fast
  reject before the real cryptographic verifySessionToken() runs in server actions; CSP
  nonce generated via crypto.randomUUID() per request; x-gk-admin-render header only
  echoes the requester's own cookie presence back to themselves (no cross-user leakage).
- OG routes (api/og/route.tsx, api/og/photo/[id]/route.tsx, lib/og-photo-fetch.ts):
  per-photo route pins its internal derivative fetch to new URL(BASE_URL).origin (fails
  closed to a fallback response if BASE_URL is unparseable -- never falls back to
  req.url's attacker-influenced origin), byte-capped (1 MB) and time-budgeted (10 s total,
  3.5 s per attempt) fetch chain, and the admin-configured og_image_url redirect option
  is validated same-origin before use (prevents an open-redirect if SEO settings were ever
  poisoned). Both routes charge the rate-limit budget on any branch that consumed real
  DB/CPU work (no free-retry oracle). Site-level OG route path-params (topic, tags) are
  slug/tag-validated and length-capped before rendering; no external fetch, no SSRF surface.
- db-actions.ts child-process spawning: mysqldump/mysql/migrate all invoked via
  spawn() with array args (no shell), credentials passed via MYSQL_PWD/MYSQL_USER/etc.
  env vars (not CLI flags, avoiding /proc/pid/cmdline exposure), HOME excluded from the
  child env (prevents ~/.my.cnf injection). No command-injection surface.
  The Content-Disposition header built in api/admin/db/download/route.ts from the
  requested filename is safe from header/response injection because the filename is
  validated against BACKUP_FILENAME_PATTERN, a strict regex allowing only digits,
  dashes, hex, T, Z, and a .sql suffix -- no quote, CR, or LF characters can pass it.
- rate-limit.ts / getClientIp: TRUST_PROXY gate before trusting any forwarded
  header (fail-closed to 'unknown', which is documented as collapsing to a single shared
  bucket -- an already-known, correctly-labeled tradeoff); XFF hop-count selection matches
  TRUSTED_PROXY_HOPS; IPv4/IPv6 normalization via net.isIP. No new bypass found.
- Secrets scan: grepped for api key / password / secret / token patterns across
  src/lib, src/app/actions, src/app/api -- all hits are either env var reads
  (process.env.SESSION_SECRET, process.env.DB_PASSWORD, etc.), schema/column names, or
  the token-hashing/verification code already reviewed above. No hardcoded credentials found.
- Injection sweep: grepped for exec/execSync/spawn calls (all array-arg, no shell),
  dangerouslySetInnerHTML (8 hits, all JSON-LD structured-data blocks -- standard Next.js
  pattern for schema.org markup, not user-controlled raw HTML), and sql.raw( (2 hits, both
  interpolating a compile-time-constant separator character, not user input, and
  pinned by shared-link-runtime-contracts.test.ts). No injection vector found.
- ReDoS sweep: grepped for nested/superlinear quantifier patterns across src -- none found.

## Final sweep for commonly-missed issues

Confirmed coverage of: all api/admin/* routes (2 total -- db/download, lr/upload), all
public api/** routes (health, live, search/semantic, search/similar/[id]), all
app/actions/*.ts mutating exports (via the lint gate plus manual read of admin-users.ts,
topics.ts), proxy.ts middleware, both OG image routes, lib/api-auth.ts,
lib/admin-tokens.ts, lib/sql-restore-scan.ts, lib/gps-exif-strip.ts, lib/data.ts
privacy-guard block, lib/search-enrichment-fields.ts, lib/request-origin.ts,
lib/content-security-policy.ts, lib/rate-limit.ts, db/index.ts, db-actions.ts,
drizzle.config.ts, scripts/mysql-connection-options.js, scripts/check-proxy-topology.mjs
(committed HEAD version -- the working-tree copy is peer-dirty and was not evaluated), the
shipped nginx/default.conf, package.json overrides, and the Dockerfile. Did not
re-litigate any item already present in .context/plans/deferred-carry-forward.md or the
per-cycle deferred registers (checked C1-11, C3-12op, and the C2-* proxy/CSP/storage rows
before writing up C7-SEC1). Peer-owned dirty files
(apps/web/src/__tests__/cycle12-ops-contracts.test.ts, scripts/check-proxy-topology.mjs)
were reviewed only via git show HEAD:<path>, not the working-tree copy, per the shared-worktree
rules; no security-relevant divergence was assessed against the peer's in-flight edits since
those are outside this lane's scope.

## Security Checklist
- [x] No hardcoded secrets
- [x] All inputs validated (spot-checked admin-users, topics, semantic/similar search, OG routes)
- [x] Injection prevention verified (SQL parameterization, no shell exec, no unsafe HTML sinks)
- [x] Authentication/authorization verified (withAdminAuth, requireSameOriginAdmin, session
      cookie format + crypto verification split correctly between middleware and server actions)
- [x] Dependencies audited (npm audit: 0 vulnerabilities; Dockerfile digest pin has an
      automated refresh path via dependabot)
