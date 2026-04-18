# Plan 29: Admin Refresh, Proxy Semantics, and Docs/Deploy Alignment — R8

**Priority:** MEDIUM
**Estimated effort:** 2-3 hours
**Sources:** Comprehensive audit 2026-04-18 findings #6, #7, #14, #15 and likely risk A
**Status:** COMPLETE

---

## Scope
- Admin category/user screen refresh behavior
- Trusted proxy IP parsing semantics and docs
- Docker/deploy documentation accuracy
- CLAUDE testing guidance accuracy

## Planned items
1. Refresh or optimistically update categories after successful mutations
2. Refresh or optimistically update admin users after successful mutations
3. Reconcile trusted-proxy IP parsing with documented nginx/CDN deployment behavior
4. Correct README/deploy script messaging about Docker/env expectations
5. Update CLAUDE testing guidance to reflect the real test suite

## Ralph progress
- 2026-04-18: Plan created from the full audit.
- 2026-04-18: Completed the admin-refresh/docs-alignment pass:
  - refreshed categories and admin users after successful mutations
  - aligned trusted-proxy IP parsing with left-most client semantics
  - documented `TRUST_PROXY=true` in the nginx-hosted deployment path
  - corrected Docker/deploy script messaging about required env vars and host assumptions
  - updated CLAUDE testing guidance to describe the real unit/E2E suite
