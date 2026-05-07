# Architect — Cycle 9 (2026-04-25)

**HEAD:** `35a29c5`

## Architectural posture

Stable. The cycle 8 work brought the OG route into parity with the
established public-unauthenticated-surface pattern (in-memory pre-increment
rate-limit + structured response shapes). The sitemap fix retains the
existing ISR pattern while patching the cycle-8-discovered build-prerender
fragility.

The repo continues to honor:
- single-process / single-writer runtime topology;
- defense-in-depth (Next config + nginx for headers; lint gates for
  api-auth and action-origin);
- explicit, comment-tagged plan IDs in committed code (excellent for
  trace-back).

## Findings

**Status: zero new MEDIUM/HIGH findings.**

### A9-INFO-01 — Six rate-limit Maps now (was five) (LOW / Medium)
- **Citation:** `apps/web/src/lib/rate-limit.ts` (`loginRateLimit`,
  `searchRateLimit`, `ogRateLimit`); `apps/web/src/app/actions/public.ts`,
  `actions/sharing.ts`, `actions/admin-users.ts`.
- **Note:** AGG8F-21 from cycle 8 said "defer until a 7th rate-limit type
  is added." The OG bucket added in cycle 8 is the 6th. We are still one
  away from the threshold. Continue deferring the factory abstraction.
- **Action:** **DEFER**.

### A9-INFO-02 — `lib/rate-limit.ts` is now the home for both in-memory and DB-backed rate-limit primitives (LOW / Low)
- **Citation:** the same file holds `ogRateLimit` Map plus
  `checkRateLimit/incrementRateLimit/decrementRateLimit/purgeOldBuckets`
  for the DB pattern. Both styles co-existing in one file is workable but
  could justify a split (`rate-limit-memory.ts`, `rate-limit-db.ts`) once
  more entries land.
- **Action:** **DEFER**. Threshold for splitting: when either the
  in-memory or DB section exceeds 200 LOC.

## Carry-forward

- A8F-04 (env-knob doc drift) — **CLOSED** by plan 236.
- A8F-05 (single-process invariant doc-only) — **DEFER**.

## Summary

No structural changes warranted. The architecture continues to scale to the
single-admin / single-MySQL-server target. Maintain status quo.
