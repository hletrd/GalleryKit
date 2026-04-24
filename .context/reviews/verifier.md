# Verifier Review — Cycle 4 (Prompt 1)

## Scope and method

I checked the current repository state against the documented behavior in `README.md`, `apps/web/README.md`, `CLAUDE.md`, and the active config/test surfaces that matter for auth, proxying, uploads, backups, and build invariants.

Inspected surfaces included:

- Docs/config: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/.env.local.example`
- Auth/proxy/backups: `apps/web/src/app/actions/auth.ts`, `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/rate-limit.ts`, `apps/web/src/app/api/admin/db/download/route.ts`
- Security gates: `apps/web/scripts/check-api-auth.ts`, `apps/web/scripts/check-action-origin.ts`
- Tests: `apps/web/src/__tests__/request-origin.test.ts`, `apps/web/src/__tests__/backup-download-route.test.ts`, `apps/web/src/__tests__/rate-limit.test.ts`, `apps/web/src/__tests__/auth-rate-limit.test.ts`, `apps/web/src/__tests__/check-api-auth.test.ts`, `apps/web/src/__tests__/check-action-origin.test.ts`

Verification commands run on the live repo state:

- `npm test --workspace=apps/web` → 57 files, 333 tests passing
- `npm run lint --workspace=apps/web` → clean
- `npm run typecheck --workspace=apps/web` → clean
- `npm run build --workspace=apps/web` → succeeds (one expected Next.js edge-runtime warning only)
- `npm run lint:api-auth --workspace=apps/web` → clean
- `npm run lint:action-origin --workspace=apps/web` → clean

## Findings summary

| ID | Severity | Status | Confidence | Summary |
|---|---|---|---|---|
| C4V-01 | MEDIUM | Confirmed | High | Login session cookies parse `X-Forwarded-Proto` differently than the rest of the proxy-aware code, which can mis-set the `Secure` flag in multi-hop proxy setups |
| C4V-02 | LOW | Confirmed | High | The README overstates how much `TRUST_PROXY` is required for same-origin validation, which is a docs/config mismatch rather than a runtime bug |
| C4V-03 | LOW/MEDIUM | Risk | Medium | The same-origin action scanner only walks `.ts` files, so a future `.tsx`/`.js` mutating action could evade the gate |

## Detailed findings

### C4V-01 — Login cookie `Secure` flag uses the wrong forwarded-proto hop

- **Severity:** MEDIUM
- **Status:** Confirmed
- **Confidence:** High
- **Files / code regions:**
  - `apps/web/src/app/actions/auth.ts:206-214`
  - contrast: `apps/web/src/lib/request-origin.ts:19-24, 45-64`
- **Why this is a problem:** The login action determines `secure` via `requestHeaders.get('x-forwarded-proto')?.split(',')[0]`, which takes the *first* comma-separated value. The proxy-aware origin helper elsewhere in the repo explicitly treats the trusted hop as the *right-most* value when `TRUST_PROXY=true`. Those two policies disagree.
- **Concrete failure scenario:** In a chained proxy deployment, the forwarded proto chain can contain multiple values. If the first value is `http` and the trusted outer proxy’s value is `https`, the login action will set `secure=false` even though the browser is on HTTPS. That weakens session cookies and can also cause inconsistent behavior across proxy layers.
- **Suggested fix:** Reuse the same trusted-proxy header normalization logic that `request-origin.ts` uses, or centralize proto parsing in a shared helper that explicitly honors `TRUST_PROXY` and the right-most trusted hop.

### C4V-02 — README overstates the `TRUST_PROXY` dependency for same-origin checks

- **Severity:** LOW
- **Status:** Confirmed
- **Confidence:** High
- **Files / code regions:**
  - `README.md:142-145`
  - `apps/web/README.md:39-41`
  - `apps/web/src/lib/request-origin.ts:45-64`
- **Why this is a problem:** The docs say `TRUST_PROXY=true` is required for same-origin validation and that the proxy must forward Host / X-Forwarded-Proto. The implementation actually falls back to plain `Host` + `Origin`/`Referer` matching when `TRUST_PROXY` is unset, and the shipped nginx config does not set `X-Forwarded-Host` at all. So the documentation is broader than the code.
- **Concrete failure scenario:** An operator reading the README may assume same-origin checks are proxy-dependent in all deployments, and may over-configure or misdiagnose a working local / direct deployment. The inverse risk is also possible: they may think the nginx config must add headers it does not actually need.
- **Suggested fix:** Narrow the docs to say `TRUST_PROXY` is required for correct client-IP rate limiting, while same-origin checks only consume forwarded headers when a trusted proxy provides them. If you want to keep the stronger claim, add a test that proves it against the actual nginx header behavior.

### C4V-03 — Same-origin action scanner only covers `.ts` files

- **Severity:** LOW/MEDIUM
- **Status:** Risk
- **Confidence:** Medium
- **Files / code regions:**
  - `apps/web/scripts/check-action-origin.ts:49-68`
- **Why this is a problem:** The security scanner only discovers `.ts` descendants under `app/actions/`. That is fine for the current codebase, but Next.js server actions can also be authored in `.tsx` or `.js` variants, and the repo already treats route files more flexibly in the analogous API-auth scanner.
- **Concrete failure scenario:** A future mutating action is added as `actions/foo.tsx` or `actions/foo.js`. It would compile and ship, but this gate would never inspect it for `requireSameOriginAdmin()`, creating a bypass in the lint coverage.
- **Suggested fix:** Either codify `.ts`-only as a hard repository rule in docs/tests, or broaden the scanner to the action-file extensions the repo intends to allow.

## Final missed-issues sweep

I did a second pass over the security-sensitive surfaces after the main inspection:

- `npm run lint:api-auth` passed, so the admin API route auth wrapper gate is currently enforced.
- `npm run lint:action-origin` passed, so the current mutating action set is covered by the same-origin gate.
- `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` all passed, so there is no current build/test breakage in the inspected state.

I did not find additional confirmed correctness issues beyond the three items above.
