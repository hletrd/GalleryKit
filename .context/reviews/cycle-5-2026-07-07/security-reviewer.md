# Run-10 Cycle 5/100 — Security Review (2026-07-07)

**Lane:** security-reviewer. **Start HEAD:** `d9bcbf4c` (clean tree, == origin/master).
**Scope:** comprehensive OWASP-oriented pass over the entire repo — authn/authz, secrets,
injection (SQL/command/header), SSRF, path traversal, unsafe deserialization, CSRF/same-origin,
rate-limit bypass, XSS, and privacy/PII leakage. Read the cycle-4 aggregate + carry-forward
register first so verified-clean items are not re-derived and open deferrals are not re-reported.

## Bottom line

**NO new CRIT / HIGH / MED / LOW security vulnerability found.** One INFO-level
documentation drift (a self-contradicting security-rationale comment; the enforced posture
is correct and test-locked). The security surface is mature — it has been through many
review cycles and every high-value sink I examined is hardened, layered, and test-pinned.
The cycle-4 code changes (config micro-cache invalidation, single-writer re-acquire loop,
serve-upload ETag extraction, health-probe coalescing, SW LRU, migrate.js DML guard)
introduced **no** security regression on the paths I traced.

## NEW findings

### SEC5-01 — INFO / High confidence / Confirmed — stale security-rationale comment count in `rate-limit.ts`
- **File:** `apps/web/src/lib/rate-limit.ts:311-312` (the `rollbackOgAttempt` JSDoc) vs the
  same file's own header at `:55-56`.
- **Category:** documentation accuracy on a security-control rationale (A09-adjacent /
  maintainability of an anti-enumeration invariant). NOT an exploitable issue.
- **What:** Two comments in the same file contradict each other about the per-photo OG route's
  rollback count. Line 56 states `og-photo-fallback.test.ts — exactly one, pre-DB`; line 312
  states `(photo route — exactly two, both pre-DB)`. The **enforced** behavior is correct and
  matches line 56: `apps/web/src/app/api/og/photo/[id]/route.tsx` contains exactly ONE
  `rollbackOgAttempt(ip)` call (line 109, in the pre-DB `imageId === null` branch), and
  `apps/web/src/__tests__/og-photo-fallback.test.ts:65` asserts `rollbackOccurrences === 1`
  with `:74` asserting no rollback after the DB call. So the charged-404 anti-enumeration
  contract (SEC-R4C17-01 / AGG8F-01) is intact and test-locked; only the `:312` comment is stale.
- **Exploit scenario:** none directly. The residual risk is maintainer-facing: a future editor
  reconciling the route to the wrong comment could ADD a second rollback (turning a post-DB
  failure branch into a refund) and reintroduce the free image-id-enumeration / unmetered-DB
  oracle the charged-404 policy exists to prevent. The test would catch it, but the comment
  should not point the wrong way.
- **Suggested fix:** change `:312` "exactly two, both pre-DB" → "exactly one, pre-DB" to match
  the route, the test, and the file's own `:56` statement.
- **Confidence:** High (verified against route source + test assertions).

## Deferred-item exit-criteria status (carry-forward register check)

- **SEC4-03** (`O_NOFOLLOW`/fd-realpath re-check on serve-upload / db-download) — exit criterion
  is "storage-backend multi-writer/non-local (C2-27) OR threat model adds hostile-local-writer."
  **NOT fired.** Storage is still local-filesystem-only (C2-27 quarantine unchanged), and no
  hostile-local-writer is in the threat model. The current containment on both file-serving
  paths remains correct for the shipped single-trust-domain model: `serve-upload.ts` does
  `lstat`→reject-symlink→`realpath`→`startsWith(resolvedRoot + sep)`, then opens the fd and
  stats THROUGH it for the GET body (rename-race safe); `api/admin/db/download/route.ts` does
  `realpath`→`startsWith(resolvedBackupsDir + sep)` then streams from the validated handle.
  Both are TOCTOU-safe for the trusted-writer model. Leave SEC4-03 deferred; do not re-report.
- No other security-tagged carry-forward row has a fired exit criterion this cycle.

## Verified clean (examined this cycle — do not re-derive)

**Authn / session / tokens**
- `lib/api-auth.ts` — `withAdminAuth` enforces token-scope path (rate-limited pre-verify by IP,
  `tokenHasScope` gate, request-scoped token context cleared in `finally`) OR same-origin +
  `isAdmin()`; adds no-store + nosniff on every path incl. token responses. No bypass.
- `lib/admin-tokens.ts` — `gk_`+base64url(32B); only SHA-256 hash persisted; `verifyToken`
  hashes locally (plaintext never a query param), timing-safe `tokenHashesEqual`, `expires_at`
  enforced, fails closed on missing table; parameterized `db.execute(sql\`…\`)` throughout.
- `lib/session.ts` — HMAC-SHA256 token, `timingSafeEqual` before shape asserts (no timing
  oracle), 24h age bound (incl. negative-age reject), stored as SHA-256 hash, prod refuses
  DB-fallback secret. `app/actions/auth.ts` — dummy-hash timing equalization, pre-increment
  TOCTOU rate-limit (IP + account bucket), no-rollback-on-infra-error posture, session-fixation
  delete-others in txn, Secure cookie via trusted-proxy protocol. `proxy.ts` — presence/format
  cookie gate on `/[locale]/admin/*`, API routes excluded (documented, each carries own auth).
