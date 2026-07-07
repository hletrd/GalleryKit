# Security Review — Cycle 9 (2026-07-08)

**Scope:** OWASP Top 10, authn/authz, secrets, injection (SQL/path/formula), SSRF, path
traversal, upload security, privacy leakage (PII/GPS), rate-limit bypass, CSRF/same-origin,
session handling, unsafe deserialization, DoS.

**HEAD reviewed:** `6efd737b3ad5791c662fded4801701992684e54d`

**Method:** manual source review (no automated scanner) across the full inventory listed in
the assignment — `withAdminAuth`/`api-auth.ts`, `admin-tokens.ts`, LR upload route,
`request-origin.ts` (CSRF/same-origin), `rate-limit.ts`/`auth-rate-limit.ts`, `auth.ts`
(login/logout/password change/session fixation), `admin-users.ts` (create/delete, last-admin
guard), `lr-tokens.ts`, `sharing.ts` (share-key entropy, TOCTOU), `serve-upload.ts` (path
traversal/symlinks), OG routes + `og-photo-fetch.ts` (SSRF), `smart-collections.ts` (predicate
→ SQL compiler), `data.ts` privacy-select guards, `search-enrichment-fields.ts` +
`api/search/semantic` + `api/search/similar/[id]` (PII in public search), `csv-escape.ts`,
`sql-like.ts`, `content-security-policy.ts`, `db-actions.ts` restore/backup spawn args,
`process-topic-image.ts`, `gps-exif-strip.ts`/EXIF sanitization (`cleanMetadataString`),
`base56.ts` key generation, redirect targets (open-redirect check), and the three lint gates
(`lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`).

## Summary

This is an extremely mature, heavily-hardened codebase (18+ prior review cycles). I could not
find a new HIGH or CRITICAL, currently-exploitable vulnerability. Every high-risk surface I
inspected (CSRF/origin verification, session fixation, timing-safe login, PAT verification,
path-traversal guards on `serve-upload.ts`, SSRF pinning on the OG photo route, the
`smart-collections.ts` predicate compiler, and the public search PII-select guards) matches
what CLAUDE.md documents and is backed by source-locked tests. One genuine, previously
untracked authorization/incident-response gap is reported below (SEC9-01), rated
Medium/confidence-Medium. Everything else is confirmed clean — see "Checked, no new
findings" for the specific evidence per surface, so this isn't a rubber stamp.

Per the assignment: the PAT `last_used_at`-touched-before-full-route-gates issue is
already tracked as `AGG-C18-10` (peer cycle-18) and is **not** re-reported here.

---

## SEC9-01 — No admin can revoke a *different* admin's Lightroom PAT without deleting that admin's whole account

- **Severity:** Medium
- **Confidence:** Medium (this may be an intentional design choice, but it is inconsistent
  with the documented full-trust admin model and has a real incident-response cost)
- **Files:**
  - `apps/web/src/lib/admin-tokens.ts:183-190` (`listTokensForUser` — `WHERE user_id = ${userId}`)
  - `apps/web/src/lib/admin-tokens.ts:242-250` (`revokeToken` — `DELETE ... WHERE id = ${tokenId} AND user_id = ${opts.userId}`)
  - `apps/web/src/app/actions/lr-tokens.ts:116-143` (`revokeLrToken` calls `revokeToken({ userId: user.id, tokenId })`)
  - `apps/web/src/app/actions/lr-tokens.ts:146-160` (`listLrTokens` calls `listTokensForUser(user.id)`)

- **Threat model:** GalleryKit has no role/capability separation — CLAUDE.md is explicit that
  "any admin can upload, edit, export/restore DB backups, change settings, and manage other
  admins" (including outright deleting another admin's account, `deleteAdminUser` in
  `admin-users.ts`). Lightroom PATs (`gk_...` tokens, scope `lr:upload`/`lr:read`/`lr:delete`)
  are long-lived, session-independent bearer credentials that bypass the same-origin/CSRF
  check entirely (`withAdminAuth({ allowTokenScope })` in `api-auth.ts` explicitly skips
  `hasTrustedSameOrigin` for token-bearing requests) and can be created with no expiry
  (`createLrToken` accepts `expiresAt: null`). Yet `listTokensForUser`/`revokeToken` are hard
  filtered to the CALLING admin's own `user.id` — there is no code path (action, API route, or
  UI) that lets Admin A view or revoke a PAT created by Admin B.

- **Concrete exploit / failure scenario:** A studio has two root admins (A and B). Admin B's
  laptop is compromised, or B's `gk_...` token leaks via a misconfigured Lightroom plugin log,
  or B leaves the team on bad terms while their PAT is still valid. Admin A — despite having
  full administrative authority over the whole system per the documented trust model — has no
  UI or server action to revoke B's specific token. The only remedy available to A is
  `deleteAdminUser(B.id)`, which is destructive (cascades all of B's sessions, and via the
  `admin_tokens.user_id` FK's `ON DELETE CASCADE`, ALL of B's tokens at once) and also removes
  B's legitimate account/login entirely, even if A only wanted to kill one leaked credential
  while B continues using the gallery. During the gap between "B's PAT is known compromised"
  and "someone deletes B's whole account," the leaked token remains a live, scope-gated,
  origin-check-bypassing upload credential that any other admin is powerless to individually
  revoke.

