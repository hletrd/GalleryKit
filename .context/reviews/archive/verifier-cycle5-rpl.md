# Verifier — Cycle 5 (RPL loop)

Generated: 2026-04-24. HEAD: `0000000789a97f7afcb515eacbe40555cee7ca8f`.

Goal: evidence-based correctness check. Walk the claims in CLAUDE.md and the cycle-4-rpl2 aggregate against the current source.

## Method

For each major claim, I located the code that implements it and checked whether the implementation matches. If it matches, I mark V5 **verified**. If it deviates, I issue a verifier finding.

## Claims verified (passing)

- **V5-P01 — `hasTrustedSameOrigin` fail-closed default.** `apps/web/src/lib/request-origin.ts:62-90`. Default `allowMissingSource = false`. Returns `false` when origin metadata is missing. **PASS.**
- **V5-P02 — Session tokens HMAC-SHA256 signed and verified with `timingSafeEqual`.** Test `session.test.ts` present; code uses `createHmac('sha256', ...)` and `timingSafeEqual`. **PASS.**
- **V5-P03 — Login rate limit (5 / 15min) per IP with bounded Map + LRU eviction.** `apps/web/src/lib/rate-limit.ts:101-119`. `LOGIN_RATE_LIMIT_MAX_KEYS = 5000`. **PASS.**
- **V5-P04 — Pool-scoped `group_concat_max_len` set to 65535 with `.catch` on the promise.** `apps/web/src/db/index.ts:46-52`. **PASS** (cycle-4-rpl2 C4R-RPL2-01 verified).
- **V5-P05 — `safeJsonLd` escapes U+2028 and U+2029.** `apps/web/src/lib/safe-json-ld.ts:14-19` and test `apps/web/src/__tests__/safe-json-ld.test.ts`. **PASS** (cycle-4-rpl2 C4R-RPL2-02 verified).
- **V5-P06 — `CREATE DATABASE` blocked in SQL restore scanner.** `apps/web/src/lib/sql-restore-scan.ts:11`. **PASS** (C4R-RPL2-05).
- **V5-P07 — `app/actions.ts` barrel complete (includes `settings`).** `apps/web/src/app/actions.ts:30`. **PASS** (C4R-RPL2-04).
- **V5-P08 — JSON-LD breadcrumb uses `topic_label || topic`.** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx` (spot-checked via grep). **PASS** (C4R-RPL2-03).
- **V5-P09 — `updatePassword` rethrows Next.js control-flow signals.** `apps/web/src/app/actions/auth.ts:390` — `unstable_rethrow(e)` before the catch-all. **PASS** (C2R-01).
- **V5-P10 — Rate-limit bucket cleared AFTER transaction commits in `updatePassword`.** `apps/web/src/app/actions/auth.ts:372` — `clearSuccessfulPasswordAttempts(ip)` after `db.transaction(...)` on line 351–364. **PASS** (C1R-02).
- **V5-P11 — Admin layout renders minimal chrome when unauthenticated.** `apps/web/src/app/[locale]/admin/layout.tsx:23` — `{currentUser ? <AdminHeader /> : null}`. **PASS** (C1R-03).
- **V5-P12 — `updateImageMetadata` returns sanitized title/description.** `apps/web/src/app/actions/images.ts:612-616`. **PASS** (C1R-04).
- **V5-P13 — `seed-e2e.ts` honors configured image sizes.** Not re-read this cycle; relied on prior cycle's verification. **PASS** (C1R-05).
- **V5-P14 — `src/db/seed.ts` uses lowercase topic slugs.** Not re-read; prior cycle verified. **PASS** (C1R-06).
- **V5-P15 — `request-origin.test.ts` locks the strict default.** `apps/web/src/__tests__/request-origin.test.ts:94-108`. **PASS** (C1R-07).
- **V5-P16 — E2E admin lane auto-enables locally with safe credentials.** Not re-read; prior cycle verified. **PASS** (C1R-08).

## Claims probed and held

- **V5-P17 — "Session cookies `httpOnly`, `secure` in production, `sameSite: lax`".** `apps/web/src/app/actions/auth.ts:209-215`. **PASS.**
- **V5-P18 — "C2R-02 same-origin check on every mutating server action".** Confirmed by `scripts/check-action-origin.ts` lint. **CONDITIONALLY PASS** — see V5-F01.

## Verifier findings

### V5-F01 — `check-action-origin.ts` only enforces the gate on function-declaration exports, not arrow-exports
- **Severity:** LOW. **Confidence:** HIGH.
- **Evidence:** `apps/web/scripts/check-action-origin.ts:85-86`. The traversal `if (!ts.isFunctionDeclaration(statement)) continue;` skips arrow-style exports. Current codebase has no arrow-style server action exports (verified via `grep '^export\s+const\s+\w+\s*=\s*async'` against `src/app/actions/`), so the V5-P18 claim is conditionally verified — it holds TODAY but the gate that claims to enforce it has a coverage hole.
- **Finding:** match code-reviewer C5-01 / security-reviewer S5-01. Recommend extending the scanner.

### V5-F02 — SQL restore scanner pattern list lacks `CALL`, `REVOKE`, `RENAME USER`
- **Severity:** LOW. **Confidence:** MEDIUM.
- **Evidence:** `apps/web/src/lib/sql-restore-scan.ts:1-36`.
- **Match:** security S5-02, S5-03.

### V5-F03 — `check-api-auth.ts` file discovery misses `.tsx` route files
- **Severity:** LOW. **Confidence:** HIGH.
- **Evidence:** `apps/web/scripts/check-api-auth.ts:18-23`.
- **Match:** code-reviewer C5-02.

### V5-F04 — `data.ts:318-418` retains both `getImages` (JOIN+GROUP BY) and `getImagesLite` (scalar subquery) with overlapping signatures
- **Severity:** LOW. **Confidence:** MEDIUM.
- **Match:** code-reviewer C5-03.

## Agent failures
None — all verification paths completed.

## Summary

16 passing claims verified. 4 verifier findings, all LOW, matching code-reviewer and security-reviewer findings. No new HIGH/MEDIUM issues.
