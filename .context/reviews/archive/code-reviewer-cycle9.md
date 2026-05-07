# Code Reviewer — Cycle 9 (2026-04-25)

**HEAD:** `35a29c5 docs(plan): mark plan-233 (AGG8F-01 OG route) as DONE`
**Scope:** Diff since `0d3916b` (cycle-8 baseline) + spot sweep of unchanged hot
surfaces (data layer, auth, image pipeline, public actions) for any cycle-8
regressions.

## Diff inventory (cycle 8 → cycle 9)

| File | LOC delta | Change class |
|---|---|---|
| `apps/web/src/app/api/og/route.tsx` | +59 | feat: rate-limit + ETag + cache-control |
| `apps/web/src/lib/rate-limit.ts` | +45 | feat: `preIncrementOgAttempt`, `pruneOgRateLimit` |
| `apps/web/src/__tests__/og-rate-limit.test.ts` | +60 (new) | test |
| `apps/web/next.config.ts` | +7 | sec: Permissions-Policy directives |
| `apps/web/nginx/default.conf` | +4 | sec: Permissions-Policy directives |
| `apps/web/.env.local.example` | +17 | docs |
| `apps/web/src/app/sitemap.ts` | +41 | perf+fix: ISR enable + DB-offline tolerance |

Every committed change has a comment block citing its source plan and AGG ID.
Changes are tightly scoped; no drive-by refactors snuck in.

## Findings

**Status: zero new findings of MEDIUM or higher severity.**

Cycle 8 promoted six findings to plans (233–238); five landed (OG route,
sitemap config, sitemap DB-offline, Permissions-Policy, env docs, JSON-LD
test). Plan 238 (skip JSON-LD on noindex) was scheduled but not yet
implemented as of HEAD. That is **carry-forward**, not a new finding —
captured in plan-238 already.

### CR9-INFO-01 — `tagList` validation order is awkward but correct (LOW / Medium)
- **Citation:** `apps/web/src/app/api/og/route.tsx:70`
- **Code:**
  ```ts
  tags ? tags.split(',').filter(Boolean).slice(0, 20).map(t => t.trim()).filter(t => isValidTagName(t)) : []
  ```
- **Why noteworthy:** the `slice(0, 20)` runs **before** `isValidTagName`
  filtering. If a caller passes `?tags=` with 20 invalid tags followed by 5
  valid ones, the valid ones are silently dropped. Not a security or
  correctness defect — the route still renders correctly with whatever
  passes the tag filter — but reorder would more closely match operator
  intent.
- **Suggested order:** trim → filter Boolean → filter isValidTagName → slice(20).
- **Confidence:** Medium.
- **Action recommended:** **DEFER**. The OG route is a brand-decoration
  surface; nobody is going to construct adversarial 20-invalid-tag URLs.

### CR9-INFO-02 — sitemap fallback emits `console.warn` during build (LOW / Low)
- **Citation:** `apps/web/src/app/sitemap.ts:43`
- **Why noteworthy:** during `next build`, the DB is intentionally
  unreachable, so the warn line will print on every build. Operators
  reading build logs may be alarmed. The comment block above already
  explains the design; a one-time warn is acceptable.
- **Action recommended:** **DEFER**.

### CR9-INFO-03 — OG ETag does not include `OG_SUCCESS_CACHE_CONTROL` itself (LOW / Low)
- **Citation:** `apps/web/src/app/api/og/route.tsx:75-78`
- **Why noteworthy:** purely theoretical. If the cache-control string ever
  changes per-request (it does not today; it is a module-level constant),
  CDNs would serve a stale value with the new ETag.
- **Action recommended:** **DEFER**. No present-day defect.

## Cross-file review

- `getClientIp` is the same helper used by login + search + admin-users
  rate limiting. The OG route adopts it correctly.
- `preIncrementOgAttempt` matches the shape of `preIncrementSearchAttempt`
  in `actions/public.ts` for symmetry.
- `pruneOgRateLimit` follows the eviction pattern of `pruneSearchRateLimit`.
  No drift between the in-memory bucket implementations.

## Summary

Cycle 8 implementations are clean and well-commented. No new MEDIUM or
HIGH findings. Three INFO-level observations recorded; all valid for
deferral per repo policy.