- **Suggested fix:** Add an admin-wide token management surface (or extend the existing one):
  either (a) let any admin list/revoke ANY admin's PATs — consistent with the "any admin
  manages other admins" trust model already used for `deleteAdminUser`/settings/DB
  restore — or (b) if per-owner scoping is an intentional decision, document it explicitly as
  an exception to the full-trust model and give admins a lighter-weight "revoke this user's
  tokens" action (already partially available implicitly via delete-then-recreate-account,
  but that is far more destructive than necessary) so a compromised/departing admin's token
  can be killed without nuking their whole account.

---

## Checked, no new findings (evidence)

- **withAdminAuth / API route wrapper** (`lib/api-auth.ts`): origin check runs before
  `isAdmin()` for the cookie path (AGG9R-02); token path correctly requires `allowTokenScope`
  AND `tokenHasScope`; `NO_STORE_HEADERS`/`nosniff` applied on both success and error paths.
  All 8 route files under `app/api/**` and `app/[locale]/(public)/uploads` /
  `app/uploads/[...path]` were enumerated; every admin-scoped route
  (`api/admin/db/download`, `api/admin/lr/upload`) uses `withAdminAuth`.
- **LR upload route** (`app/api/admin/lr/upload/route.ts`): restore-maintenance double-check
  (entry + post-parse), upload-processing-contract lock held across topic-verify → save →
  insert → enqueue, TOCTOU-safe upload-quota pre-claim with symmetric settle/rollback on every
  exit path, HDR-ingest gate, GPS-strip-then-verify-or-reject, post-commit work isolated so a
  committed row always returns 201 to the external client.
- **CSRF / same-origin** (`lib/request-origin.ts`): fails closed with no `Origin`/`Referer`;
  canonical `BASE_URL`/`site-config.json` origin takes precedence over
  `Host`/`X-Forwarded-Host` so a misconfigured edge cannot redefine "same-origin"; default
  port stripping avoids false-negatives on legitimate same-origin requests.
- **Login / session** (`app/actions/auth.ts`): dummy Argon2 hash precomputed at module init
  for constant-time user-enumeration resistance; per-IP AND per-account (`acct:sha256`
  bucket) rate limiting, both pre-incremented before the expensive Argon2 verify (TOCTOU-safe);
  session insert-then-delete-others in one transaction (fixation-safe); `updatePassword`
  rotates all sessions but re-issues one for the currently active cookie so a stolen session
  isn't accidentally strengthened; secure-cookie flag derived from trusted
  proxy-protocol/NODE_ENV, not raw `X-Forwarded-Proto`.
- **Admin user management** (`app/actions/admin-users.ts`): `createAdminUser` validates
  shape before consuming rate-limit budget; `deleteAdminUser` uses a dedicated
  `GET_LOCK`/transaction to prevent concurrent "last admin" TOCTOU, self-deletion blocked,
  raw SQL is fully parameterized, audit_log rows detached (not deleted) before FK delete.
- **Rate limiting** (`lib/rate-limit.ts`): `getClientIp` only trusts `X-Forwarded-For`/
  `X-Real-IP` when `TRUST_PROXY=true`; hop-count-aware client selection; DB-backed buckets
  back the in-memory fast path across restarts; OG/semantic/similar routes correctly use a
  "charge on protected work, never refund" policy (source-locked by
  `og-route-source-contracts.test.ts` / `og-photo-fallback.test.ts`) so 404/error branches
  cannot be farmed as a free enumeration oracle.
- **`serve-upload.ts` (path traversal):** allowlisted top-level dirs, per-directory extension
  allowlist, per-segment `SAFE_SEGMENT` regex (rejects `.`/`..`/oversized segments),
  `lstat().isSymbolicLink()` rejection, then `realpath()` + `startsWith(resolvedRoot + sep)`
  containment check before ANY open. fd-stat-based ETag prevents a TOCTOU rename race between
  header and body.
- **OG photo route SSRF** (`api/og/photo/[id]/route.tsx`, `lib/og-photo-fetch.ts`): internal
  derivative fetch is pinned to `new URL(BASE_URL).origin` — NEVER `req.url`'s origin — and
  fails closed (fallback response, not attacker-origin fetch) if `BASE_URL` is unparseable;
  admin-configured `og_image_url` fallback redirect is validated same-origin before use
  (open-redirect guard); total-budget + per-attempt timeouts bound the internal fetch chain.
