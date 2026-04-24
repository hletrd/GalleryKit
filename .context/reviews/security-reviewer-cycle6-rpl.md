# Security Reviewer — Cycle 6 RPL

Date: 2026-04-23. Reviewer role: security-reviewer (OWASP top 10, secrets,
unsafe patterns, auth/authz).

## Scope

Whole-repo scan with focus on the attack surface: auth/session, server
actions, rate limiting, restore pipeline, uploads, public API, and i18n
rewrites. Cross-referenced against cycle-5-rpl security findings (all
resolved) and the deferred cycle-5 items.

## Confirmed good postures (regression check)

- Session secret hard-fails in production without `SESSION_SECRET` env
  (`session.ts:30-36`). Dev-only DB fallback with `INSERT IGNORE + refetch`.
- Session token uses HMAC-SHA256 with `timingSafeEqual`. Token split check
  uses exactly 3 parts (`session.ts:99-118`).
- `requireSameOriginAdmin` centralizes defense-in-depth Origin/Referer
  reconciliation across all mutating server actions
  (`action-guards.ts:37-44`). Verified wired in `images.ts`, `auth.ts`,
  `sharing.ts`, `topics.ts`, `tags.ts`, `seo.ts`, `settings.ts`,
  `admin-users.ts`, `db-actions.ts`.
- Argon2id hashing with precomputed dummy-hash timing-equalization against
  username-enumeration (`auth.ts:63-68`).
- Pre-increment rate-limit pattern across login/password-change/share/search.
  Symmetric in-memory rollback on error paths.
- SQL restore scanner now blocks GRANT/REVOKE/RENAME USER/CREATE USER/
  ALTER USER/SET PASSWORD/DROP DATABASE/CREATE DATABASE/CALL/LOAD DATA/
  INTO OUTFILE/INTO DUMPFILE/SYSTEM/SHUTDOWN/SOURCE/CREATE TRIGGER/
  FUNCTION/PROCEDURE/EVENT/ALTER EVENT/DELIMITER/INSTALL PLUGIN/SET GLOBAL/
  CREATE SERVER/RENAME TABLE/CREATE VIEW/PREPARE/EXECUTE/DEALLOCATE/SET
  @var=0x/binary/X'.../SET @@global
  (`sql-restore-scan.ts:1-48`).
- CSV export escapes formula-injection characters and strips control
  characters (`db-actions.ts:27-41`).
- Path traversal mitigation in `serve-upload.ts` — allow-list of dirs,
  `SAFE_SEGMENT` regex, `resolvedPath.startsWith(...)` containment, symlink
  rejection.
- Upload filenames use `crypto.randomUUID()`; no user-controlled on-disk
  names.
- MYSQL_PWD env var for mysqldump/restore — not on CLI (`db-actions.ts:153,
  388`).

## New findings

### S6-01 — `requireSameOriginAdmin` lacks an integration test that injects a mismatched Origin header
- File: `apps/web/src/__tests__/action-guards.test.ts`.
- Severity: LOW. Confidence: HIGH.
- Impact: a refactor that e.g. dropped `hasTrustedSameOrigin` from the
  guard would not be caught by unit tests alone. There is coverage in
  `request-origin.test.ts` for the primitive, but no combined test that
  asserts mutating actions reject cross-origin requests end-to-end.
- Fix: add a Playwright e2e test that submits a server-action form with a
  mismatched `Origin: https://attacker.example` header to at least one
  mutating endpoint (e.g. `/admin/dashboard` → delete selected image) and
  asserts the `unauthorized` error. Current e2e tests cover happy-path
  only.

### S6-02 — `login` DB-backed rate-limit gate uses same `ip` key after account-lockout branch, but fallback on DB unavailable relies solely on in-memory Map
- File: `apps/web/src/app/actions/auth.ts:108-131`.
- Severity: LOW. Confidence: MEDIUM.
- When DB is unreachable, in-memory Map is the only authority. The
  account-scoped bucket (`acct:<sha256>`) is DB-backed ONLY — the in-memory
  Map covers IP-only. If the DB is down and an attacker targets a single
  account from many IPs, each IP burns only 5 attempts of the in-memory
  limit; the account-scoped account lockout is effectively disabled.
- This is documented in the "DB unavailable — rely on in-memory Map" catch
  comment, but the account-scoped bucket has no in-memory mirror. That's
  by design per `auth-rate-limit.ts` (password_change has its own in-memory
  Map; account-scoped does not).
- Fix: add a per-account in-memory fallback Map scoped by the username
  hash, pruned on the same schedule as `loginRateLimit`. Small addition.
  Defense-in-depth during DB outage. Current posture is acceptable for
  a personal gallery; noted for future hardening.

### S6-03 — `exportImagesCsv` DOES apply same-origin check but has NO account-scoped rate limit
- File: `apps/web/src/app/[locale]/admin/db-actions.ts:43-110`.
- Severity: LOW. Confidence: MEDIUM.
- Only admin access is gated; an authenticated admin can download unlimited
  CSVs. Because it caps at 50K rows AND requires admin, this is acceptable.
- However, if an admin session is hijacked, the attacker could exfil 50K
  rows per call. Adding a per-IP rate limit on CSV export would raise the
  bar. Currently deferred.
- Fix: add `checkRateLimit(ip, 'csv_export', 5, 60_000)` to throttle
  legitimate admin downloads to 5/minute. Defense-in-depth.

