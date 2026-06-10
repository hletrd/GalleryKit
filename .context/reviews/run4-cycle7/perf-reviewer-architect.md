# Run-4 Cycle 7 — perf-reviewer + architect angle

## Inventory & method
- Perf pass over the rotated surfaces: download/og streaming paths,
  smart-collection listing SQL, histogram worker pipeline,
  upload-dropzone object-URL lifecycle, upload-tracker pruning, rate-limit
  Map hygiene, build-sw script.
- Architect pass: method-routing contracts (Next auto-HEAD), validator/
  compiler layering in smart-collections, control-liveness contract in
  upload-dropzone, middleware matcher boundaries for the planned
  interstitial.

## Architectural findings

### ARCH (supports COR-R4C7-01/02) — "GET = claim" couples a state
transition to the most replayed HTTP method in existence
- The single-use claim is a one-way state transition; binding it to GET
  violates HTTP method semantics (GET MUST be safe, RFC 9110 §9.2.1) and
  is the root cause behind both the auto-HEAD burn and the
  scanner-prefetch burn. Every intermediary on the path (mail gateways,
  proxies, prefetchers, the framework's own HEAD synthesis) is ENTITLED
  to issue safe-method requests. Moving the transition to POST is not a
  workaround — it restores the protocol contract. The interstitial is
  the visible artifact of that correction.
- Framework-contract note: Next.js auto-implements HEAD from GET
  (vendored source verified) and 405s everything else, so adding POST +
  HEAD exports changes routing only for the methods we define — OPTIONS
  synthesis picks the new Allow set automatically.

### ARCH (supports COR-R4C7-03) — two sources of truth for "valid AST"
- `validateNode` (write-time) and `compilePredicate`/`compileTagPredicate`
  (read-time) encode different operator lattices. Single-source fix:
  per-column operator table consulted by validateNode so write-time is
  always at least as strict as compile-time. (Compile keeps its throws
  as defense in depth for pre-existing rows.)

## Perf findings (all LOW, none scheduled as standalone fixes)
- `getImagesForSmartCollection` uses `COUNT(*) OVER()` + GROUP BY +
  double LEFT JOIN per page — same shape as the main listing queries
  (shared `tagNamesAgg` contract); acceptable at current scale; nothing
  new this cycle.
- `og-photo-fetch` chain is sequential by design (ascending size bias);
  worst case 4 × 10 s timeouts before site-default fallback. Bounded and
  documented; no change proposed (HARD-SCOPE: no speculative parallel
  prefetch).
- `histogram.tsx` allocates a fresh 256² canvas per recompute — capped
  and infrequent (photo/format change, resize); worker terminated on
  unmount; AbortController prevents stale-resolution races. Clean.
- `upload-dropzone` object-URL map: incremental create/revoke verified
  leak-free including unmount sweep; per-file sequential upload is a
  documented server-lock constraint, not a perf bug.
- `pruneUploadTracker` O(n) sweeps with n ≤ 2000 — negligible.
- Interstitial fix perf note: the confirm page is a < 2 KB static-shape
  HTML render with zero DB writes on GET; the claim+stream POST is the
  exact current GET body. Net new cost ≈ one cheap GET per download.
  The entitlement SELECT moves from 1× to 2× per customer journey
  (interstitial + POST) — single-digit-row indexed lookups, irrelevant.

## Verified-clean (this angle)
- No N+1 introduced by cycle-6 commits; timeline limit+1 probe is a
  single query; checkout/webhook DB round-trips unchanged in count.
- `build-sw.ts` runs once per build; `execFileSync` git call guarded.
- Event-listener parity across all 10 listener-using components —
  balanced add/remove; no leak.
- Server-side `setInterval` census: only image-queue GC interval,
  cleared in `drainProcessingQueueForShutdown`.
