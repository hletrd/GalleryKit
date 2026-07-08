# Run-10 Cycle 31 Security Review

Role: security-reviewer  
HEAD: `707470083a27c78e1c9d1da176ade75f94ad6af4`  
Date: 2026-07-08 KST

## Inventory

- Admin authentication/session surface: `apps/web/src/app/actions/auth.ts` (`login`, `logout`, `updatePassword`), `apps/web/src/lib/session.ts`, `apps/web/src/proxy.ts`.
  - Production session signing refuses DB fallback without `SESSION_SECRET` at `apps/web/src/lib/session.ts:26`.
  - Session tokens are HMAC-verified and shape-checked at `apps/web/src/lib/session.ts:107`.
  - Login uses same-origin, mutation barrier, per-IP and per-account pre-incremented rate limits before Argon2 verification at `apps/web/src/app/actions/auth.ts:101`, `apps/web/src/app/actions/auth.ts:106`, `apps/web/src/app/actions/auth.ts:140`.
  - Session cookies are `httpOnly`, secure in HTTPS/production, `sameSite: 'lax'` at `apps/web/src/app/actions/auth.ts:247`.
  - Middleware is a cookie-shape/admin-route fast guard only; API routes are explicitly excluded at `apps/web/src/proxy.ts:127`.
- Admin API/PAT surface: `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-tokens.ts`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`.
  - `withAdminAuth` enforces same-origin for cookie auth and scoped PAT auth for token calls at `apps/web/src/lib/api-auth.ts:80` and `apps/web/src/lib/api-auth.ts:122`.
  - PATs are generated from 32 random bytes, stored SHA-256-hashed, and verified with constant-time digest comparison at `apps/web/src/lib/admin-tokens.ts:53`, `apps/web/src/lib/admin-tokens.ts:61`, `apps/web/src/lib/admin-tokens.ts:69`.
  - LR upload requires `allowTokenScope: 'lr:upload'` at `apps/web/src/app/api/admin/lr/upload/route.ts:632`, rejects chunked/missing length/oversize bodies before multipart parsing at `apps/web/src/app/api/admin/lr/upload/route.ts:101`, and mirrors upload privacy/settings controls at `apps/web/src/app/api/admin/lr/upload/route.ts:217`, `apps/web/src/app/api/admin/lr/upload/route.ts:407`, `apps/web/src/app/api/admin/lr/upload/route.ts:418`.
  - DB backup download validates backup filename, path containment, realpath containment, file type, audit logging, and no-store headers at `apps/web/src/app/api/admin/db/download/route.ts:23`, `apps/web/src/app/api/admin/db/download/route.ts:51`, `apps/web/src/app/api/admin/db/download/route.ts:69`, `apps/web/src/app/api/admin/db/download/route.ts:81`.
- Server actions/authz surface: `apps/web/src/app/actions/**`, `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`.
  - `requireSameOriginAdmin()` centralizes strict Origin/Referer validation at `apps/web/src/lib/action-guards.ts:37`.
  - Mutating admin actions sampled in this pass use same-origin + restore mutation slots, e.g. upload at `apps/web/src/app/actions/images.ts:93` and `apps/web/src/app/actions/images.ts:100`, token creation at `apps/web/src/app/actions/lr-tokens.ts:40` and `apps/web/src/app/actions/lr-tokens.ts:46`, and admin user creation at `apps/web/src/app/actions/admin-users.ts:83` and `apps/web/src/app/actions/admin-users.ts:90`.
- Public route/rate-limit surface: uploads, feeds, OG images, semantic/similar search, public server actions.
  - Public derivative serving is intentionally un-rate-limited but directory/extension/path/realpath constrained at `apps/web/src/lib/serve-upload.ts:172`, `apps/web/src/lib/serve-upload.ts:189`, `apps/web/src/lib/serve-upload.ts:211`.
  - Feeds pre-increment the public feed limiter before DB work at `apps/web/src/app/feed.xml/route.ts:55` and `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:70`.
  - OG routes pre-increment the CPU limiter before protected work at `apps/web/src/app/api/og/route.tsx:97` and `apps/web/src/app/api/og/photo/[id]/route.tsx:102`.
  - Semantic/similar routes require same-origin and pre-increment before DB/embedding work at `apps/web/src/app/api/search/semantic/route.ts:107`, `apps/web/src/app/api/search/semantic/route.ts:176`, `apps/web/src/app/api/search/similar/[id]/route.ts:68`, `apps/web/src/app/api/search/similar/[id]/route.ts:105`.
  - Public server actions validate input and rate-limit before DB work, e.g. `searchImagesAction` at `apps/web/src/app/actions/public.ts:247` and analytics view writes at `apps/web/src/app/actions/public.ts:377`.
- Restore/backup/SQL safety surface: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/sql-restore-scan.ts`.
  - Restore same-origin/auth ordering remains as previously documented at `apps/web/src/app/[locale]/admin/db-actions.ts:421`.
  - Restore acquires DB/upload/backfill locks, durable maintenance, and drain checklist before import at `apps/web/src/app/[locale]/admin/db-actions.ts:470`, `apps/web/src/app/[locale]/admin/db-actions.ts:491`, `apps/web/src/app/[locale]/admin/db-actions.ts:548`, `apps/web/src/app/[locale]/admin/db-actions.ts:595`.
  - Dangerous SQL scanning blocks cross-schema writes, account/privilege operations, destructive table operations, routines, file I/O, dynamic SQL, and app-table allowlist drift at `apps/web/src/lib/sql-restore-scan.ts:12`, `apps/web/src/lib/sql-restore-scan.ts:262`, `apps/web/src/lib/sql-restore-scan.ts:294`.
- Secret/data-exposure surface:
  - Tracked secret hygiene gate rejects non-placeholder credential assignments at `apps/web/src/__tests__/tracked-secrets.test.ts:6`.
  - Public image projections omit sensitive fields and enforce a symmetric admin-only key contract at `apps/web/src/__tests__/privacy-fields.test.ts:41`, `apps/web/src/__tests__/privacy-fields.test.ts:155`.
  - Semantic/similar public enrichment uses a compile-guarded public field select at `apps/web/src/lib/search-enrichment-fields.ts:29`.
  - JSON-LD script sinks use `safeJsonLd()` at `apps/web/src/lib/safe-json-ld.ts:14` and `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:272`.

## Findings

No new Cycle 31 security findings.

I did not identify a fresh auth/authz/rate-limit/secret-handling issue that is both present at HEAD and not already represented by earlier deferred or fixed findings.

## Prior-Finding Dedupe Notes

- `C27-02` / `AGG-C27-02` restore action ordering remains unchanged at `apps/web/src/app/[locale]/admin/db-actions.ts:421`; this is an existing deferred restore-design item, not a new finding.
- `C27-04` restore finalizer behavior-test strength remains unchanged around `apps/web/src/app/[locale]/admin/db-actions.ts:674`; this is an existing deferred test-strength item, not a new finding.
- `C28-05` authenticated admin browser-flow expansion remains unchanged as an e2e coverage item, not a new authz defect.
- `C28-08` nginx/proxy real-IP validation remains operator/topology validation, not a repo-code defect. Current code still documents and depends on `TRUST_PROXY` in `apps/web/src/lib/rate-limit.ts:175`.
- Older carry-forward items about streaming upload/restore memory envelope, shared background DB budget, operator nginx zones, and lack of 2FA/WebAuthn are unchanged product/operator/architecture deferrals documented in `CLAUDE.md`; I did not recast them as new Cycle 31 security findings.

## Validation

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm audit --workspace=apps/web --audit-level=moderate` reported `found 0 vulnerabilities`.
- Focused security test slice passed: `npm test --workspace=apps/web -- src/__tests__/tracked-secrets.test.ts src/__tests__/privacy-fields.test.ts src/__tests__/check-api-auth.test.ts src/__tests__/check-action-origin.test.ts src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/auth-rate-limit.test.ts src/__tests__/session.test.ts src/__tests__/request-origin.test.ts src/__tests__/rate-limit.test.ts src/__tests__/semantic-search-rate-limit.test.ts` -> 10 files, 311 tests.

## Final Missed-Issue Sweep

- Searched route handlers, server actions, raw SQL, child-process, upload/path-serving, JSON-LD/HTML sinks, and external/internal fetch/redirect sites.
- Confirmed scanner gates cover current admin API exports, mutating server actions, and public expensive/mutating route handlers.
- Confirmed no new hardcoded tracked secret assignment beyond documented placeholders/examples.
- Residual risk: this was a source review plus focused gates/tests, not a live production proxy/nginx or authenticated browser-flow validation pass. Those remain covered by the prior deferred operator/e2e items above.
