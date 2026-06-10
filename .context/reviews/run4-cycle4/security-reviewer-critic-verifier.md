# Run-4 Cycle 4 — security-reviewer + critic + verifier angle

Inventory: auth core (`lib/api-auth.ts` current state incl. the R4C3 header
fix, `lib/admin-tokens.ts` full, `actions/lr-tokens.ts` full, `proxy.ts`
full), origin/CSRF surfaces (`lib/request-origin` usage, action-origin
scanner posture re-confirmed via gate run), paid flow (webhook + checkout +
download + refund full reads), public mutation surfaces (`actions/public.ts`
exports + rate-limit posture, `api/search/semantic` full), serving path
(`serve-upload.ts` traversal/symlink/ETag full), LR PAT route full,
smart-collections compiler (admin-input → public-page execution boundary),
analytics privacy contract (`lib/analytics.ts` full), secrets sweep (no new
env/key handling since R4C3), gate self-integrity (all three scanners run
green on the clean tree this cycle, exempt-on-mutating-body hardening from
R4C2 verified still in place on `createLrToken`).

## Findings

### SEC-concur on COR-R4C4-02 (refund convergence) — severity framing
The non-converged `charge_already_refunded` path is a CORRECTNESS finding
with a security-adjacent consequence: a Stripe-refunded customer retains a
live single-use download credential for the original asset. No privilege
boundary is crossed (the customer legitimately held the token), but the
photographer's business rule "refund blocks download" (`refunded` check at
`download/[imageId]/route.ts:125-127`) is silently defeated by stale local
state. Concur with scheduling as a fix, not a deferral.

### SEC-R4C4-05 (shared with designer as I18N-R4C4-05) — lr-tokens action error-string surface
`apps/web/src/app/actions/lr-tokens.ts:40,50,61,72,75,97,110` return
hardcoded English error strings while the same functions return localized
`t('unauthorized')` two lines earlier. Not an injection or disclosure issue —
strings are static literals, and `createLrToken`'s catch correctly returns a
generic message instead of `err.message` (R4C1 SEC-R4C1-01 holds). Flagged
here because credential-management UX clarity is a security-adjacent
property: a Korean-locale admin gets mixed-language feedback on the surface
where they decide WHICH credential to revoke. Schedule with the i18n fix;
keep the generic-error posture (localize the generic message, do not add
detail).

### HARD-R4C4-07 concur — smart-collections value typing
From the security framing: input is admin-only (root admins, no capability
model — CLAUDE.md "Runtime topology"), so there is no privilege escalation;
mysql2 object-expansion produces backtick-escaped keys, so no practical
injection was found. Classified LOW hardening: enforce the declared scalar
types at the validation boundary so the public `/c/[slug]` compiler can never
see non-scalar params. Verified the public page wraps compile errors (typed
SmartCollection*Error) — a throwing validateNode is handled.

## Checked and clean

- **R4C3 header fix regression**: token-branch 401s and 200s both carry
  no-store; cookie-branch parity intact; the only token-scoped route
  (`lr/upload`) sets its own NO_CACHE so no behavior change in prod.
- **Webhook**: signature verification precedes ALL body use; non-paid /
  zero-amount / malformed-metadata rejects return 200 (no retry storms);
  plaintext-token log line remains opt-in via `LOG_PLAINTEXT_DOWNLOAD_TOKENS`
  and now fires only on the true insert (R4C3-02 verified, see code angle for
  the affectedRows proof). PII posture: error logs carry presence flags, not
  emails.
- **Checkout**: per-IP pre-increment rate limit with rollback on every
  early-return; strict integer price parse; metadata carries only
  imageId/tier; idempotency key deterministic. No injection surface.
- **Download route**: token shape gate before any hashing; hash-indexed
  lookup + constant-time verify; expiry/refund/single-use ordering correct;
  path traversal containment + symlink reject + realpath re-check;
  Content-Disposition extension sanitization + RFC 5987 encoding. The
  stream-open race (COR-R4C4-06) is availability/correctness, not exposure.
- **LR PAT route**: withAdminAuth(allowTokenScope) gate; same-origin
  correctly NOT required for token requests (PAT cross-origin is the
  feature); restore-maintenance guard; contract advisory lock; sanitized
  filename/title/description; GPS strip parity; uploaded_by attribution.
  The COR-R4C4-03 throw window is robustness, not auth bypass.
- **Public actions**: the three `record*View` analytics actions remain
  IP-rate-limited with `@action-origin-exempt` comments on genuinely
  read-validated insert-only paths (bounded), `recordTopicView` slug
  validation (R4C2 fix) in place; search/load-more rate-limit rollbacks
  intact.
- **Scanner integrity**: `lint:api-auth`, `lint:action-origin`,
  `lint:public-route-rate-limit` all PASS on clean tree; `createLrToken`
  carries no exemption marker (R4C2 hardening intact); webhook carries the
  documented `@public-no-rate-limit-required` justification.
- **Secrets**: no new secret-bearing code paths since R4C3; `MYSQL_PWD`
  pattern unchanged; no plaintext secrets in logs beyond the documented
  opt-in manual-distribution line.
- **Analytics privacy**: country-code-only persistence, TLD+1 referrers,
  private-IP/onion → 'direct' — contract holds (trailing-dot nit is
  data-quality, see code angle LOW-R4C4-09).

No CRITICAL or HIGH security findings this cycle.
