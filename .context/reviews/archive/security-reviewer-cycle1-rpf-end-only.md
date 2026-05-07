# Security Reviewer — Cycle 1 (RPF, end-only deploy mode)

## Scope
OWASP-aligned security review of gallery codebase as of HEAD (`e090314`).
Focused on auth/authz, secrets, unsafe patterns, injection vectors, and
trust-boundary handling.

## Verified Hardening
- Session token verification uses HMAC-SHA256 with timing-safe compare
  (`apps/web/src/lib/session.ts:113-119`).
- `SESSION_SECRET` env var is enforced in production; DB fallback only in dev
  (`apps/web/src/lib/session.ts:30-36`).
- All admin server actions guard with `requireSameOriginAdmin` (CSRF defense
  in depth) — verified by `lint:action-origin` gate, exit 0.
- All `/api/admin/*` routes use `withAdminAuth` wrapper (token + same-origin)
  — verified by `lint:api-auth` gate, exit 0.
- JSON-LD output is escaped via `safeJsonLd` (`<` → `\u003c`, U+2028/9
  escapes) — `apps/web/src/lib/safe-json-ld.ts`.
- Stripe webhook signature verification is mandatory before any DB write
  (`apps/web/src/app/api/stripe/webhook/route.ts:48-55`).
- Rate-limit budgets exist for: `/api/og`, `/api/checkout`, `/s/[key]`,
  `/g/[key]`, search, login, load-more.
- Admin tokens are stored hashed; only the prefix is logged
  (`apps/web/src/lib/admin-tokens.ts`).
- Cookie format is gate-checked at the edge in `proxy.ts:91-117`.
- Origin/proxy IP determination requires `TRUST_PROXY=true` opt-in to read
  `x-forwarded-for` (`apps/web/src/lib/rate-limit.ts:140-167`).

## New Observations

### S-CYCLE1-01: customerEmail not length-validated before persist [LOW] [Medium confidence]
**File:** `apps/web/src/app/api/stripe/webhook/route.ts:61, 108`
**Description:** `customerEmail` is read from `session.customer_details.email`
or `session.customer_email` and inserted into `entitlements.customerEmail`
without a length cap or basic format check. Stripe enforces RFC-5321 limits
upstream, so the practical risk is bounded; but if Stripe ever returns a
longer string (or if `entitlements.customer_email` is `varchar(N)` with
N<255 that gets out of sync), the INSERT would fail silently and a paid
order would not be recorded. Defensive truncation (e.g. `.slice(0, 320)`
matching RFC-5321 max) would harden the path.
**Fix:** Add `customerEmail.slice(0, 320)` and reject obviously malformed
values before the INSERT.
**Confidence:** Medium — Stripe is unlikely to violate this, but the
silent-failure mode is the concerning bit.

### S-CYCLE1-02: tagsParam in topic redirect lacks length cap [LOW] [Low confidence]
**File:** `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:154-157`
**Description:** A raw `tagsParam` from `searchParams` is passed into
`URLSearchParams.set('tags', tagsParam)` and reflected back in a `redirect()`.
URLSearchParams performs encoding, so this is not an injection vector, but
the absence of a length cap means a hostile referrer can produce a very
long redirect URL header, which could bloat downstream proxy/CDN logs.
**Fix:** `if (tagsParam && tagsParam.length > 1024) tagsParam = undefined;`
before forming the redirect.
**Confidence:** Low — primarily a hygiene concern.

## Conclusion
No High/Medium security findings. Two Low-severity defense-in-depth items
recorded above. Auth/authz and CSRF posture remain strong; gates pass.
