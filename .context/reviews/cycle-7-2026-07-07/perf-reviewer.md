# Cycle 7 Performance / Concurrency Review

Role: `perf-reviewer`
Reviewed HEAD at start of pass: `14d31ea4` (briefing baseline). The shared worktree advanced one
further commit during this pass, `b4f57c6f` ("close review plan gaps") — reviewed as committed
state per the shared-worktree rules (dirty files from the initial `git status` snapshot, e.g.
`.context/reviews/perf-reviewer.md`, `sitemap.ts`, `settings-client.tsx`, `check-proxy-topology.mjs`,
were the peer committing that work mid-session). No peer-owned flat review file, `plan/` entry, or
`deferred-carry-forward.md` was read for anything other than context, and none were edited.

Scope: performance, concurrency, CPU/memory, DB query efficiency, connection-pool budget, and UI
responsiveness, with priority on the freshly-landed commits `9cd8d3e8` (db timeout hardening) and
`14d31ea4` (UI surface discovery), plus `d8fcb3d6`, `57e2c5d3`, `4d37daa4`, `05fa5cd1`, `3acf638a`.

## Method

- Diffed every commit listed in the briefing individually (`git show <sha>`) rather than relying on
  a single combined diff, to avoid missing a small perf-relevant hunk inside a mostly-cosmetic commit.
- Cross-checked the deferred-carry-forward register (`git show HEAD:.context/plans/deferred-carry-forward.md`)
  and the peer's own prior perf-review artifact (`git show HEAD:.context/reviews/perf-reviewer.md`,
  a "Cycle 14 Performance + Architecture Review" already covering map/backfill-pool/on-this-day/
  timeline-year/listing-tag-aggregation/analytics-fanout/semantic-brute-force/LR-upload-buffering)
  so as not to re-report ground the peer's own lane already covered in detail. None of those 12
  items are repeated here.
- Verified the two connection-lifecycle changes (`db/index.ts`, `topics.ts`) against the actual
  `mysql2` pool/connection source in `node_modules/mysql2/lib/base/pool.js` and
  `node_modules/mysql2/lib/promise/pool_connection.js` rather than assuming behavior from the diff
  alone.
- Quantified the one new finding below against real call-site counts (`grep -c`) in the masonry
  grid, lightbox, photo viewer, map, and search components.

## Findings

### C7-PERF1: Client-side `imageUrl()` re-validates and re-parses the CDN base URL on every call instead of once per page load

- `[SEV: LOW-MED | CONF: High | efficiency / hot-path]`
- File: `apps/web/src/lib/image-url.ts:26-31` (`resolveImageBase`), introduced by commit `05fa5cd1`
  which changed the browser branch from a raw dataset read to
  `sanitizeImageBaseUrlSafely(document.documentElement?.dataset?.imageBase)`
  (`apps/web/src/lib/content-security-policy.ts:1-46`, the `parseCspImageBaseUrl` /
  `sanitizeImageBaseUrl` / `sanitizeImageBaseUrlSafely` chain).
- Why it's a problem: `resolveImageBase()` is called on **every** invocation of `imageUrl()`, and
  `imageUrl()` is in turn called once per size/format variant by `sizedImageUrl()` /
  `sizedImageSrcSet()`. This is a genuine per-item render hot path — `grep -c` shows 4 call sites in
  `lightbox.tsx`, 4 in `masonry-card.tsx`, 13 in `photo-viewer.tsx`, 3 in `map-client.tsx`, 2 in
  `search.tsx`. A single masonry page can render up to `LISTING_QUERY_LIMIT` = 100 images
  (`apps/web/src/lib/data.ts:685`), and `MasonryCard` alone calls `imageUrl()` 6 times per card
  (2× AVIF srcset + 2× WebP srcset + 2× JPEG `src`, `apps/web/src/components/masonry-card.tsx:98-121`)
  — up to 600 calls on one initial mount, none of them memoized.
  Before `05fa5cd1`, the browser branch was a single optional-chained property read
  (`document.documentElement?.dataset?.imageBase ?? ''`). After `05fa5cd1`, every one of those 600
  calls now runs `sanitizeImageBaseUrlSafely` → `sanitizeImageBaseUrl` → `parseCspImageBaseUrl`,
  which — whenever `IMAGE_BASE_URL`/`data-image-base` is actually configured (the CDN-fronted
  deployment case the env-var table documents) — constructs a fresh `new URL(value)`, checks
  protocol/environment/credential/query/hash, and rebuilds `origin + pathPrefix`, wrapped in a
  try/catch, on every single call. None of this is memoized: the parsed/sanitized result cannot
  change during a page's lifetime (the `<html>` `data-image-base` attribute is stamped once by the
  locale layout and is not re-stamped on client-side navigations within the same locale), so the
  repeated parsing is pure waste.