### S6-04 — `restoreDatabase` header-regex allows leading CR/LF which Node's `Buffer.from` normalizes
- File: `apps/web/src/app/[locale]/admin/db-actions.ts:330-343`.
- Severity: LOW. Confidence: MEDIUM.
- The header check is `/^(--)|(CREATE\s)|(INSERT\s)|(DROP\s)|(SET\s)|(\/\*!)/.test(headerBytes.trimStart())`.
  `trimStart()` strips whitespace including CR/LF from UTF-8 string. Any
  leading comment of the form `/*! ... */` passes as `/\*!`. The test
  `/\/\*!/` without version gating allows an attacker-controlled conditional
  comment header (e.g., `/*!50000 GRANT ALL ... */`). However, the full-file
  scan catches any dangerous SQL inside conditional comments
  (`sql-restore-scan.ts:57-75` explicitly extracts inner content), so this
  is already mitigated.
- Separate concern: the header regex accepts `INSERT` as a valid header —
  legitimate mysqldump output always begins with `--` or `/*!`, never with
  a raw `INSERT`. Tightening the regex to require `^(--|\/\*!|SET)` would
  reject crafted headers that try to hide malicious content after an
  innocent-looking `INSERT` preamble. But since the scanner reads the full
  file and blocks dangerous content, tightening the header doesn't change
  the effective security. Observational.

### S6-05 — `loadMoreImages` and `searchImagesAction` accept any caller without origin check
- File: `apps/web/src/app/actions/public.ts:11-29`, `apps/web/src/app/actions/public.ts:31-95`.
- Severity: LOW. Confidence: HIGH.
- These are intentionally exempted from the scanner (`public.ts` in
  `EXCLUDED_ACTION_FILENAMES` at `check-action-origin.ts:38`). They are
  read-only and serve public pages. However:
  - They are still exposed via Next.js server actions (POST requests with
    the `next-action` header). An attacker could invoke them cross-origin
    via CSRF to burn rate-limit budget from a victim's IP if the victim
    visits the attacker's page. Because these actions RETURN DATA to the
    victim's page (not attacker's — CORS blocks reading), this is bounded.
  - Impact: attacker can increment `searchRateLimit` on victim's IP,
    degrading the victim's ability to use the search UI. The Fast-path
    check will block subsequent legit searches until window expiry.
- Fix: add `hasTrustedSameOrigin` to both functions. They'd fail-closed,
  returning `[]` (same as current overflow behavior). That preserves the
  public-read contract while mitigating drive-by rate-limit burn.
  Alternative: leave as is (the impact is a 60s denial of search from
  attacker's page, not account takeover). Acceptable for a personal
  gallery. Marked observational.

### S6-06 — `check-action-origin.ts::discoverActionFiles` does NOT recurse into `apps/web/src/app/actions/` subdirectories
- File: `apps/web/scripts/check-action-origin.ts:46-62`.
- Severity: LOW. Confidence: HIGH.
- Current scanner uses `fs.readdirSync(actionsDir, { withFileTypes: true })`
  with a single flat iteration. If a future refactor creates
  `apps/web/src/app/actions/admin/user-management.ts`, the scanner would
  silently skip it because `entry.isFile()` returns false for the
  subdirectory and the code does not recurse.
- Fix: recurse into subdirectories. Trivial TypeScript change. Paired with
  a test fixture directory to lock in behavior.

### S6-07 — `sharing.ts::createGroupShareLink` FOREIGN KEY error recovery doesn't rollback DB rate limit
- File: `apps/web/src/app/actions/sharing.ts:260-272`.
- Severity: LOW. Confidence: MEDIUM.
- On `ER_NO_REFERENCED_ROW_2`, the function returns `imagesNotFound`
  without rolling back the DB-backed rate limit counter incremented at
  line 214. If a legit admin deletes an image between their selection
  and submit, they pay one counted share-creation attempt even though
  the action didn't complete. Small drift.
- Fix: on any retry-exhausted or FK-error path, call
  `decrementRateLimit(ip, 'share_group', SHARE_RATE_LIMIT_WINDOW_MS)`.
  Cosmetic symmetry.

### S6-08 — `viewCountBuffer` dropped-increment warnings could be an attacker fingerprint
- File: `apps/web/src/lib/data.ts:34`, `apps/web/src/lib/data.ts:73`.
- Severity: LOW. Confidence: LOW.
- The `console.warn` messages log the groupId: `"dropping increment for
  group 42"`. If stdout is piped to a public log aggregator, this reveals
  internal shared-group IDs which are otherwise never exposed publicly
  (public shares use `key`, not `id`). Mild information disclosure.
- Fix: replace `group ${groupId}` with `group (id redacted)` in the warn
  message. Tiny.

## Cycle-5 carry-forward (security items)

All resolved. No regressions.

## Summary

- **0 HIGH / MEDIUM / CRITICAL** security findings.
- **8 LOW** findings, mostly defense-in-depth hardening and observational
  information-leak concerns. Most actionable: **S6-06** (scanner
  subdirectory recursion). None pose a direct compromise path.
- The overall security posture is excellent. Recent SQL-scanner expansion
  (CALL/REVOKE/RENAME USER), pre-increment rate limits, and same-origin
  fan-out are working as designed.
