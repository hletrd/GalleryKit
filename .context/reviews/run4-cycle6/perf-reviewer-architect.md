# Run-4 Cycle 6 — perf-reviewer + architect angle

Inventory: the full image-serving path layer by layer (Next public/
static serving vs `app/uploads/[...path]/route.ts` →
`lib/serve-upload.ts` vs `nginx/default.conf` uploads location, verified
against LIVE production headers), `public/sw.template.js` strategies +
`lib/sw-cache.ts`, `scripts/build-sw.ts`, `next.config.ts` headers(),
`lib/data-timeline.ts` query shapes, `lib/analytics-data.ts`,
photo-viewer preload/prefetch machinery, lightbox timer/effect graph,
search debounce/request-id machinery, instrumentation shutdown path.

## Findings

### ARCH-R4C6-06 — Image derivatives: three contradictory cache policies; the documented one never executes in production
- **Severity/Confidence: MED / High (production-verified)**
- **Layers:**
  1. `lib/serve-upload.ts:216-238` — `Cache-Control: public, max-age=3600,
     must-revalidate` + `W/"v7-{mtime}-{size}-{settingsHash}"` ETag. The
     file's own comment chooses `must-revalidate` over `immutable`
     BECAUSE derivatives are rewritten in place by backfill re-encodes.
  2. `nginx/default.conf:146-152` — `expires 1y; add_header
     Cache-Control "public, immutable"` for the same paths. Directly
     contradicts (1): after a backfill re-encode under the SAME filename,
     immutable-cached clients keep stale bytes for up to a year.
  3. **Production reality** (live header probe): `cache-control: public,
     max-age=0` + `etag: W/"72e6e-19e0c0562c0"` — Next.js STATIC public/
     serving. Files live in `public/uploads/`, and public/ assets take
     precedence over route handlers, so `app/uploads/[...path]/route.ts`
     (and the whole serve-upload pipeline: versioned ETag, settings-hash
     invalidation P4-E2, 3600s caching) only ever executes for MISSING
     files and for locale-prefixed `/{locale}/uploads/...` URLs. The
     production host's nginx evidently lacks the repo's uploads location
     (config drift), so not even policy (2) applies.
- **Consequences:**
  - Perf: `max-age=0` forces a conditional revalidation round-trip per
    derivative per page view per client (304s, but still RTTs ×
    30-photo masonry pages).
  - Documented behavior false: CLAUDE.md asserts "immutable
    cache-control" on derivatives and presents the serve-upload ETag
    formula (incl. settings-hash invalidation) as the serving behavior;
    cycle R4C3/R4C4 even optimized that path (PERF-R4C3-05 / SWR
    debounce) believing it hot — in production it is cold.
  - Risk: if the repo nginx config IS ever applied as-is, policy (2)'s
    `immutable 1y` introduces the stale-bytes-after-backfill bug that
    serve-upload explicitly engineered against.
- **Fix (repo-side, deployment-independent):**
  1. `next.config.ts headers()`: add a `/uploads/:format(jpeg|webp|avif)/:file*`
     rule with `Cache-Control: public, max-age=3600, must-revalidate`
     (matches serve-upload; headers() demonstrably applies to public/
     assets in production — the global nosniff rule already lands on
     them). This single change fixes the production max-age=0 waste.
  2. `nginx/default.conf`: replace `expires 1y / immutable` with the
     same `max-age=3600, must-revalidate` policy + a comment explaining
     the in-place-rewrite hazard.
  3. CLAUDE.md: correct the serving-architecture description (static-first
     precedence; serve-upload handles locale-prefixed and missing paths;
     unified cache policy).
  4. Ops note (deferred ledger): production host nginx lacks the
     repo uploads location — record runbook; harmless once (1) lands.

### COR-R4C6-05 — Service-worker HTML offline fallback is provably dead in production
- **Severity/Confidence: MED / High (production-verified)**
- **Files:** `apps/web/public/sw.template.js:204-241`
  (`networkFirstHtml` + `isSensitiveResponse`), every public page
  (`export const revalidate = 0` × 9 pages).