- Failure scenario: on a CDN-fronted deployment (`IMAGE_BASE_URL` set), loading a 100-photo masonry
  page performs on the order of 600+ `new URL()` constructions plus validation branches purely to
  re-derive the same string every time, instead of once. `MasonryCard` is wrapped in `React.memo`
  (`apps/web/src/components/masonry-card.tsx:175`) so steady-state re-renders are mostly avoided, but
  every initial mount, "load more" page, lightbox open, and photo-viewer navigation re-runs the full
  cost with no caching. In the default (no CDN, `IMAGE_BASE_URL` unset) case the added cost is much
  smaller because `parseCspImageBaseUrl` short-circuits on the empty/undefined value before
  constructing a `URL` — but it still adds several extra function-call frames per image versus the
  prior single property read, on every call, in every one of the five component families above.
- Suggested fix: cache the sanitized value the first time it is read in the browser (module-scope
  variable, lazily populated on first client call — preserving the existing "must stay inside the
  function, not module scope, for SSR/hydration parity" contract documented in the comment above
  `resolveImageBase`):
  ```ts
  let cachedImageBase: string | null = null;
  function resolveImageBase(): string {
      if (typeof document !== 'undefined') {
          if (cachedImageBase === null) {
              cachedImageBase = sanitizeImageBaseUrlSafely(document.documentElement?.dataset?.imageBase);
          }
          return cachedImageBase;
      }
      return IMAGE_BASE_URL;
  }
  ```
  This keeps the lazy-read-after-hydration behavior (still reads `document` only when first called
  client-side, not at module-eval time) while turning an O(calls) cost into O(1) per page load.