- **`smart-collections.ts` (predicate → SQL compiler):** fully parameterized (Drizzle
  `eq`/`gt`/`inArray`/`sql` template bindings, no string concatenation), strict column
  allowlist, per-column operator/type narrowing at both parse time and compile time
  (`validatePredicateSemantics`, `isScalarValue`), depth/node/children/IN-value budgets
  against AST-based DoS. Public `/c/[slug]` route and `loadMoreSmartCollectionImages` both
  gate on `collection.is_public` before compiling/executing the query; the segment layout
  independently 404s private/missing collections.
- **`data.ts` PII guards:** `adminSelectFields` → `publicSelectFields` /
  `publicMapSelectFields` derivation uses destructure-omit + a compile-time
  `Extract<..., PrivacySensitiveKeys>` guard; cross-checked every column in the `images`
  schema against the guard's `PrivacySensitiveKeys` union — no gap found (the two columns not
  in `adminSelectFields` at all, `share_key` and `blur_data_url`, are intentionally
  fetched via separate narrow queries, not general listing selects).
- **Public search routes** (`api/search/semantic`, `api/search/similar/[id]`): both use the
  shared, compile-time-guarded `searchEnrichmentSelectFields` (no more hand-copied selects);
  both filter `images.processed = true` on every embedding scan and every enrichment query,
  so unprocessed/pending rows cannot leak metadata through search; body-size/Content-Length/
  chunked-encoding/JSON-shape validation precedes any DB work; rate-limit is charged (never
  refunded) once protected work begins.
- **Sharing** (`app/actions/sharing.ts`): share keys generated via `generateBase56` —
  `crypto.randomBytes` + rejection sampling (no modulo bias), ~58 bits of entropy for a
  10-char key; photo/group share creation and revocation use conditional
  `WHERE ... share_key = oldKey` / `IS NULL` updates to close TOCTOU races against concurrent
  admins; group creation requires every image to exist AND be `processed` before a share key
  is minted.
- **CSV export** (`lib/csv-escape.ts`): C0/C1 strip, Unicode bidi/zero-width strip (shared
  `UNICODE_FORMAT_CHARS` from `validation.ts`), CR/LF collapse before the formula-prefix
  check (so a CRLF-then-`=` payload can't dodge the leading-whitespace regex), OWASP
  formula-injection quoting, and quote-doubling — all in the correct order.
- **LIKE-pattern escaping** (`lib/sql-like.ts`): `%`/`_`/`!` (the escape char itself) all
  escaped before being wrapped in `%...%` with an explicit `ESCAPE '!'` clause.
- **DB restore/backup child processes** (`db-actions.ts`): `mysqldump`/`mysql`/migrate
  children all spawned with `spawn(cmd, [argArray])` (no shell), minimal explicit env
  (credentials via `MYSQL_PWD`/`MYSQL_USER`/etc., not CLI flags, so they don't leak via
  `/proc/<pid>/cmdline`), and a raw-SQL dangerous-statement scan runs over the uploaded dump
  before it's ever piped to `mysql`.
- **EXIF metadata sanitization** (`process-image.ts`): confirmed `camera_model`/`lens_model`
  route through `cleanString()` → `cleanMetadataString()`, which strips the same
  `UNICODE_FORMAT_CHARS` bidi/zero-width set used for admin-authored strings — EXIF-origin
  data (which is NOT admin-authored and could come from a manipulated/downloaded photo) is
  NOT a bidi/Trojan-Source injection gap into the photo viewer, JSON-LD, or OG cards.
- **CSP** (`lib/content-security-policy.ts`): production `script-src` is nonce-only (no
  `unsafe-inline`/`unsafe-eval`); the `style-src 'unsafe-inline'` allowance is a pre-existing,
  explicitly-commented, previously-reviewed trade-off (Next/font + Tailwind runtime styles),
  not a new gap, so not re-reported.
- **Open redirect check:** the only non-`localizePath`/`localizeUrl` `redirect()` call found
  (`[topic]/page.tsx` canonical-slug redirect) builds its destination from the DB-resolved
  canonical topic slug via `localizePath` (a relative path), not from user-controlled input —
  no open-redirect primitive.
- **Topic cover images** (`process-topic-image.ts`): output filenames are server-generated
  `randomUUID().webp`, never derived from the uploaded file's name — no path-traversal
  surface on write; `deleteTopicImage` validates via `isValidFilename` before unlink.
- **Static guard gates:** `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`
  fixture tests were read and their coverage (every `app/api/admin/**` route,
  every `app/actions/**` export, every non-admin `app/api/**` mutating/expensive-GET route)
  matches the current file inventory with no un-scanned route file found.

## Not re-reported (already tracked)

- **AGG-C18-10** (peer cycle-18): PAT `last_used_at` touched before the LR upload route's
  full body-validation gates run. Current code (`app/api/admin/lr/upload/route.ts:160`) calls
  `markAdminAuthTokenUsed` after restore-maintenance/content-length/upload-quota/multipart-slot
  checks but before multipart body parsing/filename/topic validation — consistent with the
  already-tracked finding; not re-reported per instructions.
