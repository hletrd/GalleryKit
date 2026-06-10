# Run-4 Cycle 3 — security-reviewer + critic + verifier angle

Scope: auth core (`api-auth.ts`, `admin-tokens.ts`, `session.ts`,
`request-origin.ts`, `proxy.ts`), all 8 API routes, action guards posture, the
three lint gates' coverage boundaries, PII/log surfaces in the Stripe flow,
public-action exemption sweep, secrets handling spot-check.

## Findings

### SEC-R4C3-04 — `withAdminAuth` token path skips the no-store/no-cache response defaults
- **Severity/Confidence:** LOW-MED / High
- **File:** `apps/web/src/lib/api-auth.ts:63-79` (token branch) vs 102-109
  (cookie branch).
- **Why it's a problem:** C7-SEC-02 added defense-in-depth defaults on the
  cookie-auth success path — if the handler did not set them, the wrapper adds
  `Cache-Control: no-store, no-cache, must-revalidate` + `Pragma: no-cache`
  (and nosniff). The PAT token branch (added later, US-P53) returns the handler
  response after adding ONLY `X-Content-Type-Options`. Today the only
  token-scoped route (`/api/admin/lr/upload`) sets `NO_CACHE` itself, so there
  is no live leak — but the wrapper's contract is asymmetric: the first
  `lr:read` route (the tokens UI already grants that scope; plan-276 DEF-R4C2-01
  documents it as the next consumer) that forgets its own Cache-Control will
  serve admin-token-authenticated data that intermediaries may cache.
- **Failure scenario:** future `GET /api/admin/lr/images` under `allowTokenScope:
  'lr:read'` returns gallery metadata including admin-only fields; a corporate
  proxy or misconfigured CDN caches the 200 because no Cache-Control was emitted;
  another client behind the same proxy replays it without a token.
- **Fix:** mirror the cookie-path defaults onto the token-path response (set
  Cache-Control + Pragma when absent, keep nosniff). One-line-class change,
  verified non-breaking: the only existing token route sets its own headers,
  which the `has()` guard preserves.
- **Class:** confirmed asymmetry; latent (not exploitable today).

### Cross-checked from other angles (security-relevant)
- **COR-R4C3-02** (webhook dup-key race re-mints a plaintext-token log line whose
  hash is unstored): the plaintext-token logging surface is opt-in
  (`LOG_PLAINTEXT_DOWNLOAD_TOKENS=true`) and the raced line leaks no MORE than the
  designed line — the issue is correctness (dead token), not exposure. Concur with
  MED severity and the `affectedRows === 1` gate.
- **COR-R4C3-03** (usedRow heuristic): no security impact — the branch never
  serves the file; purely message accuracy. Concur LOW.

## Verifier sweep — evidence-based checks (all PASS)

1. **R4C2 regression sweep:** all 8 commits re-read against their plan items;
   no drift between plan-275 claims and shipped code.
2. **`.toISOString()` → datetime class:** grep over `src/**` (excl. tests) — 13
   call sites; all are feed/HTTP/CSV/UI formatting or `backup-filename`; zero DB
   datetime writes. Class closed.
3. **Action-origin exemption sweep:** the only `@action-origin-exempt` markers
   live in `public.ts` (excluded by name, intentionally anonymous endpoints) —
   scanner hardening (605e07db) verified to reject exemptions on mutating bodies
   via its new fixtures; no remaining mutating export carries an exemption.
4. **Token verify path:** `verifyToken` is hash-lookup + `timingSafeEqual`
   re-check + expiry; well-formed-token pre-filter prevents plaintext reaching
   query logs. `last_used_at` touch is fire-and-forget. No issue.
5. **Session path:** HMAC format check → constant-time compare → age cap → DB
   hash lookup → expiry delete. `getSessionSecret` refuses DB fallback in
   production. No issue.
6. **Origin checks:** `hasTrustedSameOrigin` fails closed on missing
   Origin+Referer; TRUST_PROXY gates X-Forwarded-* trust to the right-most hop.
   Attacker-supplied Origin cannot self-match a foreign Host. No issue.
7. **proxy.ts:** cookie-format pre-filter only (full verification in actions);
   API routes excluded from matcher and covered by `withAdminAuth` +
   `lint:api-auth` gate. CSP nonce injection production-only. No issue.
8. **Rate-limit gate boundary:** `check-public-route-rate-limit` scans mutating
   verbs only; GET surfaces (`/api/download`, OG, feeds, serve-upload) each have
   their own audited posture (download: 256-bit token + cheap shape pre-filter;
   OG: preIncrementOgAttempt 30/min). Documented, accepted.
9. **Secrets:** no plaintext secrets in repo; `.env.deploy` gitignored;
   `MYSQL_PWD` pattern for dumps intact.

## HARD-SCOPE
No finding touches edit/culling/scoring features. None proposed.
