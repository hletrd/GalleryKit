# Tracer Review — Cycle 2

Date: 2026-07-18 KST
Review HEAD: `ba4bc60a`
Role: tracer
Mode: review-only causal/data-flow review

## Trace inventory

I read the repository rules and architecture first, inventoried all runtime,
route, action, schema, migration, operational, and test files, and constructed
end-to-end traces for: request headers to IP/rate-limit/analytics; login to
local/durable counters to Argon2/session rotation; multipart upload to quota,
original, privacy scrub, queue, derivatives, embeddings, and DB state; delete
to durable cleanup; restore request to leases, drains, import, migration, and
mutable stores; SSR image props to browser scheduling to hydration; search to
CLIP queue/vector ranking; migration journal to reconciliation; and deploy to
health/prune. Competing explanations were checked against tests and live
browser evidence.

## New finding

### TRC-C2-01 — Hydration corrects attributes but cannot undo the SSR image-request fan-out

- Severity: **Medium**
- Confidence: **High**
- Status: Confirmed new causal break (same root as PERF-C2-01)
- Trace: `apps/web/src/components/home-client.tsx:26-32` (`viewportWidth=0`,
  `count=2`) -> `:94-108` (unmeasured means five eager) -> `:299-309`
  (props) -> `apps/web/src/components/masonry-card.tsx:121-124,143-145`
  (HTML scheduling attributes) -> browser preload/parser ->
  `home-client.tsx:34-76` (effect changes final attributes)
- Test gap: `apps/web/src/__tests__/masonry-card-memo.test.ts:190-195`

The intended causal edge is "measure viewport, then choose its first row," but
the browser consumes the server attributes before that measurement exists.
At 320px, a fresh session showed all five AVIFs starting together at 62 ms;
after hydration, inspection showed only card 1 as eager. Thus final-state DOM
tests and DevTools inspection after load can falsely clear the regression.

Concrete failure scenario: monitoring sees a correct one-card mobile DOM while
real users still paid for the original five requests, hiding the bandwidth and
contention regression from normal assertions.

Suggested fix: encode responsive priority in a primitive the browser can
evaluate before requesting (for example media-qualified preloads), and test the
request timeline from a clean context before hydration.

## Revalidated carry-forward traces

### TRC-C2-R1 — Background DB reservations still do not compose

- Severity: **High**
- Confidence: **High**
- Status: Confirmed carry-forward
- Trace: `apps/web/src/db/index.ts:21-42` (10-connection pool) ->
  `apps/web/src/lib/image-queue.ts:121-153` (queue computes its own reserve) +
  `apps/web/src/lib/admin-backfill-runner.ts:109-142` (backfill computes the
  same reserve independently) + `apps/web/src/lib/background-db-writes.ts:34-75`
  (analytics writers)

Queue and backfill each reason as though their reserved live capacity belongs
only to them. If they overlap, their pinned locks/transient operations plus
analytics can consume the supposedly reserved foreground capacity. Replace
module-local arithmetic with a shared weighted admission ledger and expose the
lane totals in diagnostics.

### TRC-C2-R2 — A SQL restore has no generation link to mutable photo stores

- Severity: **Medium**
- Confidence: **High**
- Status: Confirmed explicit consistency boundary; manual operational validation required
- Trace: `apps/web/src/app/[locale]/admin/db-actions.ts:789-1027` changes DB
  generation; independent binds in `apps/web/docker-compose.yml` retain
  originals, derivatives, and topic resources

Locks make the database transition internally safe, but an older SQL snapshot
can resurrect rows whose files were removed and remove rows for files still on
disk. Add a paired backup manifest/generation and a post-restore reconciliation
report; document that full recovery requires the matching host snapshot.

## Competing hypotheses and final sweep

- The auth fix does not retain the cycle-1 failure edge: both process-local
  budgets advance before either durable increment awaits, and the durable
  calls use `Promise.allSettled` (`auth.ts:137-158`).
- The new mobile transfers are not ordinary near-viewport lazy loading: all
  five began at the same parser-time timestamp and the SSR helper explicitly
  marks exactly five eager.
- GeoIP failure observability now has a process-level error edge through
  `initializeGeoIp()` (`instrumentation.ts:12-16`, `analytics.ts:34-82`).

The closing trace covered auth/origin to mutation, public limiter to expensive
work, upload/delete/restore and every known writer, schema journal to apply,
cache validators to file replacement, request IP to analytics, and deploy to
recovery. No further new causal break was confirmed.
