# Run-4 Cycle 2 — code-reviewer + debugger + tracer angle

Scope: full-repo pass with emphasis on (1) the youngest code — last cycle's 9 commits
(`9d945ccd`..`4f27b98d`: LR PAT route hardening, `upload-filenames.ts`, `lr-tokens.ts`
sanitization, `migrate.js` fresh-DB bootstrap, photo-navigation z-20, serve-upload import
swap), (2) cross-file dataflow into MySQL, (3) failure-path behavior validated against a
LIVE MySQL 8 strict-mode instance (the running `gk-e2e-mysql` container), not assumptions.

Inventory walked: 14 action files, 10 API routes, lib/ (image-queue, process-image
EXIF/datetime surface, admin-tokens, upload-limits, upload-filenames, data.ts view-count
buffer, analytics-data), db/schema.ts, proxy.ts, instrumentation.ts, tokens UI client,
dashboard client, scripts (migrate.js diff, check-action-origin.ts, build-sw.ts), e2e
helpers. No file skipped that feeds the findings below; mature surfaces (color pipeline,
histogram, masonry, CSV escape) re-checked by spot audit only — they are under fixture
tests from earlier cycles.

## CONFIRMED FINDINGS

### COR-R4C2-01 — `failed_at` write uses ISO-8601 `Z` string that MySQL strict mode rejects: the R10-H2 failed-image surface never persists (HIGH / High)
- **File:** `apps/web/src/lib/image-queue.ts:477`
  ```ts
  .set({ processing_error: truncatedError, failed_at: new Date().toISOString() })
  ```
- **Schema:** `db/schema.ts:107` — `failed_at: datetime('failed_at', { mode: 'string' })`.
  Drizzle `mode: 'string'` passes the string through verbatim to mysql2; no conversion.
