# Cycle 11 — security-reviewer

Reviewed HEAD: `7e40e95c` (2026-07-18)

## Inventory and coverage

The security inventory covered the entire authenticated and public attack surface across the 81 route/action files and their library dependencies: session/HMAC/Argon2 flows, proxy protection, same-origin derivation, admin API wrappers, PAT scopes/expiry/use tracking, restore mutation barriers and advisory locks, login/public rate limits, upload multipart limits and quota claims, path/symlink/realpath containment, private originals and GPS fail-closed behavior, public field projections, backup/restore child processes and SQL scanning, OG origin pinning, CSP/JSON-LD sanitization, derivative serving, environment/secret handling, nginx/Docker/deploy scripts, and dependency configuration. Repository-wide scans also checked raw SQL, shell execution, exemptions/suppressions, file writes, and newly public schema fields.

I cross-checked `AGENTS.md`, the `CLAUDE.md` threat model, current carry-forward security/operator boundaries, the Cycle 10 security report, and every file changed since its review. The API-auth, action-origin, and public-route-rate-limit gates all passed; ESLint, typecheck, and the full unit suite were also green.

## Result

**No new security finding.**

The new `derivative_max_width` column is intentionally public-safe and contains only delivered pixel geometry. It was added to the exact public-safe fixture at `apps/web/src/__tests__/privacy-fields.test.ts:81-111`, while the symmetric sensitive-key guard remains intact in `apps/web/src/lib/data.ts:467-494`. Its producer overstatement is a correctness/contract defect, not a confidentiality or authorization exposure.

High-risk invariants remained present: guarded admin exports, same-origin-before-mutation action shapes, restore barriers, PAT scope checks, upload path/GPS protections, OG trusted-origin pinning, parameterized database calls/argument-array child processes, and sensitive public-select omissions. No tracked credential appeared, and local `master` equals `origin/master` at a valid GPG-signed HEAD.

## Final missed-issue sweep

I revisited restore/session revocation failure paths, upload cleanup after DB/filesystem boundary crossings, advisory-lock release-on-error, public analytics forgery limits, CSP inline-style posture, proxy/TLS assumptions, backup confidentiality, and scale-out weakening of process-local controls. Those are documented accepted/operator boundaries with unfired exit criteria, not new findings. No security issue needing manual validation was introduced by migration 0031 or the responsive-delivery change.
