# Run-10 Cycle 4/100 — Security Review (2026-07-07)

**Lane:** security-reviewer. **Start HEAD:** `ec433dc4` (clean tree, deployed).
**Angle:** OWASP Top 10, authn/authz, secrets, unsafe patterns, injection, SSRF,
path traversal, timing, cache poisoning.
**Method:** validated every claim against source (exact file:line). Inventory of the
17 cycle-3 commits (`git log e08b6f97..ec433dc4`) first; primary scope = the 8
security-relevant commits named in the task; secondary = fresh sweep of the
least-recently-audited auth/token/origin/lint-gate surface. No repo file modified
(this review is the only write).

## Verdict

**NO new CRIT / HIGH / MED security findings.** All eight primary-scope commits are
security-clean with no constructible bypass. Two INFO records and one LOW
(defense-in-depth hardening, outside the stated threat model) are logged below for
lineage. The three security lint gates run green at HEAD and each still enforces
exactly what CLAUDE.md's "Lint Gates" section claims (AST-based, fail-closed).

## Findings table

| ID | Sev/Conf | Status | Location | Title |
|----|----------|--------|----------|-------|
| SEC4-01 | INFO/High | verified-acceptable | `lib/serve-upload.ts:200-217,296` | fd-free HEAD/304 rewrite preserves containment; residual symlink-swap TOCTOU is pre-existing and outside the "only-the-app-writes-uploads" threat model |
| SEC4-02 | INFO/High | verified/known | `nginx/default.conf:11,26-30` | New `nextimage` limiter is a net hardening; all `limit_req_zone` keys remain `$binary_remote_addr` (LB-topology caveat already tracked as C3-12op/C1-11) |
| SEC4-03 | LOW/Med | hardening (optional, deferred-class) | `lib/serve-upload.ts:296` | `open(resolvedPath,'r')` follows a post-`realpath` symlink swap; `O_NOFOLLOW` / fd-realpath re-check would remove the residual coupling, but needs a hostile local writer that the threat model excludes |

## Primary-scope commit review (validated clean)

