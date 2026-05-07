# Architecture Review — Cycle 7

## Summary

The architecture is well-layered with clear separation between data access, business logic, and presentation. A few coupling issues and boundary leaks remain.

---

## C7-ARCH-01: `data.ts` serves as both DAL and cache/queue manager — Medium

**File:** `apps/web/src/lib/data.ts`

**Finding:** `data.ts` contains image/topic query functions (DAL responsibility) AND the shared-group view-count buffering logic (queue/background-job responsibility). The view-count buffer uses module-level `let` state, timers, and retry backoff — all concerns that don't belong in a data access module. This contributes to the god-module problem.

**Fix:** Extract `viewCountBuffer`, `flushGroupViewCounts`, and related state into a dedicated `lib/view-count-buffer.ts` module. `data.ts` should only expose `bufferGroupViewCount(groupId)` as a thin wrapper.

**Confidence:** Medium

---

## C7-ARCH-02: `rate-limit.ts` mixes three concerns (login, search, OG/checkout/share) without sub-modules — Low

**File:** `apps/web/src/lib/rate-limit.ts`

**Finding:** The rate-limit module exports login/account rate limiting, search rate limiting, OG rate limiting, checkout rate limiting, AND share rate limiting, plus IP normalization utilities and DB bucket management. At 350+ lines, it is approaching the threshold where sub-modules (`rate-limit/login.ts`, `rate-limit/public.ts`, `rate-limit/ip.ts`) would improve discoverability.

**Fix:** Deferred — the module is not yet at the pain threshold. If adding more rate-limit surfaces (e.g., smart collection queries), split into sub-modules.

**Confidence:** Low

---

## C7-ARCH-03: `gallery-config.ts` server-only module imports from `gallery-config-shared.ts` — correct pattern — Commendation

**File:** `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/gallery-config-shared.ts`

**Finding:** The split between server-only `gallery-config.ts` (imports `@/db`) and client-safe `gallery-config-shared.ts` (constants, types, validators) is a well-executed architectural boundary. The shared module is imported by both server and client code; the server module never leaks to the client. This pattern should be replicated for other server-only modules.

**Confidence:** N/A (commendation)

---

## C7-ARCH-04: `upload-tracker-state.ts` and `upload-tracker.ts` are separate but tightly coupled — Low

**File:** `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/upload-tracker.ts`

**Finding:** The upload tracker is split into two files for historical reasons but they share the same Map state. One file manages the Map (`getUploadTracker`, `pruneUploadTracker`) while the other manages claim settlement (`settleUploadTrackerClaim`). The separation adds navigation friction without clear benefit.

**Fix:** Merge into a single `upload-tracker.ts` module or rename to clarify responsibilities.

**Confidence:** Low

---

## C7-ARCH-05: Service Worker cache versioning uses inline string `d406815` — Low

**File:** `apps/web/src/public/sw.js`
**Lines:** 16

**Finding:** The SW_VERSION is `'d406815'` which is replaced at build time by `scripts/build-sw.ts`. However, if `build-sw.ts` fails silently or the build pipeline skips the replacement, the production SW would use a stale version string and fail to purge old caches. There is no runtime assertion that the version was actually replaced.

**Fix:** Add a runtime check in the SW: if `SW_VERSION === 'd406815'`, log a warning to the console. Or better, make the build fail if replacement doesn't occur.

**Confidence:** Low

---

## C7-ARCH-06: Smart collections AST compilation is safe but opaque — Low

**File:** `apps/web/src/lib/smart-collections.ts` (referenced in schema)

**Finding:** Smart collections compile a JSON AST to parameterized SQL. The schema comment notes "allowlisted columns, bounded depth, no raw concat," which is the correct defensive pattern. However, the AST validator depth bound is not visible in the schema, and a future developer might increase the depth limit without understanding the SQL-generation implications.

**Fix:** Add the depth bound and column allowlist as exported constants with comments explaining the security rationale.

**Confidence:** Low
