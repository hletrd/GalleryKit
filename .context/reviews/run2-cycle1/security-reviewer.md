# Security Reviewer — Run-2 Cycle 1 (HEAD eaee58dc)

Angle: OWASP, authn/authz, injection, path traversal, info disclosure, secrets. Faithful-delivery surface.

## SEC-01 — `triggerBackfill` returns raw runner error message to the client (LOW, Medium confidence)

**File:** `apps/web/src/app/actions/admin-backfill.ts:59-61` returns `{ status: 'error', error: result.reason }` where `result.reason` is the raw `err.message` from `triggerAdminBackfill` (`admin-backfill-runner.ts:383-384` → `err instanceof Error ? err.message : String(err)`). Similarly `getBackfillStatus` (line 79-81) returns the raw `err.message`.

**Why:** A backfill trigger failure (e.g. DB error, advisory-lock query failure) surfaces the raw error string to the admin client. **Exposure is bounded:** both functions are gated behind `isAdmin()` (admin-backfill.ts:34, 72), so only an authenticated admin can see the message. With multiple-root-admin trust model (all admins fully trusted per CLAUDE.md), this is not a privilege-boundary leak. The risk is only generic error-detail-in-response hygiene (CWE-209) on an admin-only surface. **Severity LOW** — admin-only, trusted audience. **Optional fix:** return a generic `t('backfillFailed')` to the client and `console.error` the detail server-side, matching how `handleBackfill` already falls back to a generic toast. Not blocking.

## SEC-02 — Auth + same-origin gating on the new server actions — VERIFIED CORRECT

- `triggerBackfill`: checks `isAdmin()` THEN stores `requireSameOriginAdmin()` result and early-returns (admin-backfill.ts:34-38). Passes `lint:action-origin`.
- `getBackfillStatus`: read-only, carries `@action-origin-exempt: read-only status check` comment (line 64). Passes the scanner. Correctly does NOT mutate.
- No new `app/api/admin/**/route.*` files added; `lint:api-auth` clean.
- Audit logging present: `triggerBackfill` logs `admin_backfill_triggered` with the acting user id (admin-backfill.ts:43-52). Good — destructive/expensive op is audited.

## SEC-03 — Backfill file-path handling — VERIFIED SAFE

`admin-backfill-runner.ts:172` resolves the original via `resolveOriginalUploadPath(row.filename_original)` where `filename_original` is a DB-stored UUID-based name (no user-controlled path component — uploads use `crypto.randomUUID()` per CLAUDE.md). `fs.access` then `sharp(originalPath, …)`. No path traversal vector — the filename comes from the DB, not the request. Verified.

## SEC-04 — Analytics queries — VERIFIED NO INJECTION

`analytics-data.ts` uses Drizzle query builder (`.select().from().innerJoin().where()`) with parameterized `eq`/`gte`/`count`. The only raw `sql` is `desc(sql\`viewCount\`)` referencing a SELECT alias — a literal, no untrusted input. The `window` param is validated against an allowlist in `page.tsx:13-16` before reaching the query. No injection. Share `key` is read from DB (`sharedGroups.key`), never concatenated. Verified.

## SEC-05 — Admin analytics surfaces raw share keys — ACCEPTABLE (INFO)

`analytics-client.tsx:222-228` renders `/g/${row.shareKey}` with the raw key visible. Share keys are public URL segments (anyone with the link can view). Showing them on the admin-only analytics page is appropriate (the admin owns these links). No finding.

## Clean
- No secrets introduced in the diff.
- `forceSrgbDerivatives` is a config boolean, not PII (trace B in critic-verifier-tracer).
- `avif_10bit` public exposure is an intentional, documented design decision (data.ts:252-253), not a leak. (Its STALENESS via the script is a correctness bug — see ARCH-01 — not a security issue.)
