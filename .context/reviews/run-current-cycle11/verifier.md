# Cycle 11 Verifier Review

Date: 2026-07-18 KST
Reviewed HEAD: `7e40e95c`
Lane: verifier

## Inventory and coverage

Verified the 3,679-file tracked inventory by category (266 application source, 370 unit tests, 16 E2E, 29 scripts, 35 migrations, 20 configs, 8 current docs, 515 plans, 2,392 reviews, and remaining assets/support files). Used the newest plan/index and current source to resolve historical claims. Checked Cycle 10 acceptance criteria against the implementation, decoded-width E2E, migration/reconcile/privacy parity, GPG state, remote equality evidence, and live output. All static/build/audit gates and 3,447 Vitest tests passed during this review.

## VER-C11-01 — Search prefetch regression is reproducible and unguarded

- Severity: **Medium**
- Confidence: **High**
- Validation: **Confirmed behavior**, not an inference
- Regions: `apps/web/src/components/search.tsx:77-85`; `apps/web/e2e/public.spec.ts:21-49,52-69`.

Fresh-session verification produced this sequence:

1. Navigate to `/en`, wait for network idle: zero `/en/p/*` requests.
2. Open Search, fill `TWS`, wait 1.2 seconds: 20 result options mount.
3. Observe 16 successful dynamic `/en/p/{id}?_rsc=...` fetches for 10 unique ids; ids 343-348 are fetched twice with distinct `_rsc` values.

No result was focused, hovered, or activated. The request burst is therefore caused by result-list presentation, consistent with the default-prefetch `<Link>` at `search.tsx:77-85`. Existing E2E verifies focus/results/aliases but never asserts the network contract.

Concrete failure: the search UI can consume more backend work merely by showing answers than by the one search request itself, and repeated query refinements repeat the cost. Fix with `prefetch={false}` or a single explicit active-result prefetch policy, plus request-count coverage.

## Verification disposition and missed-issue sweep

- Cycle 10 truthful derivative descriptors: **verified closed**. Live markup ends at the intrinsic width (for example `_7680` advertised as `7384w` for a 7,384 px source), and the 1,200 px fixture coverage decodes the actual resource.
- Cycle 10 config alias removal: **verified closed**.
- Cycle 10 publication ledger: **truthful**; signed push is complete and the plan explicitly leaves deploy pending, so it was not refiled as stale.

Final sweep covered schema journal monotonicity, reconcile mirror, public privacy allowlist, queue/backfill persistence, generated SW parity, release signatures, and all search states. No additional acceptance failure was confirmed.
