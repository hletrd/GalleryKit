# Debugger — Cycle 5 (review-plan-fix loop, 2026-04-25)

## Bug-hunt sweep

Re-checked baseline gates: lint, typecheck, lint:api-auth, lint:action-origin all clean (exit 0). Vitest 376/376 passing across 59 files.

Looked for race conditions, dangling resource lifetimes, error-path regressions in cycle-3/4 commits.

## New findings

### C5L-DBG-01 — `updateImageMetadata` strips control chars silently while `topics.ts` rejects [INFO] [Low confidence]

**File:** `apps/web/src/app/actions/images.ts:659-663` vs. `apps/web/src/app/actions/topics.ts:75-76, 174-175`.

**Why a problem.** `topics.ts` rejects when sanitization changes the value (`if (label !== rawLabel) return { error: t('invalidLabel') }`). `updateImageMetadata` silently strips control chars and persists the cleaned value. Both behaviours are correct individually but the asymmetry is undocumented. Strip-and-persist is preferable for `images.title`/`images.description` because admins paste from external editors with smart-quote / non-breaking-space artifacts; rejection is preferable for `topic.label` because labels are short, controlled, navigation-critical strings. Recommend documenting the asymmetry rather than aligning behaviour.

## No active runtime regressions detected
- All race-condition protections from prior cycles still in place.
- Background-job lifetime: queue concurrency, advisory locks, restore lock — unchanged.
