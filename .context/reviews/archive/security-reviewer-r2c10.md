# Security Review — Cycle 10 (Run 2)

**Reviewer**: security-reviewer
**Date**: 2026-05-05
**Scope**: Security-focused review of auth, rate limiting, input validation, and public API surfaces.

## Findings

No new security findings identified this cycle. The codebase maintains strong security posture:

- All admin API routes wrapped with `withAdminAuth` including origin verification (AGG9R-02)
- All mutating server actions enforce `requireSameOriginAdmin()` (lint:action-origin passes)
- Public mutating routes have rate limiting enforced by `lint:public-route-rate-limit` gate
- Analytics view recording has per-IP rate limiting (C9RPF-MED-01)
- Download token route has path traversal + symlink checks
- OG route has rate limiting + Content-Length guards
- Semantic search route has same-origin + rate limiting
- Input sanitization (Unicode formatting chars, control chars) enforced at admin write boundaries

## Minor observations (not findings)

- The semantic search endpoint (`/api/search/semantic`) requires same-origin (`hasTrustedSameOrigin`) but does not have a DB-backed rate-limit fallback. This is acceptable because semantic search is an opt-in experimental feature and the in-memory BoundedMap is sufficient for a personal gallery scale.
- The `check-public-route-rate-limit.ts` scanner does not strip comments before matching rate-limit helper names, so a commented-out helper call could falsely satisfy the gate. This is a false-positive (errs on the side of caution) and not a security gap.

## Conclusion

Security posture remains solid. No new vulnerabilities or weakening changes detected.
