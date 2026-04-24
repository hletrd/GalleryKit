# code-reviewer — cycle 1 (fresh)

Scope: full repository review from a code-quality, SOLID, maintainability, and correctness angle against current `HEAD` (a308d8c). All findings cite file + region and state severity/confidence.

## Inventory of review-relevant files
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/components/admin-header.tsx`
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/__tests__/request-origin.test.ts`
- `apps/web/scripts/seed-e2e.ts`
- `apps/web/src/db/seed.ts`
- `apps/web/e2e/admin.spec.ts`

## Findings

### CR1F-01 — `hasTrustedSameOrigin` fails open when both `Origin` and `Referer` are missing
- **Citation:** `apps/web/src/lib/request-origin.ts:62-87`; callers `auth.ts:93,274`.
- **Severity / confidence:** MEDIUM / HIGH.
- **Problem:** `hasTrustedSameOrigin()` delegates to `hasTrustedSameOriginWithOptions()` which defaults `allowMissingSource: true`. Both the login and password-change paths rely on the default, so a request with neither header still passes.
- **Scenario:** Non-browser or privacy-stripped clients can hit `argon2.verify` or the `UPDATE admin_users SET password_hash` path without proving same-origin provenance.
- **Fix:** Flip the default to `false`, keep the explicit `allowMissingSource: true` opt-in via `hasTrustedSameOriginWithOptions`, and update the corresponding unit test to lock the stricter default.

### CR1F-02 — Password-change rate-limit bucket cleared before DB transaction succeeds
- **Citation:** `apps/web/src/app/actions/auth.ts:337-371`.
- **Severity / confidence:** MEDIUM / HIGH.
- **Problem:** `clearSuccessfulPasswordAttempts(ip)` runs after `argon2.verify()` resolves, but before the `db.transaction` that updates the hash and deletes sessions. If the transaction throws, the catch only decrements once, losing any accumulated pressure from prior failed attempts in the window.
- **Fix:** Move the clear call to after the transaction commits, mirroring how `clearSuccessfulLoginAttempts` is placed in the login path.

### CR1F-03 — Admin layout wraps the unauthenticated login page in protected chrome
- **Citation:** `apps/web/src/app/[locale]/admin/layout.tsx:4-22`; `apps/web/src/components/admin-header.tsx:9-30`; `apps/web/src/components/admin-nav.tsx:10-45`.
- **Severity / confidence:** MEDIUM / HIGH.
- **Problem:** The top-level admin layout always renders the full `AdminHeader`/`AdminNav` with logout affordance, even on the login screen where there is no authenticated user. This gives a misleading "logged in" UI, exposes the full admin route catalog in HTML, and renders a logout button with no session.
- **Fix:** Branch the layout on authenticated state — render minimal login shell chrome when unauthenticated, keep the full header/nav for authenticated users. Alternatively move the chrome into the `(protected)` sub-layout which already exists.

### CR1F-04 — Admin client UI falls out of sync with sanitized persisted values
- **Citation:** `apps/web/src/app/actions/images.ts:546-604`; `apps/web/src/components/image-manager.tsx:226-243`; `apps/web/src/app/actions/seo.ts:51-133`; `apps/web/src/app/actions/settings.ts:36-129`.
- **Severity / confidence:** MEDIUM / HIGH (images), LOW / HIGH (seo, settings).
- **Problem:** Each server action sanitizes input (trim, `stripControlChars`, image-size normalization) but returns only `{ success: true }`. Clients then write their pre-sanitization input into local state, so what users see is not what was stored until the next refresh.
- **Fix:** Return the normalized persisted fields from the server actions, rehydrate client state from the returned values, and add a small vitest assertion per action to lock the normalization contract.

### CR1F-05 — Legacy `src/db/seed.ts` emits uppercase slugs the current validator rejects
- **Citation:** `apps/web/src/db/seed.ts:4-10`.
- **Severity / confidence:** LOW / HIGH.
- **Problem:** Seeded slugs `IDOL`, `PLANE` violate the lowercase+hyphen slug invariant enforced by topic CRUD. Either the seed is still usable (so slugs must be valid) or it is dead (so fix or delete).
- **Fix:** Lowercase both slugs, preserve labels/order.

### CR1F-06 — `seed-e2e.ts` hard-codes image sizes
- **Citation:** `apps/web/scripts/seed-e2e.ts:77-100, 142-147`.
- **Severity / confidence:** MEDIUM / HIGH.
- **Problem:** The derivative generator iterates a hard-coded `[640, 1536, 2048, 4096]` list, divergent from the active `image_sizes` setting. A future change to the default sizes silently breaks tests or falls back to a hard-coded variant.
- **Fix:** Read the configured/default image sizes and iterate over that list for both generation and cleanup.

### CR1F-07 — Admin mobile nav is silently scrollable with no visible indicator
- **Citation:** `apps/web/src/components/admin-nav.tsx:27` (`overflow-x-auto scrollbar-hide`).
- **Severity / confidence:** LOW / MEDIUM.
- **Problem:** UX nit — observation only for this cycle.

## Confidence summary
- CR1F-01 through CR1F-06 are code-inspection confirmed.
- CR1F-07 is observational/UX.
