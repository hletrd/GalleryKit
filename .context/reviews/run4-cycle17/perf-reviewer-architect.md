# Perf-reviewer + architect — Run-4 Cycle 17

Single-subagent in-context pass (documented run-wide constraint).

## Findings

### PERF-R4C17-06 — per-photo OG generation round-trips every derivative attempt through an HTTP loopback (potentially the public edge) instead of reading from disk
- **Files:** `apps/web/src/lib/og-photo-fetch.ts:44-67` (`fetch(photoUrl …)`),
  `apps/web/src/app/api/og/photo/[id]/route.tsx:106-114`
  (`origin = new URL(req.url).origin`, comment "next/og (Satori)
  fetches images by HTTP — use origin from request").
- **Severity/Confidence:** MED-LOW / Medium (CONFIRMED mechanism;
  impact judgment).
- **Why:** the route does NOT hand Satori a URL — it buffers the bytes
  and embeds a base64 data URL. The HTTP fetch is therefore
  self-inflicted: each size attempt traverses the full request stack
  (and, when `req.url`'s origin is the public host, the reverse proxy)
  to read a file the process can open directly from
  `public/uploads/jpeg/`. Costs: extra socket + TLS round-trips per
  attempt, 10 s timeout machinery for a local read, the Host-header
  trust surface noted by the security angle, and double-buffering.
- **Counterweights (why this is not scheduled this cycle):** the chain
  is bounded (≤ 8 attempts, 1 MB cap, 10 s cap), responses are
  CDN-cacheable for a day, the shipped R24-M1 contract + tests lock the
  current shape, and a disk-read refactor must re-derive the safe-path
  containment guarantees the serve route already owns
  (SAFE_SEGMENT/lstat/symlink rejection) rather than bypass them
  casually. Risk of regression > present cost on a single-host
  deployment whose OG responses are edge-cached.
- **Disposition:** DEFER with exit criterion (see plan ledger):
  re-open when OG generation latency is observed/complained about in
  production, when the serve route is next restructured, or when a
  second internal consumer of derivative bytes appears (shared safe
  disk-read helper then pays for itself).

## Clean-pass surfaces

- `api/og/route.tsx`: rate-limit placed after cheap validation and
  before DB; ETag 304 short-circuit skips the Satori/PNG pipeline;
  success cache `public, max-age=3600, swr=86400`. Sound.
- `og/photo` byte caps: Content-Length pre-reject + post-buffer
  re-check; base64 expansion bounded (≤ ~1.37 MB embed). Sound.
- `gallery-config.ts`: single `getSettingsMap` round-trip per request
  (React `cache()`); per-key validation without extra queries. Sound.
- `db/index.ts`: pool 10 / queue 20 / keepalive matches CLAUDE.md;
  per-connection `group_concat_max_len` init awaited via symbol
  handshake — no per-query overhead beyond first checkout. Sound.
- `queue-shutdown.ts` + `instrumentation.ts`: pause→clear→onIdle drain
  under a 15 s race; `process.once` registration; gcInterval cleared.
  No leak, no double-drain (`shutdownPromise` singleton).
- `analytics-client.tsx`: server-aggregated rows; no client-side
  N+1; `toLocaleString` per cell is negligible at the row caps.
- `dashboard-client.tsx`: failed-images panel is bounded; retry is
  single-flight per id (`retryingId` guard).
- `map-loader.tsx`: `ssr:false` dynamic import keeps Leaflet out of
  the server bundle and the public-page critical path. Sound.
- `tag-input.tsx`: memoized filtering; no debounce needed at admin tag
  cardinality. Sound.
- `optimistic-image.tsx`: exponential backoff capped at 15 s; 1-retry
  cap for local uploads honors the atomic-rename contract (no
  pointless hammering). Sound.
- `clip-embeddings.ts`: scan/topK constants bounded
  (SEMANTIC_SCAN_LIMIT 5000); loops are O(n·512) without allocation
  churn. Sound for the stub tier.

## Architecture notes (no action)

- The settle-before-close dialog idiom now has a single canonical
  shape enforced by `alert-dialog-action-settle.test.ts` — the c16
  lock converted an unowned convention into a self-enforcing one.
  Good trajectory; no new wrapper primitive needed.
- `image-zoom-math.ts` consolidation removed the last duplicated
  anchor arithmetic; `image-zoom.tsx` is now a thin event-wiring layer
  over a tested pure module. Matches the repo's "extract the math,
  test the math" pattern (histogram, csv-escape, blur-data-url).
- OG routes: the policy split (charge post-DB) is an architectural
  contract, not a per-route tweak — after SEC-R4C17-01 lands, BOTH
  routes encode it in source-contract tests, which is the right
  enforcement layer for cross-route invariants in this repo.
