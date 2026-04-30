# Security Review — security-reviewer (Cycle 9)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

- No new critical or high security findings.
- One medium finding (potential information disclosure in error messages).
- Two low findings.

## Verified fixes from prior cycles

All prior security findings confirmed addressed:

1. C8-SEC-01 / AGG8R-01: Stateful `/g` regex in `sanitizeAdminString` — FIXED. Now uses non-`/g` `UNICODE_FORMAT_CHARS` for `.test()`.
2. C7-SEC-01 / AGG7R-03: `sanitizeAdminString` combined helper — FIXED.
3. C6-SEC-01 / AGG6R-04: HANDLER pattern in SQL restore scanner — FIXED.

## New Findings

### C9-SEC-01 (Medium / Medium). `deleteAdminUser` uses raw SQL queries with string-interpolated `id` parameter via `conn.query()` instead of parameterized Drizzle ORM

- Location: `apps/web/src/app/actions/admin-users.ts:204-226`
- The `deleteAdminUser` function uses raw MySQL queries via `conn.query()`:
  ```ts
  await conn.query<(RowDataPacket & { count: number })[]>(
    'SELECT COUNT(*) AS count FROM admin_users'
  );
  const [targetRows] = await conn.query<(RowDataPacket & { id: number })[]>(
    'SELECT id FROM admin_users WHERE id = ? LIMIT 1',
    [id]
  );
  await conn.query('DELETE FROM sessions WHERE user_id = ?', [id]);
  const [deleteResult] = await conn.query<ResultSetHeader>(
    'DELETE FROM admin_users WHERE id = ?',
    [id]
  );
  ```
- While these queries DO use parameterized placeholders (`?`), they bypass Drizzle ORM, which means they are not covered by the "all app queries use Drizzle parameterization" guarantee stated in CLAUDE.md. This is an intentional architectural choice (advisory lock + raw SQL for the last-admin-guard transaction), but it widens the attack surface if future developers copy the pattern without using `?` placeholders.
- The `id` parameter IS validated as a positive integer on line 181, so injection risk is mitigated.
- Severity rationale: The current code is safe due to both parameterization AND input validation. The risk is in pattern propagation — a future developer might copy the `conn.query()` pattern and forget the `?` placeholder.
- Suggested fix: Add a prominent comment block above the raw queries explaining why Drizzle ORM is bypassed (advisory lock transaction) and that all parameters must use `?` placeholders.

### C9-SEC-02 (Low / Low). `tagsString` length check in `uploadImages` uses `.length` — same class as AGG8R-02

- Location: `apps/web/src/app/actions/images.ts:139`
- `tagsString.length > 1000` counts UTF-16 code units. This is a DoS-prevention bound, not a MySQL varchar boundary, so the security impact is minimal (slightly more restrictive, not more permissive).
- Suggested fix: Document the intentional use, or switch to `countCodePoints()` for consistency.

### C9-SEC-03 (Low / Low). `withAdminAuth` wrapper does not verify request origin — relies on `isAdmin()` cookie check only

- Location: `apps/web/src/lib/api-auth.ts`
- The `withAdminAuth` wrapper checks `isAdmin()` (which verifies the session cookie) but does NOT call `hasTrustedSameOrigin()` or `requireSameOriginAdmin()`. This means API routes (`/api/admin/*`) have a weaker CSRF defense than server actions, which all use `requireSameOriginAdmin()`.
- Mitigation: Next.js API routes are protected by the framework's built-in CSRF handling for cookie-based requests. The `/api/admin/db/download` route does its own origin check at line 27.
- Severity is low because the only admin API route (`/api/admin/db/download`) adds its own explicit origin check on top of `withAdminAuth`.
- Suggested fix: Add `hasTrustedSameOrigin` check to `withAdminAuth` for consistency with server actions, or document the current design decision.

## Carry-forward (unchanged — existing deferred backlog)

- D1-01 / D2-08 / D6-09 — CSP `'unsafe-inline'` hardening
- OC1-01 / D6-08 — historical example secrets in git history
