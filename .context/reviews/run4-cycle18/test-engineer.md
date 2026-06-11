# Run-4 Cycle 18 — test-engineer angle

Test inventory relevant to the rotation: 186 test files; the rotated
surfaces are covered by atom-feed.test.ts, feed-conditional.test.ts,
feed-sized-derivative.test.ts, locale-path.test.ts, base56.test.ts,
download-filename.test.ts, download-interstitial.test.ts,
download-route-method-contract.test.ts, stripe-download-tokens.test.ts,
stripe-webhook-source.test.ts, checkout-db-error-rollback.test.ts,
refund-clears-download-token.test.ts, semantic-search-*.test.ts (3),
clip-embeddings.test.ts, tag-slugs.test.ts, backup-download-route.test.ts.

## Coverage-gap findings (paired with this cycle's fixes)

### TEST-R4C18-01 — no lock on topic-feed locale validation (gap / High)

`feed-sized-derivative.test.ts` reads both feed route sources but only
asserts the R25-M1 sized-derivative contract. Nothing asserts the
locale param is validated — because it isn't (COR-R4C18-01). When the
fix lands, add a source-contract assertion to the existing suite (the
established pattern for route handlers that resist jsdom invocation):
the topic source must call `isSupportedLocale(` before
`getImagesForFeed(`, and must contain a 404 return on the rejection
branch. Prove failing pre-fix per the repo protocol.

### TEST-R4C18-02 — webhook deleted-image path unlocked (gap / Medium-High)

`stripe-webhook-source.test.ts` locks tier-allowlist, email-shape,
plaintext-token gating, and insertId disambiguation — but nothing pins
the `!currentImage` behavior (today: fall-through to a doomed FK
INSERT → 500 retry loop, COR-R4C18-02). With the fix, extend the
source-contract suite: (a) a `!currentImage` (or equivalent) branch
returning 200 exists between the currentImage SELECT and the INSERT;
(b) the INSERT catch references `ER_NO_REFERENCED_ROW_2` and returns
200 (received) rather than 500 for that code. Keep the existing
"transient DB error → 500 so Stripe retries" assertion intact —
the two outcomes must coexist in the catch.

### TEST-R4C18-03 — rate-limit pattern header has no doc-drift guard (note / Low)

DOC-R4C18-03 extends the rate-limit.ts header to four patterns. No
test proposed — prose headers are review-enforced; the per-bucket
CONTRACTS are already source-locked (og-route-source-contracts,
og-photo-fallback, checkout-db-error-rollback,
semantic-search-rate-limit). Decision recorded: locking prose would
be brittle without adding signal.

## Flake / hygiene sweep

- The c17 plan recorded one load-induced timeout in
  `backfill-detection-failure-contract.test.ts` under parallel gate
  load, passing in isolation and on quiet-machine full runs. Nothing
  in this cycle touches Sharp fixtures; keep the existing
  run-gates-sequentially mitigation, no threshold change.
- `semantic-search-rate-limit.test.ts` and
  `checkout-db-error-rollback.test.ts` both reset their buckets via
  the exported `reset*ForTests` helpers — no cross-file state leak
  observed in the rotated suites.
- `atom-feed.test.ts` covers escapeXml C0-stripping and the
  author/rights/enclosure shapes; `feed-conditional.test.ts` covers
  second-precision 304 boundaries including malformed headers. Good
  depth; no action.

## Validated assumptions (not taken on faith)

- Verified `capture_date` is `mode: 'string'` in schema before
  accepting the feed `summary` fallback as type-safe (a Date here
  would TypeError inside escapeXml).
- Verified `isSupportedLocale` is exported from lib/locale-path.ts
  (locale-path.test.ts exercises it) so TEST-R4C18-01's proposed
  assertion is implementable without new exports.
- Verified `hasMySQLErrorCode` is exported from lib/validation.ts and
  already imported by sharing.ts — the webhook fix needs only an
  import addition, no new helper.
