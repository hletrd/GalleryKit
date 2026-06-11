# Run-4 Cycle 18 — code-reviewer / debugger / tracer angle

Inventory basis: line-level regression review of the three cycle-17 fix
commits (`c6091f2f`, `3b88cf97`, `68c9eb0c`) plus the two SW stamps;
rotation to the lowest-run-4-coverage clusters by mention-count map over
run4-c1..c17 review texts — the **feeds cluster** (atom-feed.ts,
feed-conditional.ts, app/feed.xml/route.ts,
app/[locale]/(public)/[topic]/feed.xml/route.ts, sitemap.ts), the
**i18n/nav/theme glue** (i18n-provider, nav-client, theme-provider,
locale-path), the **micro-libs** (backup-filename, download-filename,
upload-filenames, tag-records, tag-slugs, base56, download-tokens,
exif-datetime, action-result, csp-nonce, feature-flags), the **CLIP
cluster** (clip-embeddings, clip-inference, api/search/semantic,
actions/embeddings), the **payments cluster** (stripe.ts, license-tiers,
api/checkout/[imageId], api/download/[imageId], api/stripe/webhook,
actions/sales, download-interstitial), **actions** settings.ts /
sharing.ts, and the static shells (not-found, icon, apple-icon). No
file in the rotation set was sampled — each was read in full.

## Regression review of cycle-17 commits — SOUND

- `c6091f2f` — the two surviving `rollbackOgAttempt(ip)` calls sit on
  the syntactic id-validation rejections above `getImageCached`; all
  three post-DB paths charged with per-branch rationale comments; the
  flipped lock asserts exactly-2 + both-pre-DB + nothing-after-DB.
  Verified against the current route source. No follow-on.
- `3b88cf97` — aria-labels land on the `Link` (asChild) and on the
  disabled placeholder `Button`s; `toast.success` on the retry success
  branch; en+ko keys present. No follow-on.
- `68c9eb0c` — both loops warn with the generic key before `continue`;
  the rejected value is never echoed. No follow-on.

## Findings

### COR-R4C18-01 — topic feed route accepts ANY locale segment (CONFIRMED, MED-LOW / High)

- `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:32` —
  `const { locale, topic: topicSlug } = await params;` flows straight
  into `localizePath(locale, …)` (:49, :60) with NO validation.
- Why nothing else catches it:
  - The next-intl middleware never runs: `proxy.ts:140` matcher
    `'/((?!api|_next|_vercel|.*\\..*).*)'` excludes every dotted path,
    and `…/feed.xml` contains a dot.
  - The `[locale]/layout.tsx:83` `notFound()` guard applies to PAGES
    only — route handlers do not render through layouts.
- Failure scenario: `GET /kr/{valid-topic}/feed.xml` (typo'd locale,
  or any crafted string) returns **200** with a complete feed whose
  `<link rel="alternate">` and every entry `<link>`/`<id>` point at
  `/kr/...` URLs. Clicking an entry runs the middleware (no dot) →
  next-intl treats `kr` as a path segment → redirect to
  `/en/kr/p/123` → 404. Every subscriber of the typo'd URL gets a
  permanently broken feed, silently, CDN-cached for 30 min per
  arbitrary locale string (unbounded cache-key space).
- The raw `locale` lands in XML output, but `composeAtomFeed` escapes
  all attribute/text insertions (`escapeXml`) — no injection, purely a
  correctness/cache hole.
- Fix: `isSupportedLocale(locale)` (already exported from
  `lib/locale-path.ts`) → 404 before any DB work, mirroring the page
  contract. Add a source-contract or unit test.
- Tracer note (exhaustive sweep of other dotted handlers under
  `[locale]`): `(public)/uploads/[...path]/route.ts` ignores its
  locale param entirely (serves bytes; no URL synthesis) — not
  affected. Root `/feed.xml` has no locale param. sitemap/robots/
  icons are static paths. The topic feed is the only exposed surface.

### COR-R4C18-02 — Stripe webhook 500-retry-loops on paid-session-for-deleted-image (CONFIRMED, MED / Medium-High)

