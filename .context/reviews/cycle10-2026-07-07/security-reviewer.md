# Cycle 10 Security Review - 2026-07-07

Security-reviewer pass for `/Users/hletrd/flash-shared/gallery`, covering OWASP, authentication, authorization, secrets, input validation, rate limiting, session handling, CSRF, and data exposure. I did not edit source code.

## Inventory

Built inventory from `git ls-files` before review:

- Tracked files: 3,397
- App routes: 81 under `apps/web/src/app`
- Library modules: 111 under `apps/web/src/lib`
- Scripts: 29 under `apps/web/scripts`
- Unit tests: 350 under `apps/web/src/__tests__`
- E2E tests: 12 under `apps/web/e2e`
- Drizzle migration/meta files: 33 under `apps/web/drizzle`
- Review/context history: 2,475 under `.context`
- Notable extensions: 529 `.ts`, 111 `.tsx`, 30 `.sql`, 22 `.json`, 7 `.mjs`, 6 `.js`, 3 `.sh`, 81 `.png`, 6 `.jpg`, 5 `.icc`, 1 `.woff2`

## Reviewed Areas

- Project security docs and operating rules: `AGENTS.md`, `CLAUDE.md`
- Auth and sessions: `apps/web/src/lib/auth.ts`, `apps/web/src/lib/session.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/admin-users.ts`
- CSRF/origin guards: `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/action-guards.ts`, mutating server actions
- Rate limits and proxy trust: `apps/web/src/lib/rate-limit.ts`, public API and public share routes
- Input validation and sanitization: `apps/web/src/lib/validation.ts`, `apps/web/src/lib/sanitize.ts`, `apps/web/src/lib/safe-json-ld.ts`, route schemas and image/upload helpers
- Upload and file serving boundaries: `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/storage/local.ts`, admin upload routes
- Backup/restore and SQL scanning: `apps/web/src/app/actions/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/sql-restore-scan.ts`, admin DB download route
- Data exposure/privacy surfaces: `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, semantic search/similar routes, public album/gallery routes
- Browser security headers/CSP: `apps/web/src/lib/content-security-policy.ts`, `apps/web/next.config.ts`, middleware
- Secrets and dangerous-pattern sweep across tracked source, excluding `node_modules`, generated assets, lockfile noise, and fixtures where appropriate
- Dependency audit and registry checks for current Next/PostCSS versions

## Findings

### 1. MEDIUM - Next bundles vulnerable PostCSS despite the top-level override

- Severity: Medium
- Confidence: High
- OWASP: A06 Vulnerable and Outdated Components
- Location:
  - `apps/web/package.json:59` declares `next` as `^16.2.10`
  - `package.json:7-9` overrides top-level `postcss` to `8.5.16`
  - `package-lock.json:9194-9205` installs `next@16.2.10` with dependency `"postcss": "8.4.31"`
  - `package-lock.json:9334-9337` installs nested `node_modules/next/node_modules/postcss@8.4.31`
  - `package-lock.json:9850-9853` shows only the top-level `node_modules/postcss` is `8.5.16`
- Evidence:
  - `npm audit --workspace=apps/web --omit=dev` reports GHSA-qx2v-qp2m-jg93 against `postcss <8.5.10`, reachable through `next`.
  - `npm view next version` returned `16.2.10`, so the project is already on the current npm `latest` for Next at review time.
  - `npm view postcss version` returned `8.5.16`.
  - `npm audit fix --force` proposes `next@9.3.3`, which is a major downgrade and not an acceptable remediation.
- Failure scenario:
  - If attacker-influenced CSS is ever processed by Next's bundled PostCSS stringify path and then embedded in an HTML style context, crafted content containing a closing `style` sequence can break out of the style block and execute script in a victim browser. I did not find an obvious public arbitrary-CSS input in this app, so the practical exposure appears limited today, but the vulnerable production dependency remains present and audit-detectable.
- Concrete fix:
  - Track and upgrade to the first stable Next release that bumps its nested PostCSS dependency to `>=8.5.10`, then regenerate the lockfile and rerun the full quality gates.
  - If Next has not released a fixed stable version, evaluate an npm override that forces the nested Next PostCSS copy to `>=8.5.10`; only keep it if `npm run lint --workspace=apps/web`, `npm run typecheck --workspace=apps/web`, `npm run build --workspace=apps/web`, and `npm test --workspace=apps/web` all pass.
  - If neither upstream upgrade nor validated override is viable immediately, add a documented temporary audit exception with this affected path and rationale. Do not run `npm audit fix --force` because it recommends downgrading Next.

## No Critical/High Findings Found

I did not identify a critical or high-severity repository issue in the reviewed auth/authz/session/CSRF/input-validation/data-exposure surfaces.

Evidence supporting that conclusion:

- Admin APIs are wrapped by `withAdminAuth(...)`; the custom gate passed with `npm run lint:api-auth --workspace=apps/web`.
- Mutating server actions require same-origin provenance or explicit documented exemption; the custom gate passed with `npm run lint:action-origin --workspace=apps/web`.
- Public mutating or expensive routes are covered by rate-limit pre-increment checks or explicit documented exemptions; the custom gate passed with `npm run lint:public-route-rate-limit --workspace=apps/web`.
- Session cookies are HMAC-bound, timing-safe verified, database-backed, and require a production `SESSION_SECRET`.
- Login and password-change flows include same-origin checks, rate limits, Argon2 password verification/hashing, and generic failed-login responses.
- Public route rate limiting uses explicit proxy trust checks before accepting forwarded client IP headers.
- Admin DB download, upload, backup, and restore paths are behind admin auth and include path, file, and SQL validation controls.
- Privacy-sensitive fields are omitted from public data paths and are covered by the privacy guard tests.
- JSON-LD `dangerouslySetInnerHTML` usages route through `safeJsonLd`, which escapes `<` to reduce script-breakout risk.
- The secret-like pattern scan found placeholders, tests, and historical documentation notes, but no live plaintext credential committed in current tracked source.

## Verification Run

Passing checks:

- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- Targeted security/privacy tests:
  - `src/__tests__/privacy-fields.test.ts`
  - `src/__tests__/api-auth-response-headers.test.ts`
  - `src/__tests__/action-guards.test.ts`
  - `src/__tests__/auth-actions-behavior.test.ts`
  - `src/__tests__/session-verify.test.ts`
  - `src/__tests__/backup-download-route.test.ts`
  - `src/__tests__/db-restore.test.ts`
  - `src/__tests__/sql-restore-scan.test.ts`
  - `src/__tests__/semantic-search-route.test.ts`
  - `src/__tests__/similar-route.test.ts`
  - `src/__tests__/safe-json-ld.test.ts`
  - `src/__tests__/sanitize.test.ts`
  - `src/__tests__/upload-paths.test.ts`
  - `src/__tests__/serve-upload.test.ts`

Failing check:

- `npm audit --workspace=apps/web --omit=dev`
  - Fails with 2 moderate findings for `postcss <8.5.10` through Next's nested dependency path, covered by Finding 1.

## Final Missed-Issues Sweep

- Searched for secret/token/key patterns across tracked source. No live plaintext credential was found in current source; historical review/plan notes mention prior secrets and rotation guidance, which is already documented operationally.
- Searched for dangerous HTML sinks. `dangerouslySetInnerHTML` usages were JSON-LD paths protected by `safeJsonLd`.
- Searched raw SQL usage. Reviewed raw fragments were constants or controlled query-builder constructs; no obvious user-controlled SQL concatenation was found in the inspected regions.
- Reviewed upload path normalization and local storage file-serving boundaries. The implementation rejects traversal, hidden segments, encoded separators, and unsafe local storage roots in the covered tests.
- Reviewed admin/public separation around semantic search, similar images, share pages, backup, restore, and Lightroom upload. The reviewed paths had admin auth, public token gating, field omission, and/or rate limiting as appropriate.

## Residual Risk

- I did not run the full `npm test --workspace=apps/web` suite or `npm run build --workspace=apps/web`; I ran focused security/privacy tests plus typecheck and the custom security lint gates.
- I did not perform dynamic browser testing, e2e testing, or live production verification.
- Production NGINX/application of infrastructure templates remains operator-owned per project docs and was not verified against a live host in this review.
