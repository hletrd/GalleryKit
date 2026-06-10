# Run-4 Cycle 2 — security-reviewer + critic + verifier angle

Scope: OWASP-shaped pass over auth surfaces (PAT lifecycle, session middleware,
withAdminAuth), the two security lint gates' own integrity, CSRF/origin posture,
secrets/PII handling in logs, and verification of last cycle's security fixes
(f9d668d9 lr-tokens, 2bf32152 lr-upload parity). Gate-integrity review treats the
scanners themselves as security-critical code per the header comment in
`scripts/check-action-origin.ts:1-6`.

## CONFIRMED FINDINGS

### SEC-R4C2-02 — `@action-origin-exempt` on a MUTATING action silently disables the CSRF gate for `createLrToken`; scanner honors exemption before any mutation analysis (MED / High)
- **Files:**
  - `apps/web/src/app/actions/lr-tokens.ts:21`:
    `/** @action-origin-exempt: token-create is a mutating action protected by requireSameOriginAdmin below */`
  - `apps/web/scripts/check-action-origin.ts:271-275` — `evaluateBody()` checks
    `hasExemptComment()` FIRST and `report.skipped`s the export without ever inspecting
    the body.
- **Why it is a problem:** the exemption comment's own text admits the function is
  mutating (it mints a credential and writes `admin_tokens` + audit log). Today the body
  DOES carry the `requireSameOriginAdmin()` early-return — but because the scanner skips
  exempt-commented exports outright, the gate no longer verifies that. A future refactor
  that drops the guard from `createLrToken` ships with `lint:action-origin` GREEN. That
  is precisely the "gate would lie" failure mode the scanner's C5R-RPL-03 hardening was
  built to prevent (see scanner comment lines 258-263). Documented policy
  (CLAUDE.md "Lint Gates", scanner header, AGENTS.md:32) reserves exemption for
  READ-ONLY exports.
- **Exploit chain (post-drift):** admin visits attacker page → cross-origin POST of the
  server-action endpoint with the victim's cookie → CSRF-minted PAT with
  `lr:upload`/`lr:read`/`lr:delete` scopes exfiltrated... blocked today only by the
  in-body guard the gate no longer checks.
- **Fix (two layers):**
  1. Remove the exempt comment from `createLrToken` — the body already satisfies the
     guard pattern (`const originError = await requireSameOriginAdmin(); if (originError)
     return …` is the first statement), so the scanner passes it WITHOUT the comment.
  2. Harden the scanner: an exempt-commented export whose body contains a DIRECT mutating
     call (`MUTATING_METHOD_NAMES` property calls — insert/update/delete/transaction/
     query/execute/… — or `MUTATING_FUNCTION_NAMES` — logAuditEvent/revalidate*) must
     FAIL with an explicit "exempt comment on mutating body" error instead of skipping.
     Verified against every existing exemption that this is non-breaking: the read-only
     getters (`sales.ts:31` listEntitlements, `admin-backfill.ts:65` getBackfillStatus,
     `tags.ts`, `admin-users.ts`, `settings.ts`, `seo.ts`, `collections.ts:122`
     getSmartCollections, `lr-tokens.ts:103` listLrTokens) use only `db.select`/state
     reads — none trip the mutation detector. `public.ts` is excluded by basename so its
     decorative exempt comments are unaffected. Only the bogus `createLrToken` exemption
     would have tripped it — which is the point. Lock with fixture cases in
     `__tests__/check-action-origin.test.ts`.
- Confidence: High (scanner behavior read from source; non-breaking claim verified
  against every exempt body in the repo).

### SEC-R4C2-05 — Stripe webhook manual-distribution log line drops the sentinel email (LOW / High)
- **File:** `apps/web/src/app/api/stripe/webhook/route.ts:374-379` — the opt-in
  `LOG_PLAINTEXT_DOWNLOAD_TOKENS` line interpolates `customerEmail` (which is `''` when
  Stripe sent no email) instead of `resolvedEmail` (which carries the
  `unknown+<sessionId>@stripe.local` reconciliation sentinel introduced by D-101-04).
- **Failure scenario:** exactly the case the sentinel exists for — a session without a
  customer email — produces `email= token=dl_…` in the operator log; the operator
  workflow ("grep, email the token to the customer") silently loses the pointer that the
  entitlement row carries for manual reconciliation. The DB row is right; the log lies.
- **Fix:** log `resolvedEmail`. One token. Extend `stripe-webhook-source.test.ts`.
- Confidence: High.

## VERIFIED CLEAN (claims checked against code, not comments)
- **Last cycle's SEC fixes hold:** `createLrToken` label now passes
  `sanitizeAdminString` and rejects bidi/zero-width/C0C1 (f9d668d9); `expiresAt` rejects
  Invalid Date and past dates; raw driver errors no longer reach the client. LR route
  user_filename, code-point caps, insert-tail containment all present (2bf32152).
- **PAT crypto:** 32-byte random, SHA-256-at-rest only, constant-time digest compare,
  fail-closed on missing table, last_used_at non-blocking. Brute-force infeasible;
  per-attempt cost = 1 hash + 1 indexed SELECT (bounded).
- **withAdminAuth:** token path requires header + scope; cookie path requires same-origin
  + isAdmin; nosniff/no-store on all paths including success.
- **Download/checkout/webhook:** signature-first webhook; payment_status gate; tier
  allowlist; zero-amount reject; idempotent entitlement; single-use atomic claim;
  traversal + symlink checks on stream path; PII-free error logs. No regression found.
- **proxy.ts:** cookie format pre-check cannot be a bypass (full HMAC verification happens
  in every server action / data accessor via isAdmin()); matcher exclusion of /api is
  documented and compensated by withAdminAuth.
- **No secrets in repo:** spot-checked env usage; `MYSQL_PWD` pattern still used for
  dump/restore; deploy env gitignored.
- **Privacy guards:** `_PrivacySensitiveKeys` still lists all admin-only columns
  including `processing_error`/`failed_at` (data.ts:390) — public surface unaffected by
  COR-R4C2-01's fix.

## HARD-SCOPE check
No finding suggests edit/culling/scoring features. All fixes are delivery-integrity or
gate-integrity work.
