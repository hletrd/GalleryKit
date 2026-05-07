# tracer — cycle 1 (new)

Scope: causal tracing of suspicious flows with competing hypotheses.

## Trace 1 — "Request reaches `argon2.verify()` with no proof of same-origin"

- **Entry:** `apps/web/src/app/actions/auth.ts:70` — `export async function login(prevState, formData)`.
- **Step 1:** Sanitize username/password at lines 76-79.
- **Step 2:** Retrieve `headers()` at line 92.
- **Step 3:** Call `hasTrustedSameOrigin(requestHeaders)` at line 93.
  - Delegates to `hasTrustedSameOriginWithOptions(requestHeaders)` at `request-origin.ts:63`.
  - `options.allowMissingSource` defaults to `true` at line 70.
  - When both `Origin` and `Referer` are absent, the function returns `true` at line 86.
- **Step 4:** Rate limit check at lines 100-106 — still applied, but the provenance gate has already passed.
- **Step 5:** `argon2.verify` at line 158 — runs even when the request has no origin metadata.
- **Conclusion:** The claim "the provenance gate always requires a same-origin proof before verify" is FALSE on current HEAD.
- **Competing hypothesis A:** Maybe Next's server action routing rejects cross-origin POSTs without origin headers. Reviewed `apps/web/src/proxy.ts` and `next.config.ts`; nothing there replaces the provenance check. HYPOTHESIS REJECTED.
- **Competing hypothesis B:** Maybe browsers always emit `Origin` on credentialed POSTs. True for most modern browsers, but Safari and privacy extensions have gaps; and non-browser clients (including internal test tools) are unconstrained. HYPOTHESIS REJECTED as sufficient defense.

## Trace 2 — "Password change transaction fails; rate-limit recovers correctly"

- **Entry:** `auth.ts:261` — `export async function updatePassword(...)`.
- **Step 1:** `isAdmin()` check at line 263.
- **Step 2:** Same-origin check at line 274.
- **Step 3:** Rate-limit increment at line 298-301.
- **Step 4:** `argon2.verify()` at line 335.
- **Step 5:** Clear successful attempts at line 344 (`clearSuccessfulPasswordAttempts(ip)`).
- **Step 6:** `db.transaction` at line 358.
- **Failure point:** If the transaction fails at line 358, control flows to catch at line 377. The catch calls `rollbackPasswordChangeRateLimit(ip)` which decrements by 1.
- **Conclusion:** Prior accumulated failed attempts in the same window are lost when the bucket was cleared at line 344, and only one decrement runs on the failure branch. The strict rate-limit invariant ("reset only on confirmed persistence success") does NOT hold.
- **Competing hypothesis:** Maybe `rollbackPasswordChangeRateLimit` restores from DB state. Read `auth-rate-limit.ts`; it decrements the in-memory map and the DB row. It does not restore pre-existing pressure that was zeroed out. HYPOTHESIS REJECTED.

## Trace 3 — "Admin layout renders auth-protected chrome to unauthenticated viewers"

- **Entry:** unauthenticated GET to `/en/admin`.
- **Step 1:** Middleware `apps/web/src/proxy.ts` — login route is exempt from the admin cookie guard.
- **Step 2:** Layout `apps/web/src/app/[locale]/admin/layout.tsx` renders `<AdminHeader />`.
- **Step 3:** `AdminHeader` at `components/admin-header.tsx:9` renders `<AdminNav />` and the logout form.
- **Step 4:** `AdminNav` renders eight `<Link>` components to `/admin/{dashboard,categories,tags,seo,settings,password,users,db}`.
- **Outcome:** The HTML sent to the login page viewer enumerates the admin surface and renders an invalid logout button. Not an auth bypass, but a UX/posture issue.

## Trace 4 — "Seed `image_sizes` mismatch affects E2E only"

- **Entry:** `apps/web/scripts/seed-e2e.ts` `createVariants` at line 65.
- **Path:** Hard-coded sizes used for generation + cleanup. Does not affect the production image pipeline (which uses `image_sizes` via `gallery-config`). Confirmed NO runtime drift — only tests are affected if the active size list changes.