- All `src/app/api/admin/**/route.ts(x)` wrap `withAdminAuth` (scripted check: zero missing).

**Injection / SSRF / traversal / header**
- `lib/smart-collections.ts` — allowlisted columns, depth/node/child/IN caps, Drizzle param
  binding for ALL values, per-column operator+type narrowing at write-time (`isScalarValue`
  rejects objects/arrays/NaN that mysql2 would expand into SQL fragments), tag predicate is a
  parameterized subquery. `lib/sql-like.ts` — `ESCAPE '!'` with `!%_` escaping.
- `og/photo/[id]/route.tsx` + `lib/og-photo-fetch.ts` — internal derivative fetch PINNED to
  `new URL(BASE_URL).origin` (never request-derived Host), fails closed on unparseable canonical
  URL, per-attempt 3.5s timeout under a 10s chain budget, 1 MB cap; fallback redirect validated
  same-origin (no open redirect). Rate-limited, charged-404.
- `lib/sql-restore-scan.ts` — 4 sanitizer variants (comment/literal/conditional-comment
  stripping), app-backup DROP allowlist masked before the destructive-SQL denylist, write-target
  identifier allowlist + schema-qualified rejection; blocks GRANT/REVOKE/CREATE USER/DEFINER
  routines/LOAD DATA/INTO OUTFILE/CALL/HANDLER/DO/PREPARE/etc.
- `admin/db-actions.ts` — `spawn('mysqldump'|'mysql', [array args])` (no `shell`), creds via
  `MYSQL_PWD`/`MYSQL_*` env (not `/proc/cmdline`), HOME excluded, `--one-database`, stderr
  redacted via `sanitizeStderr(data, DB_PASSWORD, [...])`. `api/admin/db/download` — strict
  `BACKUP_FILENAME_PATTERN` (anchored, no `"`/CRLF) so the `Content-Disposition` filename is
  injection-safe; realpath containment; audit-logged.
- `lib/validation.ts` — Unicode bidi/zero-width rejection (`UNICODE_FORMAT_CHARS`), slug/alias/
  filename allowlists, `safeInsertId` BigInt-overflow guard.

**XSS / CSP**
- All 8 `dangerouslySetInnerHTML` sites are JSON-LD and route through `safeJsonLd`
  (`<`/`>`/U+2028/U+2029 escaped → no `</script>` breakout). No other raw-HTML sinks; no
  `eval`/`new Function`/`child_process` outside the sanctioned db-actions spawn.
- `content-security-policy.ts` / `proxy.ts` — per-request nonce, `object-src 'none'`,
  `base-uri 'self'`, `frame-ancestors 'self'`, `form-action 'self'`; `buildCspSafely` degrades
  (drops image base) instead of 500ing on malformed `IMAGE_BASE_URL`; GA hosts gated on a valid
  measurement id.

**Privacy / PII**
- `lib/data.ts` — `publicSelectFields`/`publicMapSelectFields` derived from `adminSelectFields`
  by explicit omission; `_PrivacySensitiveKeys` (21-key union) compile-guard + map guard +
  large-payload guard. Schema diff: the only `images` column absent from `adminSelectFields`
  is `blur_data_url` (intentionally fetched per-photo) — no orphan PII column can leak via the
  rest-spread. `lib/search-enrichment-fields.ts` — shared select carries a tsc-time
  `Extract<…, PrivacySensitiveKeys>` guard for the public semantic/similar routes; semantic
  route strips similarity scores from the response.
- `lib/gps-exif-strip.ts` — bounds-checked container-aware byte surgery (JPEG/TIFF/HEIF/WebP),
  returns null → caller re-encode fallback; wired on BOTH browser and LR upload paths when
  `strip_gps_on_upload` is on (LR path also fails the upload 422 if strip returns false).

**Rate-limit / CSRF / config**
- `lib/rate-limit.ts` — pre-increment-then-check across login/search/OG/share/feed/semantic/
  token buckets, bounded maps, `getClientIp` only trusts XFF under `TRUST_PROXY` (right-anchored
  hop selection), DB-backed login/password buckets. `updateGallerySettings` — `requireSameOriginAdmin`,
  admin mutation barrier (restore fence), upload-contract lock, and `invalidateDetachedGalleryConfigCache()`
  correctly called AFTER commit (C4-07) — no stale-config write window and no new bypass.
- `api/admin/lr/upload/route.ts` — token scope `lr:upload`, restore re-checks (pre + post
  multipart), contract lock over topic-verify→save→insert, disk pre-check on `bavail`, per-window
  quota with idempotent settle on every early return, GPS strip + HDR-ingest gate mirrored from
  browser path.

## NEW-finding counts

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH     | 0 |
| MEDIUM   | 0 |
| LOW      | 0 |
| INFO     | 1 (SEC5-01 — stale rollback-count comment; posture correct + test-locked) |

Deferred exit-criteria fired this cycle: **none** (SEC4-03 remains correctly deferred).
