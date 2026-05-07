# verifier — cycle 1 (new)

Scope: evidence-based correctness check against stated behavior in `CLAUDE.md` and existing plan files.

## Claims re-verified
| Claim | Citation | Verified as of HEAD a308d8c |
|---|---|---|
| "Session secret: SESSION_SECRET env var is required in production" | `CLAUDE.md` Security Architecture section; `apps/web/src/lib/session.ts` | HOLDS |
| "Login rate limiting: 5 attempts per 15-minute window per IP" | `CLAUDE.md`; `apps/web/src/lib/rate-limit.ts`; `auth.ts:14` (`LOGIN_MAX_ATTEMPTS`) | HOLDS |
| "Every server action independently verifies auth via `isAdmin()`" | `CLAUDE.md`; server actions in `apps/web/src/app/actions/*.ts` | HOLDS on current HEAD |
| "Last admin deletion prevented to avoid lockout" | `CLAUDE.md`; `apps/web/src/app/actions/admin-users.ts` | HOLDS |
| "Middleware auth guard checks `admin_session` cookie" | `apps/web/src/proxy.ts` | HOLDS |
| "GPS coordinates excluded from public API responses" | `apps/web/src/lib/data.ts` `publicSelectFields` | HOLDS |
| "Password-change transaction wraps password update + session invalidation" | `auth.ts:358-371` | HOLDS; BUT rate-limit clear occurs before the transaction (see V1-01) |

## Verification findings

### V1-01 — Password-change transaction boundary does not include the rate-limit clear
- **Citation:** `apps/web/src/app/actions/auth.ts:337-371`
- **Severity / confidence:** MEDIUM / HIGH
- **Evidence:** `clearSuccessfulPasswordAttempts(ip)` runs at line ~344 after `argon2.verify` succeeds but before the `db.transaction` that commits the password change. On transaction failure, the catch block rolls back with a single decrement; any accumulated pre-fix-attempt pressure is irrecoverably lost.
- **Impact:** Rate-limit semantics diverge from the login path's stricter "reset only on the confirmed-success branch, after persistence".

### V1-02 — `hasTrustedSameOrigin` default is loose
- **Citation:** `apps/web/src/lib/request-origin.ts:70`
- **Severity / confidence:** MEDIUM / HIGH
- **Evidence:** `const { allowMissingSource = true } = options;` — the default path allows requests with no provenance headers. Callers `auth.ts:93` (login) and `auth.ts:274` (password change) use the default, so the strict contract is not in effect where it matters most.

### V1-03 — Admin layout does not branch on auth
- **Citation:** `apps/web/src/app/[locale]/admin/layout.tsx:4-22`
- **Severity / confidence:** MEDIUM / HIGH
- **Evidence:** Layout renders `AdminHeader` unconditionally. `AdminHeader` imports `AdminNav` with eight admin sub-route links, and a logout form. This HTML is served on the `/admin` login page.

### V1-04 — Seed scripts misalignment
- **Citation:** `apps/web/scripts/seed-e2e.ts:77`, `apps/web/src/db/seed.ts:6-9`
- **Severity / confidence:** MEDIUM / HIGH
- **Evidence:** Hard-coded `[640, 1536, 2048, 4096]` and uppercase slugs `IDOL`, `PLANE` — both confirmed by direct file read.

### V1-05 — Normalized-value return contract missing on three admin actions
- **Citation:** `images.ts:546-604`, `seo.ts:51-133`, `settings.ts:36-129`
- **Severity / confidence:** MEDIUM / HIGH (images), LOW / HIGH (seo, settings)
- **Evidence:** Each action returns `{ success: true }` on success with no normalized payload. Clients rehydrate from pre-submit state, not from what was persisted.

## Closure of previously-reported items
- `AGG6-04` (admin chrome on login) — reproduced on current HEAD. Still open.
- `AGG6-02` (provenance default) — reproduced. Still open.
- `AGG6-03` / `AGG6-13` (normalized return contract) — reproduced. Still open.
- `AGG6-09` (seed-e2e image sizes) — reproduced.
- `AGG6-12` (legacy seed slugs) — reproduced.
- Designer "public controls inert after click" — e2e evidence in `public.spec.ts:19-35,49-63` contradicts that claim; remains stale as closed in `cycle6-review-triage.md`.
