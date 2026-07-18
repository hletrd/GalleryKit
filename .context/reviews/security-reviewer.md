# Security Reviewer — Cycle 13

Review target: `8bd8999f` (`master` / `origin/master`). Review only; no product code, plan, workflow, or deployment file was modified.

## Inventory and method

I read `AGENTS.md`, all 780 lines of `CLAUDE.md`, both README files, the active Cycle 12 plan/deferred pair, and the complete maintained inventory before reviewing. The repository contains 3,705 tracked files; the maintained implementation inventory contains 518 source `.ts` files, 113 source `.tsx` files, 13 server-action modules, 12 route handlers, 116 library modules, 60 component files, 30 operational scripts, 34 migration SQL files, 366 Vitest files, and 14 Playwright TypeScript files.

The security pass traced cookie sessions, PAT scopes, admin layouts, middleware, action/API authentication, same-origin derivation, proxy trust, public/admin projections, rate-limit admission ordering, uploads and derivative serving, backup/restore child processes and paths, migration tooling, CSP/JSON-LD/OG sinks, runtime secrets/TLS, Docker/nginx boundaries, and every security-sensitive operation surfaced by repository-wide searches for raw SQL, filesystem writes, subprocesses, environment reads, redirects, exemptions, and HTML injection.

Validation passed:

- `npm run lint:api-auth --workspace=apps/web`
- `npm run lint:action-origin --workspace=apps/web`
- `npm run lint:public-route-rate-limit --workspace=apps/web`
- `npm run typecheck --workspace=apps/web`
- `npm run audit:prod` — zero production vulnerabilities at the configured threshold
- 145 focused security, schema, migration, privacy, and timeline tests

## Findings

**Finding count: 0.** No new security defect survived cross-file validation.

The new destructive schema-convergence command remains fail-closed behind an explicit mutation opt-in, a local-host allowlist, and a delimited `test`/`ci`/`e2e` database-name requirement (`apps/web/scripts/check-schema-convergence.mjs:41-50`). Its DDL fixture and hash deletion operate only after those checks. The new `capture_year` column is explicitly admin/internal and remains excluded by both compile-time and symmetric runtime privacy guards (`apps/web/src/lib/data.ts:111-158`; `apps/web/src/__tests__/privacy-fields.test.ts:41-83,117-167`). The two correctness/performance issues reported by the debugger/tracer do not cross an authorization, confidentiality, integrity, or resource-amplification boundary beyond the already edge-rate-limited public page posture.

## Final missed-issue sweep

The final sweep rechecked session HMAC shape/age/revocation, cookie attributes, PAT scope/expiry/use accounting, origin-before-auth ordering, restore mutation barriers, last-admin protection, path containment/symlink and file-descriptor validation, upload body/quota limits, GPS fail-closed handling, SQL parameterization, backup filename/header validation, CSP nonces, JSON-LD escaping, canonical-origin pinning, schema-tool mutation containment, tracked-secret patterns, and every auth/rate-limit exemption. No confirmed, likely, or manual-validation security finding remained.
