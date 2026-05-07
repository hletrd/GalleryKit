# Critical Review — Cycle 7

## Summary

This cycle's review surfaces one clear contradiction between security intent and implementation (rate-limit lint gate), one architectural tension (god module), and one process concern (deferred item accumulation).

---

## C7-CRIT-01: The rate-limit lint gate creates a false sense of security — High

**File:** `apps/web/src/scripts/check-public-route-rate-limit.ts`

**Finding:** The lint gate is documented as "SECURITY-CRITICAL" and "closes the cycle 2 RPF C2RPF-CROSS-LOW-03 gap." However, it deliberately excludes GET methods, and the codebase contains CPU-intensive GET routes (`/api/og/photo/[id]`) with NO rate limiting. The gate's own header claims it enforces rate limiting on "every PUBLIC API route file," which is technically true (mutating handlers), but the omission of expensive GET routes means the gate does NOT actually protect all public API abuse surfaces. This is a security-theater risk: future developers see a green CI gate and assume all public routes are protected.

**Fix:** Either expand the gate to cover GET routes that perform expensive work, or reword the header to be scrupulously accurate about coverage. The current wording is misleading.

**Confidence:** High

---

## C7-CRIT-02: `data.ts` deferred-extraction has been carried for 5+ cycles without action — Medium

**File:** `apps/web/src/lib/data.ts`

**Finding:** D3-MED (data.ts god module) and D2-MED (data.ts approaching 1500-line threshold) have appeared in deferred lists since cycle 2. The module is now at ~1480 lines and still growing. The pattern of deferring structural refactors while adding new features to adjacent modules works but creates a maintenance cliff — the longer the deferral, the harder the extraction.

**Fix:** Schedule the extraction as a dedicated cycle (not interleaved with feature work). The extraction is mechanical and low-risk.

**Confidence:** Medium

---

## C7-CRIT-03: `requireSameOriginAdmin()` and `withAdminAuth()` serve overlapping but slightly different purposes — Low

**File:** `apps/web/src/lib/action-guards.ts`, `apps/web/src/lib/api-auth.ts`

**Finding:** Server actions use `requireSameOriginAdmin()` (CSRF + origin check + auth verification). API routes use `withAdminAuth()` (PAT header + same-origin check + auth verification). The PAT path is only in `withAdminAuth`, but both check same-origin and both verify the admin session. The duplication is defensible (actions vs routes are different surfaces) but the subtle differences (PAT support, header setting) could confuse future maintainers.

**Fix:** Document the decision matrix: "Use `requireSameOriginAdmin()` for Server Actions; use `withAdminAuth()` for API Routes. PAT is only supported in API Routes."

**Confidence:** Low

---

## C7-CRIT-04: The build-time SW version replacement is invisible and unverified — Low

**File:** `apps/web/src/public/sw.js`, `apps/web/src/scripts/build-sw.ts`

**Finding:** The SW comment says "d406815 is replaced at build time" but there is no runtime verification that this actually happened. A broken build script or manual deployment that skips the build step would ship a stale SW version. The SW would still "work" but would never purge old caches, causing silent cache poisoning.

**Fix:** Add a build-time assertion or a runtime `console.assert(SW_VERSION !== 'd406815', ...)`.

**Confidence:** Low