### fc9e4407 / d07c6d32 — serve-upload.ts fd-free HEAD/304 rewrite (SEC4-01, SEC4-03)
Path containment is intact and, if anything, unchanged in strength by the rewrite:
- **Segment validation** (`:177-184`): rejects empty, `>255`, `.`, `..`, and any
  segment failing `SAFE_SEGMENT` (`^[a-zA-Z0-9._-]+$`) — no `/`, `\`, or NUL can
  enter a segment; `..` is rejected exactly, and a `..foo` filename is inert under
  `path.join`.
- **Extension/dir pinning** (`:161-171`): `ALLOWED_UPLOAD_DIRS` (jpeg/webp/avif) +
  `DIR_EXTENSION_MAP` reject cross-type serving before any syscall.
- **Symlink + containment** (`:200-207`): `lstat` rejects a final-component symlink
  (403); `realpath` canonicalizes; `resolvedPath.startsWith(resolvedRoot + path.sep)`
  blocks the sibling-prefix escape (`/uploads-evil` vs `/uploads`). An intermediate
  symlink pointing outside root is caught by the same startsWith on the realpath.
- **Cached root** (`resolveUploadRootCached`, `:28-40`): only a SUCCESSFUL realpath is
  memoized; the ENOENT branch recomputes per request, so a root created later
  (possibly via symlink) is re-resolved — cannot be pinned to a stale unresolved path.
- **ETag / header injection** (`:254,302`): every ETag field is a constant
  (`IMAGE_PIPELINE_VERSION`), a number (`mtimeMs`, `size`), or the 8-char
  `settingsHash` from `settings-hash.ts` — no request/user-controlled string reaches a
  header value. `contentType` comes from a fixed map; SVG is intentionally absent.
- **TOCTOU (SEC4-01/SEC4-03):** the GET body path opens the fd FIRST and stats THROUGH
  it (`:296-302`) so streamed headers and body always describe the same file — the
  original race-safety contract, preserved. The new fd-free 304/HEAD branches build
  their response from a path-based `stat(resolvedPath)` (`:217`); a symlink swap of
  `resolvedPath` between `realpath` and `stat`/`open` could redirect to an out-of-root
  target, but this requires a hostile local writer inside `public/uploads/{jpeg,webp,avif}`,
  which the threat model excludes (app writes only `crypto.randomUUID()` names and
  rejects symlinks at write time). Pre-existing, not introduced this cycle; the
  `isFile()` guard (`:219`) still blocks directories/FIFOs/devices on every branch.
  SEC4-03 records the `O_NOFOLLOW`/fd-realpath hardening as optional.
- `ifNoneMatchMatches` (`http-etag.ts`): weak-comparison parser is quote-anchored and
  does exact opaque-tag equality; `*` returns 304 for an existing resource (RFC 9110
  correct). No injection, no cache-poisoning primitive.

### 3f8b6c88 — single-writer-guard.ts + advisory-locks.ts (lock-name SQL construction)
- **No injection via DB name.** `getSingleWriterLockName(dbName)` folds the DB name
  through `sha256().slice(0,16)` and appends it to a constant prefix; the DB name never
  reaches SQL text. The lock is taken with `GET_LOCK(?, 0)` / `RELEASE_LOCK(?)` —
  parameterized (`single-writer-guard.ts:87,215`). Even a DB name containing quotes is
  inert.
- **No 64-char truncation risk.** Final name = `gallerykit_web_singleton_` (25) + 16 hex
  = 41 chars, well under MySQL's 64-char advisory-lock-name limit for ANY db name.
- **No info leak.** `emitLoudTopologyError` prints only the derived (hashed) lock name,
  not the DB name or credentials. `isAdvisoryLockAcquired` accepts only the exact
  success sentinel (`1`/`1n`/`'1'`). This is warn-only and cannot block boot. Clean.

### 285a4538 — migrate.js baseline logic ("baseline only true drift")
- A crafted DB migration state **cannot** be used to skip security-relevant DDL as a
  *privilege boundary* — the migrator already trusts DB state, and anyone able to forge
  `__drizzle_migrations` rows has full DB write. Within that trust model the change is
  strictly safer: only at/below-cursor drift is baselined; the above-cursor pending tail
  is left for `drizzle.migrate()` to genuinely apply, and `baselineAllJournalMigrations`
  now THROWS on any above-cursor entry (`migrate.js:757-772`), converting the previous
  silent SQL-drop into a loud failure.
- **No injection surface.** `reconcileLegacySchema` interpolates only hardcoded
  `tableName`/`columnName` literals into backticked DDL; the DB name is passed as a bound
  `information_schema` parameter (`columnInfo`/`indexExists`/`foreignKeyExists`,
  `[dbName, tableName, columnName]`). This is an audited raw-SQL maintenance surface per
  CLAUDE.md, with no untrusted input.

### 1baeb3fe — nginx `/_next/image` limiter (SEC4-02)
Net security IMPROVEMENT: the previously-unthrottled Sharp-re-encoding public endpoint
gets a dedicated `nextimage` zone (30r/s, burst 120), capping per-IP `(url×w×q)`
enumeration floods while `limit_conn` still backstops concurrency. `^~` is a longest-
prefix location (regex evaluation suppressed) — no anchor-bypass. The commit itself
documents the `$binary_remote_addr` LB caveat (all zones key on the TCP peer, so an
LB-fronted deploy needs realip/PROXY-protocol) — already carried as C3-12op/C1-11; no
new action.

### c7f32eef — similar-route defensive embedding copy
`targetEmbedding = new Float32Array(decoded)` (`similar/[id]/route.ts:164`) removes the
retained zero-copy view over the mysql2 wire buffer — a robustness/correctness fix, no
security surface. Route posture verified sound: same-origin gate → restore-maintenance
guard → positive-int id validation → `preIncrementSemanticAttempt` BEFORE the DB mode
lookup → production-mode gate. The public-route rate-limit gate passes it as
"expensive GET uses rate-limit helper."

### cc869996 — backfill uncached config
`getGalleryConfig()` → `getGalleryConfigUncached()` in the detached runner. Verified the
uncached accessor is genuinely re-reading behind only a bounded 2 s TTL micro-cache +
in-flight dedupe (`gallery-config.ts:211-233`) — cannot stale a re-encode's settings
beyond 2 s. Correctness fix, no security impact.

### 0ae67c25 — SW template durable recency touch
`touchMeta` now awaits inside `respondWith` and skips size-0 meta records. No change to
cache SCOPE, cache KEYS, or what is cached — purely LRU size-accounting + recency
durability. No cache-poisoning or scope-escalation primitive introduced. `sw.js`
regenerated in lockstep (`26516421-p7`).

## Secondary sweep (fresh, least-recently-audited surface — clean)

- **`lib/api-auth.ts`** — `withAdminAuth` ordering is correct: token path is
  per-IP rate-limited (`preIncrementAdminTokenAuthAttempt`) BEFORE `verifyToken`, only
  fires when the token header is present, and clears `requestTokenContext` in a
  `finally`. Cookie path enforces `hasTrustedSameOrigin` (403) BEFORE `isAdmin()` (CSRF
  defense). Both success paths default `no-store` + `nosniff` without clobbering
  handler-set headers.
- **`lib/admin-tokens.ts`** — `verifyToken` short-circuits on `isWellFormedToken`,
  looks up by SHA-256 hash (plaintext never enters a query param), re-compares with
  `timingSafeEqual` on hex-validated equal-length buffers, enforces `expires_at`, and
  fails closed if the table is missing. All queries are drizzle-parameterized;
  `revokeToken` is `id AND user_id` scoped. Token = `gk_` + base64url(32 random bytes).
  Constant-time throughout.
- **`lib/request-origin.ts`** — `hasTrustedSameOrigin` fails closed (no Origin/Referer →
  reject); trusted XFF host/proto read rightmost only under `TRUST_PROXY=true`;
  default-port normalization is protocol-checked. No downgrade.
- **Token rate limit** — `ADMIN_TOKEN_AUTH_MAX_REQUESTS=120 / 60s` per IP: caps brute
  force without breaking legitimate bulk external-client uploads. Bounded-key map (2000).
- **Lint gates re-verified vs CLAUDE.md** (all green at HEAD):
  - `check-api-auth.ts` — AST scan of every `route.{ts,tsx,js,mjs,cjs}` under
    `api/admin`; requires each HTTP-method export to be `METHOD = withAdminAuth(...)`
    (approved import only); rejects function/class-decl exports, `export *`, and
    export-specifier aliasing; fails closed when a file exports no handler. Matches claim.
  - `check-action-origin.ts` — green: every mutating action stores + early-returns on
    `requireSameOriginAdmin()` (auth.ts uses the approved `hasTrustedSameOrigin` branch).
  - `check-public-route-rate-limit.ts` — AST scan of public routes for mutating
    (POST/PUT/PATCH/DELETE) and expensive GET/HEAD handlers; requires an approved
    `preIncrement*`/`checkAndIncrement*` helper BEFORE mutation/expensive work OR a
    reasoned `@public-no-rate-limit-required`; fails closed on `export *`, unresolved
    aliases, computed dynamic imports, and shadowed rate-limit imports. Matches claim.

## Verified-clean list (do NOT re-derive)

- serve-upload path traversal / symlink / ETag header injection / GET-body TOCTOU:
  clean (SEC4-01 residual is pre-existing + out-of-model).
- advisory-lock name construction: no injection, no 64-char truncation, no info leak.
- migrate.js baseline: no crafted-state DDL-skip privilege bypass; no raw-SQL injection.
- nginx limiter zones: no regex-anchor bypass; `nextimage` is a hardening.
- similar-route / semantic-route: same-origin + rate-limit-before-DB posture intact.
- api-auth token & cookie ordering, CSRF origin gate, cache headers: clean.
- admin-tokens: constant-time compare, hash-only lookup, parameterized, fail-closed.
- request-origin: fail-closed same-origin.
- All three security lint gates: green + faithful to CLAUDE.md.
- No secrets committed in the cycle-3 diff; no plaintext credential handling regressions.

## Cross-reference to cycle-3 security lane
Consistent with cycle-3 (SEC3-01/SEC3-02): the `/_next/image` exemption is now closed by
the dedicated zone; the nginx admin-location allowlist drift note (SEC3-02) is unchanged
and app-layer auth remains independent. No cycle-3 verified-clean item regressed.
