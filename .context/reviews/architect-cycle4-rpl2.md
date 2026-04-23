# Architect — Cycle 4 RPL (2026-04-23, loop 2)

Reviewer focus: architectural/design risks, coupling, layering.

## Architecture overview

- **Presentation:** `app/[locale]/(public)/**`, `app/[locale]/admin/**` (Next.js App Router).
- **API surface:** 3 module groups — server actions (`app/actions/**`), API routes (`app/api/**`), and the legacy barrel (`app/actions.ts`).
- **Business logic:** `lib/**` — data access (`data.ts`), image pipeline (`process-image.ts`, `image-queue.ts`), auth (`session.ts`, `auth-rate-limit.ts`), sanitization, validation, audit.
- **Persistence:** Drizzle ORM over MySQL.
- **Middleware:** `proxy.ts` (locale + admin route guard).

## Findings

### C4R-RPL2-ARCH-01 — Dual action-dispatch surfaces: barrel (`actions.ts`) + direct module imports [LOW] [MEDIUM]
**Files:** `app/actions.ts`, all `app/actions/**`

The barrel was historically the single facade; module imports were added later for new functionality. Today both patterns are in use. The barrel is **incomplete** (settings actions missing). A new contributor can't tell which pattern is authoritative. See CQ-02 for the remediation option.

**Architectural recommendation:** pick one direction (prefer direct imports — closer to Next.js 16 App Router conventions) and deprecate the barrel in a future cycle. For now, at least make the barrel complete to reduce ambiguity.

### C4R-RPL2-ARCH-02 — `data.ts` mixes multiple concerns: queries, caching, view-count buffering, SEO settings [LOW] [MEDIUM]
**File:** `apps/web/src/lib/data.ts` (894 lines)

Single module does:
- public/admin query field selection,
- view-count buffer + flush backoff,
- React `cache()` deduplication,
- SEO settings fetcher,
- search logic (3 sequential queries).

The privacy guard co-locates data-shape constants with the queries, which is good. The view-count buffer and SEO settings are arguably separate concerns. Splitting into `data/queries.ts`, `data/view-count.ts`, `data/seo.ts` would reduce cognitive load. Not urgent.

### C4R-RPL2-ARCH-03 — Session-secret dev fallback couples auth to DB availability [LOW] [LOW]
**File:** `apps/web/src/lib/session.ts`

In dev, first request after restart must wait for DB to issue a secret. In production this is explicit (env var required). This is the right architectural call; just documenting for completeness.

### C4R-RPL2-ARCH-04 — Action-guards.ts centralization vs. inline check [POSITIVE]

Good: `requireSameOriginAdmin()` centralizes the origin-check policy; every mutating action reuses it. This is the right pattern.

### C4R-RPL2-ARCH-05 — Rate-limit module has 2 in-memory Maps + DB buckets + 3+ helper files [LOW] [carry-forward D2-04]
**Files:** `rate-limit.ts`, `auth-rate-limit.ts`

The split between `rate-limit.ts` (base primitives) and `auth-rate-limit.ts` (login + password-change) is defensible. But the caller code (auth.ts, sharing.ts, admin-users.ts, public.ts, images.ts) imports from both and duplicates the in-memory Map idiom (`checkRateLimit` inside `createPhotoShareLink` vs. the DB bucket API). A single rate-limit façade (`RateLimiter` class with methods `check`, `increment`, `rollback`) would simplify. Carry-forward (D2-04).

## Confidence Summary

- 0 HIGH; 2 LOW/MEDIUM architecture items (ARCH-01, ARCH-02); 1 carry-forward; 1 positive.