- **Evidence (live, not theoretical):** executed against the running MySQL 8 container
  (sql_mode `STRICT_TRANS_TABLES,...`, the stack's default):
  `INSERT INTO dt_test VALUES ('2026-06-10T13:55:00.000Z')` →
  `ERROR 1292 (22007): Incorrect datetime value`. MySQL accepts `T` as a delimiter and
  numeric `+HH:MM` offsets (8.0.19+), but NOT the `Z` suffix.
- **Failure scenario:** any image that exhausts MAX_RETRIES reaches the persist block; the
  UPDATE throws ER 1292; the catch at lines 479-481 logs
  `[Queue] Failed to persist processing error` and swallows it. BOTH columns
  (`processing_error` and `failed_at`) are lost because they share the UPDATE. Downstream:
  - `lib/data.ts:875-889` `getFailedImages()` filters `isNotNull(images.processing_error)`
    → always returns 0 rows.
  - `app/actions/images.ts:1067-1080` `retryImageProcessing` requires
    `isNotNull(processing_error)` → unreachable.
  - The admin dashboard "Failed images" panel (`dashboard-client.tsx:67-100`) never
    renders. The whole R10-H2 feature is dead in production, masked by its own catch.
- **Why tests missed it:** `image-queue-permanent-failure.test.ts` mocks `db.update` and
  never asserts the *format* of the written `failed_at` value.
- **Fix:** format as MySQL-native `'YYYY-MM-DD HH:MM:SS'` (server-local components,
  consistent with how mysql2 itself serializes `Date` objects and with
  `parseExifDateTime`'s Date branch in `process-image.ts:441-448`). Add a unit-test
  contract asserting the written value matches `/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/`.
- Confidence: High (reproduced against live MySQL 8 strict mode).

### COR-R4C2-04 — `createToken` label: silent UTF-16 truncation + surrogate-pair bisection (LOW-MED / High)
- **File:** `apps/web/src/lib/admin-tokens.ts:204` — `opts.label.trim().slice(0, 128)`.
- The repo's canonical policy (C7-AGG7R-02; re-affirmed last cycle in R4C1 COR-R4C1-04
  for the LR route title/description) is: validate by Unicode code points and reject
  loudly, never UTF-16 `.slice()` (which bisects surrogate pairs → mysql2's UTF-8 encoder
  writes U+FFFD mojibake), and never silently truncate admin-entered text.
- **Failure scenario:** an admin pastes a 128+-char label whose 128th UTF-16 unit is the
  lead half of an emoji → stored label ends in U+FFFD; the silent truncation also means
  the tokens list shows a different label than the admin typed, on a credential-management
  surface where label accuracy is how you decide WHICH token to revoke.
- **Fix:** `createLrToken` (action) rejects labels > 128 code points with a clear error;
  `createToken` (lib) keeps a defense-in-depth truncation that is code-point-safe
  (`Array.from(label).slice(0, 128).join('')`). UI `maxLength={128}` already aligns.
- Confidence: High.

### COR-R4C2-08 — Stripe checkout title truncation can bisect a surrogate pair (LOW / Medium)
- **File:** `apps/web/src/app/api/checkout/[imageId]/route.ts:140-142` —
  `image.title.slice(0, 199) + '…'` (UTF-16 slice). Same class as COR-R4C2-04: a title
  whose 199th unit is a lead surrogate puts U+FFFD on the customer's Stripe receipt.
- **Fix:** code-point-aware truncation (`Array.from(title)`), preserving the C2-RPF-14
  ellipsis behavior. Cosmetic-payment-surface fix, no behavior change for ASCII titles.
- Confidence: High that the defect exists; Medium severity (cosmetic, requires a ≥200
  code-unit title ending in an astral pair).

### COR-R4C2-07 — `recordTopicView` accepts arbitrary 255-char strings (LOW / Medium)
- **File:** `apps/web/src/app/actions/public.ts:353-366`. Unlike `loadMoreImages`
  (`isValidSlug` at line 81), the topic param is only length-checked. The FK on
  `topic_views.topic → topics.slug` (schema.ts:236) DOES reject garbage rows, so there is
  no integrity bug — but every junk call costs a doomed INSERT round-trip plus a
  `console.debug` line, and the asymmetry with the sibling action is a trap for future
  refactors (e.g. if the FK is ever dropped for analytics-table partitioning, this becomes
  injection-grade pollution rendered on the admin analytics page).
- **Fix:** add the same `isValidSlug(topicSlug)` pre-check. One line, fail-fast parity.
- Confidence: High that validation is absent; Medium impact (FK currently backstops).

## CHECKED — NO FINDING (explicit clears, tracer hypotheses closed)
- **LR PAT route end-state (route.ts):** insert-tail catch, tracker claim/settle pairing
  (claims at 231-233 happen with no interleaving await; both 429 paths return pre-claim),
  HDR gate ordering, GPS-strip ordering, late maintenance re-check, contract-lock
  release-in-finally — all verified consistent with the browser path. The unwrapped
  `enqueueImageProcessing` call (route.ts:400) is SAFE: `enqueueImageProcessing` never
  throws (early-returns on shutdown/maintenance/invalid/duplicate/permanent-fail), and a
  dropped enqueue is recovered by the `processed=false` bootstrap re-scan.
- **Per-file 200 MiB cap on LR path:** enforced inside shared
  `saveOriginalAndGetMetadata` (`process-image.ts:752`), so no browser/LR divergence.
  (But see ARCH-R4C2-06 in the perf/architect file: duplicate constant.)
- **migrate.js fresh-DB bootstrap (80a808e9):** reconcile + baseline now runs for empty
  DBs; `migrate-reconcile-coverage.test.ts` tripwire holds; post-condition assertion
  still validates every journal hash. No regression found.
- **photo-navigation z-20 fix (dd456239):** verified against the photo-viewer z-stack —
  the only z-10 siblings are the image wrapper (line 743) and the position counter (755);
  nav buttons + swipe indicators now sit at z-20 above both; counter is a later sibling
  of the image so it still paints. No newly-buried element.
- **`verifyToken` / `withAdminAuth` token path:** constant-time hash compare after indexed
  lookup; invalid token with valid cookie → 401 (no silent fallback) — matches comment.
- **view-count buffer (data.ts:20-140):** atomic Map swap, chunked flush, capped retry,
  backoff — re-validated; no new hazard.
- **proxy.ts admin guard:** format pre-check only (full crypto in server layer),
  documented; locale fallback correct; API routes excluded by matcher and documented.
- **mysql2 `Date`-object writes** (sessions, entitlements, admin_tokens `timestamp`
  columns): serialized by the driver to `'YYYY-MM-DD HH:MM:SS.mmm'` — valid; only the
  string-mode `failed_at` write is broken.
