# Security Reviewer — Cycle 12 Provenance

Review target: `ff6532f4` (`master` / `origin/master` at review start). Review only; no product code or plan was modified.

## Inventory and method

I read `AGENTS.md` and all 779 lines of `CLAUDE.md`, then inventoried the 3,698 tracked files. The maintained implementation inventory was 516 source `.ts` files, 113 source `.tsx` files, 13 action modules, 12 route handlers, 116 library modules, 61 component files, 30 operational scripts, 33 migration SQL files, 371 unit-test/fixture files, and 16 Playwright files.

The security pass traced the complete cookie-session and PAT paths; password hashing; account/IP/token rate limits; proxy/origin derivation; middleware and route/action authorization; restore mutation barriers and advisory locks; upload body/quota, content, path, symlink, realpath, GPS, and cleanup controls; public/admin field projections; backup/restore child processes and SQL scanning; JSON-LD/OG/CSP sinks; DB TLS and runtime secrets; Docker/nginx/deploy boundaries; schema-convergence mutation guards; and the complete post-Cycle-11 implementation diff. Repository-wide searches covered raw SQL, `sql.raw`, child-process execution, filesystem writes, environment reads, exemptions/suppressions, and HTML injection sinks.

Fresh validation passed:

- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run audit:prod` — zero production vulnerabilities at the configured threshold
- 137 focused migration/timeline/image contract tests

## Findings

**Finding count: 0.** No new security defect survived cross-file validation.

The new schema-convergence helper is mutation-capable, but it fails closed unless an explicit opt-in is present, the DB host is exactly local, and the database name contains a delimited `test`, `ci`, or `e2e` token (`apps/web/scripts/check-schema-convergence.mjs:11-25`). Its validation blind spot is recorded by the tracer as test-infrastructure risk, not as an authorization or remote-destruction primitive.

The post-Cycle-11 changes do not widen trust boundaries: the derivative-width fix changes only public-safe delivered geometry; search now suppresses speculative RSC fetches; capture-date generated columns remain omitted from public projections; and the convergence script is CI/operator tooling rather than a request path.

## Revalidated existing boundaries (not counted as new findings)

- Process-local coordination and rate-limit fast paths still rely on the documented single-web-instance topology (`CLAUDE.md`, Runtime topology; `apps/web/src/lib/single-writer-guard.ts`). The guard is warn-only, but no scale-out/topology exit criterion is evidenced at this HEAD.
- SQL backups remain plaintext at rest inside an owner-only non-public directory (`apps/web/src/app/[locale]/admin/db-actions.ts:177-195,229-359`); host/storage encryption remains the documented operator boundary.
- Production CSP still permits inline styles for Next/Radix compatibility (`apps/web/src/lib/content-security-policy.ts`); there is no new HTML/script injection sink, and JSON-LD paths continue through `safeJsonLd`.
- Public page protection still depends on the shipped nginx edge policy, while app-layer route/action limiters remain present. No repository evidence shows an unprotected alternate production proxy.

## Final missed-issue sweep

The final sweep rechecked session HMAC shape/age/DB revocation, cookie attributes, PAT scope/expiry/revocation/use accounting, same-origin ordering, last-admin protection, sensitive-key symmetry, SQL parameterization, process argument arrays and minimal child environments, restore drains/finalizers, upload path containment and fail-closed GPS behavior, OG canonical-origin pinning, backup file-descriptor validation, schema-tool mutation containment, tracked-secret patterns, and all security lint exemptions. No confirmed, likely, or manual-validation security finding remained.