- Confidence / validation: High confidence the code path and call counts are as described (read
  directly from source, verified call-site counts with `grep -c`). The magnitude is
  needs-manual-validation — this deployment does not currently run `IMAGE_BASE_URL` (per
  `CLAUDE.md`'s C4-25 note that cross-origin image-base is not yet configured in production), so
  today's real-world cost is the smaller "extra call frames on the cheap path" case, not the full
  `new URL()` case. Recommend a quick `performance.now()` microbench or React Profiler pass around
  `MasonryCard` mount before/after the fix if `IMAGE_BASE_URL` is ever turned on.

## Checked — no new regression found

- **`apps/web/src/db/index.ts:108-121` (commit `9cd8d3e8`)** — on an init-query timeout, the pooled
  connection is now `.destroy()`'d instead of `.release()`'d. Verified against
  `node_modules/mysql2/lib/base/pool.js` (`_removeConnection` / `releaseConnection`) and
  `node_modules/mysql2/lib/promise/pool_connection.js` (`destroy()` correctly proxies to the
  underlying callback connection's `destroy()`, which removes it from `_allConnections`). This is a
  correctness fix (the prior behavior could return a still-busy connection to the free pool and
  desync the next query); the only perf cost is that the *next* `getConnection()` call after a rare
  init-timeout must fully re-establish a TCP+auth connection rather than reusing a (would-have-been
  broken) session. Given `POOL_CONNECTION_LIMIT = 10` and this only fires on an extreme-load 10s init
  timeout, this is not a meaningful regression versus the prior unsafe behavior.
- **`apps/web/src/app/actions/topics.ts:69-96` (commit `3acf638a`)** — same pattern: on
  `RELEASE_LOCK` failure the connection is now destroyed rather than released back to the pool, to
  avoid leaking the `gallerykit_topic_route_segments` advisory lock. Same reasoning applies: rare
  failure path, correctness over a negligible reconnect cost. No pool-budget hazard introduced
  (topic mutations are low-frequency admin operations, not a hot path).
  The two connection-destroy changes were checked in tandem because they're the two places this
  cycle where a `.release()` became a `.destroy()` — confirming both are the same deliberate,
  narrow-scope tradeoff rather than a pattern spreading somewhere it shouldn't.
- **`apps/web/src/lib/request-origin.ts:45-81` (commits `d8fcb3d6`, `57e2c5d3`)** — `Host` is now
  checked before `X-Forwarded-Host` as a fallback. Same handful of `new URL()`/string-split calls as
  before, just reordered; this only runs on mutating server actions (via `requireSameOriginAdmin`),
  not a per-render or per-image hot path. No measurable perf change.
- **`apps/web/src/components/info-bottom-sheet.tsx` (commit `14d31ea4`)** — adds
  `<SimilarPhotos key={image.id} .../>` to the mobile bottom sheet. Confirmed this only mounts when
  `isOpen` is true (the component's `if (!isOpen || !image) return null;` guard at line 207 gates the
  whole JSX body, including `SimilarPhotos`), and `SimilarPhotos` itself only fetches on first
  manual expand (`fetchedRef`/`handleToggle`), not on mount. Swiping through photos with the sheet
  closed does not mount or fetch anything extra.
- **`apps/web/src/components/nav-client.tsx`, `search.tsx`, `photo-navigation.tsx` (commit
  `14d31ea4`, `4d37daa4`)** — DOM-order/label/aria-attribute changes only; no new state, effects, or
  computation added.
- **`apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx` /
  `tags/tag-manager.tsx` (commit `14d31ea4`)** — `initialTopics.find(...)` /
  `initialTags.find(...)` added per render to resolve the delete-confirmation label. Admin-only,
  small in-memory arrays, negligible cost; not worth a finding.
- **`apps/web/src/app/sitemap.ts` (commits `14d31ea4`, `b4f57c6f`)** — added a handful of static
  locale-scoped sitemap rows (`/timeline`, `/map`, `/privacy`, `/about-gallerykit`); this is a
  build/ISR-time route, adds single-digit rows, and the existing `reservedNonImageUrls` budget
  arithmetic was updated in the same commits to still respect `MAX_SITEMAP_URLS`. No issue.
- **`apps/web/src/lib/content-security-policy.ts` (commit `9cd8d3e8`)** — one more literal string
  appended to the `GA_CONNECT_SOURCES` array (`https://www.google.com`). Negligible.
- **`apps/web/src/app/[locale]/admin/db-actions.ts` (commit `9cd8d3e8`)** — `armDbChildProcessWatchdog`
  reordered so `onTimeout(err)` fires after the SIGKILL grace timer is armed rather than before, and
  the cleanup closure only calls `markSettled()` when the watchdog hasn't already fired. This is a
  30-minute admin-only DB backup/restore watchdog, not a hot path; the reordering is a correctness
  fix (callback ordering / no double-settle), not a perf change.
- **`scripts/check-proxy-topology.mjs`, `apps/web/scripts/run-e2e-server.mjs`** — ops/E2E tooling,
  not part of the production request path.

## Final sweep for commonly-missed issues

- Re-checked `apps/web/src/db/schema.ts` indexes against `apps/web/src/lib/data.ts` query shapes for
  any newly-introduced WHERE/ORDER BY without a matching index; neither file changed in this cycle's
  commits (confirmed via `git log -- apps/web/src/lib/data.ts apps/web/src/db/schema.ts
  apps/web/src/lib/image-queue.ts apps/web/src/lib/process-image.ts`, all last touched well before
  the commits in scope), so no new N+1/index gap was introduced this cycle. Existing gaps
  (on-this-day `MONTH()`/`DAY()`, timeline `YEAR()`, backfill `pipeline_version`, map row cap,
  listing tag-aggregation-before-limit, analytics fan-out, semantic brute-force scan, LR-upload
  buffering) are already tracked in the deferred register (`C2-12`, `C2-14b`, `C2-16`, `C2-21`,
  `C6-05`, `C6-21`) and/or the peer's own prior "Cycle 14" perf-reviewer pass; none had a new exit
  criterion fire this cycle.
- Confirmed the connection-pool budget (`POOL_CONNECTION_LIMIT = 10`, `queueLimit: 20`) was not
  touched, and that the two `.release()` → `.destroy()` changes (above) do not change steady-state
  pool sizing, only rare-failure-path behavior.
- Checked Sharp/libvips concurrency config (`SHARP_CONCURRENCY`, `process-image.ts`) — untouched
  this cycle.
- Checked `proxy.ts` / `next.config.ts` / middleware for per-request cost changes — untouched this
  cycle except the one-line CSP array addition noted above.
- Verified no new synchronous/blocking work was added to any API route or server action in the
  commits reviewed; the only new client-executed logic is the `imageUrl()` re-validation (C7-PERF1)
  and the trivial admin `.find()` lookups (not flagged).

**Summary: 1 new finding (C7-PERF1, LOW-MED).** Everything else in the freshly-landed commits was
either a correctness fix with negligible/rare-path perf cost, or non-perf-relevant UI/copy/tooling
change. No re-report of already-deferred or peer-already-documented performance items.
