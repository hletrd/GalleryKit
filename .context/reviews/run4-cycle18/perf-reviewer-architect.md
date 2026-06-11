# Run-4 Cycle 18 — perf-reviewer / architect angle

Same rotation inventory as the code angle.

## Findings

### OBS-R4C18-A — feed route duplication is a demonstrated drift hazard (LOW / High — DEFER with exit criterion)

- `app/feed.xml/route.ts` and
  `app/[locale]/(public)/[topic]/feed.xml/route.ts` duplicate ~90
  lines verbatim: `toIso`, entry building, per-entry author logic,
  feed-updated reduce, rights resolution, Last-Modified derivation,
  304 branch, response headers.
- This is not hypothetical: R25-M1 had to patch BOTH routes in
  lockstep for the same bug, and COR-R4C18-01 (this cycle) exists
  precisely because the topic copy has one extra input (locale) whose
  handling the root copy never needed. A shared
  `buildFeedResponse(entries-input)` would have made the locale
  parameter an explicit, reviewable seam.
- Deferral rationale: extraction is a refactor with no current bug
  once COR-R4C18-01 lands; the R25-M1 lock test
  (feed-sized-derivative.test.ts) pins both sources today. Exit
  criterion: the NEXT functional change to either feed route (third
  lockstep edit proves the cost), or a third feed surface appears.

### Perf sweep — clean

- Feed routes: 3 bounded queries (settings + config + 50-row listing
  with GROUP_CONCAT) behind `max-age=600, s-maxage=1800` — fine.
- `composeAtomFeed`: 6 sequential regex replaces × ~7 fields × 50
  entries — microseconds; no quadratic growth.
- `sitemap.ts`: ISR 3600 s; budget arithmetic caps at 50 k URLs;
  build-time DB-absence tolerated with homepage-only fallback. Fine.
- Semantic route: 5000 × 512-dim cosine ≈ 2.6 M mul-adds per request
  (~ms), 30/min/IP, and mode-gated OFF in production config. Fine.
- `embeddings.backfillClipEmbeddings`: 1/hour/admin, concurrency 2,
  batches of 100, capped at 5000 rows. Fine.
- Checkout/webhook/download: PK lookups + single Stripe call; the
  download path streams from an open handle with autoClose. Fine.
- `nav-client`: matchMedia listener cleaned up; rAF-debounced collapse
  on pathname change; no resize-storm re-renders. Fine.
- `generateBase56`: 2× pool with refill — no syscall storm. Fine.
- In-memory rate-limit maps all bounded (2000/500 keys) with prune-on
  -write. Fine.

## Architect notes

- The middleware-matcher dot-exclusion (`proxy.ts:140`) is a
  LAYERING decision with a sharp edge: every dotted route handler
  under `[locale]` silently opts out of BOTH the i18n redirect AND
  the CSP/admin-guard middleware. Today only the topic feed is
  exposed (uploads ignores locale; admin has no dotted handlers).
  COR-R4C18-01's in-route validation is the right local fix; the
  architectural rule to record: **any new dotted route under
  `[locale]` must self-validate its locale param** — worth one
  sentence in the route file comment when fixed, since the matcher
  cannot express "dotted but still localized".
- Webhook deleted-image handling (COR-R4C18-02): the proposed
  200-on-permanent-condition matches the route's own established
  taxonomy (malformed metadata → 200 + error log; transient DB → 500
  + retry). The FK-specific catch is required because the SELECT
  check alone reintroduces a TOCTOU the rest of this codebase
  consistently closes (cf. sharing.ts ER_NO_REFERENCED_ROW_2
  recovery).
- Pattern registry (DOC-R4C18-03): rate-limit.ts's header is the
  single place new rate-limited surfaces are told how to behave; it
  predates the charged-post-validation posture. Extending it is
  architecture documentation, not prose polish — the c17 incident
  demonstrated the header's examples propagate into code.