- Every public HTML page ships `cache-control: private, no-cache,
  no-store, …` (Next dynamic rendering; live-verified). `isSensitiveResponse`
  returns true on `no-store`, so `networkFirstHtml` NEVER caches —
  `HTML_CACHE` stays empty forever and the offline path always returns
  `Response('Offline', 503)`. The US-P24 PWA promise ("HTML routes:
  network-first, 24 h fallback cache") has never functioned against the
  current rendering posture; the 24h-TTL eviction code, MAX_HTML_ENTRIES
  eviction and `sw-cached-at` stamping are all unreachable.
- Additionally `hasAdminSession()` (the only personalization guard) is
  dead — Cookie is a forbidden header in SW request objects (security
  facet in the security file).
- **Fix:** make the HTML cache an explicit, documented offline-only
  exemption: cache 200 GET text/html responses despite the framework
  default `no-store` WHEN (a) not 401/403, (b) not an admin route
  (existing bypass), and (c) not rendered with an admin session — the
  last via a new `x-gk-admin-render: 1` response header set by
  `proxy.ts` middleware (it can read request cookies; SW cannot).
  Entries remain served exclusively on network failure with the
  existing 24 h TTL. Update the template header comment + CLAUDE.md.
  Lock with template source-contract tests.

### TEST-R4C6-11 — lib/sw-cache.ts is tested-but-not-shipped and has diverged from the shipped template
- **Severity/Confidence: LOW-MED (test integrity) / High**
- **Files:** `apps/web/src/lib/sw-cache.ts:115-123` vs
  `apps/web/public/sw.template.js:98-108`
- Grep: NOTHING imports `lib/sw-cache.ts` except its own test. The
  template's `recordAndEvict` gained a quota-eviction guard
  (`if (deleted) total -= entry.size`) that the lib copy never got —
  the unit suite locks semantics the shipped SW does not have (lib
  unconditionally subtracts and overcounts `evicted` for entries the
  browser already evicted).
- **Fix:** backport the `deleted`-conditional accounting to the lib
  (keeping its `evicted` return meaningful), document that the template
  is the shipped copy and the lib is its tested reference, and add a
  source-contract test asserting the template carries the same
  conditional so future drift fails loud.

### Perf observations (no action this cycle)
- SW image path: the awaited HEAD probe on every cached-image hit adds
  one RTT before serving cached bytes — deliberate R10-H3/R11-M1
  trade-off, documented; with ARCH-R4C6-06's `max-age=3600` the browser
  HTTP cache will absorb most revalidate GETs.
- Lightbox `showControls` ref discipline avoids listener re-registration
  — good; effect graph is clean.
- `getTimelineImages` `YEAR(capture_date) = ?` is non-sargable; the
  comment overstates index coverage (it only uses the `processed`
  prefix). At personal-gallery scale this is fine; folded into the
  COR-R4C6-02 fix as a comment correction, not a query rewrite.
- `analytics-data` top-N queries group/sort per request — bounded by
  views volume; acceptable.
- photo-viewer responsive preloads emit per-format `<link rel=preload>`
  with cleanup — correct and bounded (2 neighbors × ≤2 formats).

## Architect verdicts
- The middleware-marker + SW-exemption design for COR-R4C6-05 keeps the
  trust boundary honest: the server (which CAN see cookies) makes the
  personalization decision; the SW merely honors it. Endorsed.
- For ARCH-R4C6-06, unify on serve-upload's `max-age=3600,
  must-revalidate`: it is the only policy that is simultaneously safe
  for in-place re-encodes, cheap for repeat views, and consistent across
  whichever layer happens to serve the bytes. `immutable` would require
  content-hashed filenames — a much larger migration, explicitly out of
  scope (HARD-SCOPE: no speculative rewrites).
