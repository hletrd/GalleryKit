# Debugger Review — Cycle 2

Date: 2026-07-18 KST
Review HEAD: `ba4bc60a`
Role: debugger
Mode: review-only latent failure and diagnosability review

## Inventory and method

I read `AGENTS.md` and `CLAUDE.md`, inventoried the runtime/actions/routes/libs,
operational scripts and 374 test/e2e files, then reviewed exception, abort,
timeout, cleanup, shutdown, child-process, lock-release, temp-file, stale-state,
and hydration failure paths. I ran the focused 106-test regression set and used
a clean browser context plus console/page-error checks on production.

## New finding

### DBG-C2-01 — Post-hydration inspection masks the initial five-image mobile request burst

- Severity: **Medium**
- Confidence: **High**
- Status: Confirmed new diagnosability/test blind spot; same underlying defect as PERF-C2-01
- Regions: `apps/web/src/components/home-client.tsx:26-32,94-108,299-309`;
  `apps/web/src/components/masonry-card.tsx:121-124,143-145`;
  `apps/web/src/__tests__/masonry-card-memo.test.ts:190-195`

The source test proves the pure helper returns five eager cards before viewport
measurement, but it never observes browser requests. By the time a debugger
queries the page, the effect has rewritten cards 2-5 to `loading="lazy"` and
card 2 to `fetchpriority="auto"`. In a fresh 320px session the Network Timing
entries nevertheless showed five AVIFs start at 62 ms and transfer about 409
KiB total.

Concrete failure scenario: an engineer investigates mobile bandwidth after
load, sees only one eager DOM image and closes the incident as non-reproducible,
while the cold-start waterfall still includes four avoidable transfers.

Suggested fix: add a browser regression that records requests from navigation
start in a fresh context and asserts mobile/desktop budgets separately. Preserve
the trace/waterfall artifact on failure so the initial HTML decision is visible.

## Revalidated carry-forward failure modes

### DBG-C2-R1 — Deploy failure exits before the disk-pressure cleanup path

- Severity: **Medium**
- Confidence: **High**
- Status: Confirmed carry-forward recovery gap
- Region: `apps/web/deploy.sh:63-89,91-116`

Any build/start or health failure exits under `set -e` or at line 88 before the
only Docker prune block. On a host whose documented incident mode is disk
exhaustion, a failed build can leave more layers/cache and make the next deploy
less likely to succeed. Capture failure evidence, then run the same safe unused
artifact cleanup in an `EXIT` trap; retain prune-after-up for success and never
add `-a` to volume prune.

### DBG-C2-R2 — Pool starvation surfaces at the unrelated foreground victim

- Severity: **High**
- Confidence: **High**
- Status: Confirmed carry-forward
- Regions: `apps/web/src/db/index.ts:31-42`,
  `apps/web/src/lib/image-queue.ts:121-153`,
  `apps/web/src/lib/admin-backfill-runner.ts:109-142`, and
  `apps/web/src/lib/background-db-writes.ts:34-75`

Independent background caps can overlap and fill the pool queue. The resulting
timeout/500 is logged by whichever foreground query lost the connection race,
not by the background consumers that caused saturation. Centralize admission
and expose active/waiting counts by lane in health/diagnostic logs.

## Cleared paths and final missed-failure sweep

The new auth path still charges both local budgets when one durable increment
rejects; GeoIP packaging failure now logs once; Similar Photos re-arms its
mounted guard under Strict Effects; restore child processes have watchdogs and
cleanup ownership; upload serving closes descriptors on HEAD/abort; shutdown
drains are bounded and exit nonzero if truncated. Console/page-error checks on
the exercised public flows were clean. Rechecking unhandled promises, swallowed
exceptions, abort races, timers/listeners, lock releases, temp files, framework
pre-parse limits, deploy errors, and malformed migrations found no additional
new latent failure.