- `apps/web/src/app/api/stripe/webhook/route.ts:257-269` SELECTs
  `currentImage` for the C4-RPF-02 tier-drift warn but handles ONLY
  `currentImage && mismatch`; `!currentImage` (image deleted between
  checkout and webhook delivery, or between checkout and an async
  retry) falls through to the entitlement INSERT (:337).
- `entitlements.image_id` is `NOT NULL` + FK `references images.id
  onDelete cascade` (`db/schema.ts:280`) → the INSERT throws
  `ER_NO_REFERENCED_ROW_2` → caught at :363 → **500** → Stripe retries
  on its standard schedule (up to ~3 days), and every retry fails the
  same way. Result: sustained 500s + error-log noise, no entitlement
  row, no audit trail tying the PAID session to anything, and the
  operator discovers it only via Stripe dashboard alerts.
- Even a successful insert would be pointless: the FK cascade would
  have deleted the row the moment the image was deleted.
- Fix (two layers):
  1. At the existing `currentImage` SELECT: `if (!currentImage)` →
     `console.error('Stripe webhook: paid session for deleted image — manual refund required', { sessionId, imageId, tier, amountTotalCents })`
     → return 200 (permanent condition; Stripe must not retry).
  2. Belt-and-suspenders in the INSERT catch: on
     `hasMySQLErrorCode(err, 'ER_NO_REFERENCED_ROW_2')` (helper already
     exists in `lib/validation.ts`, used by sharing.ts:280) emit the
     same error log and return 200 instead of 500 — covers the
     SELECT→INSERT race window.
- Confidence Medium-High: FK shape and catch-all 500 are verified in
  source; the scenario requires an admin deleting a just-sold image,
  which the cascade design explicitly anticipates.

### OBS-R4C18-B — checkout id parsing accepts trailing garbage (record only, INFO)

- `apps/web/src/app/api/checkout/[imageId]/route.ts:90` —
  `parseInt('12abc', 10)` → 12, so `/api/checkout/12abc` charges image
  12's tier. Harmless (single path segment, parameterized PK lookup,
  same money outcome) but looser than the OG route's strict-digits
  validation. Not worth a change on its own; noted for the next time
  the file is edited.

### OBS-R4C18-C — `clampSemanticTopK(null)` yields 1, not the default (record only, INFO)

- `apps/web/src/app/api/search/semantic/route.ts:61-64` — `Number(null)`
  is 0 (only `undefined` falls back to the default), clamped to 1. Only
  reachable via hand-crafted JSON `{"topK": null}`; result is fewer
  results for the prober. Cosmetic.

### OBS-R4C18-D — empty-feed `<updated>` is request time (record only, INFO)

- Both feed routes: `feedUpdated = … : new Date().toISOString()` when
  the gallery/topic has zero processed photos → `Last-Modified` always
  "now", `If-Modified-Since` never matches → empty feeds are never
  304-served. Self-healing the moment one photo exists. Cosmetic.

## Clean-pass files (this angle)

atom-feed.ts (escapeXml strips C0; rejection of `type` on `atom:name`
correct per RFC 4287 §3.2); feed-conditional.ts (second-precision
compare; malformed headers degrade open); locale-path.ts;
photo-title.ts (`tag_names` split-on-comma is safe — tag-name charset
forbids commas); image-url.ts; base56.ts (rejection sampling at 224 =
4×56 is unbiased; refill guard sound); download-tokens.ts;
download-filename.ts; upload-filenames.ts; backup-filename.ts;
tag-records.ts; tag-slugs.ts; exif-datetime.ts (Date.UTC round-trip
catches day-32/Feb-30); csp-nonce.ts; action-result.ts;
feature-flags.ts; clip-embeddings.ts; clip-inference.ts;
actions/embeddings.ts (1/hour pre-increment correct);
actions/sharing.ts (dual-counter rollback symmetric on every
non-execute path); actions/settings.ts (contract-lock release in
finally covers every post-acquire return); actions/sales.ts
(already-refunded convergence; idempotency keys); download route (open
-before-claim ordering, handle closed on every failure path);
download-interstitial.ts; i18n-provider; theme-provider; nav-client;
not-found; icon/apple-icon; sitemap.ts (BASE_URL matches
getSeoSettings' env-first resolution — no canonical drift); audit.ts;
mysql-cli-ssl.ts; password-hashing.ts.
