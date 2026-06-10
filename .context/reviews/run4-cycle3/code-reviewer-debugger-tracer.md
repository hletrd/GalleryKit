# Run-4 Cycle 3 — code-reviewer + debugger + tracer angle

Scope: full-inventory pass. Regression review of all 8 run4-cycle2 commits
(53e6722a..6d88c336), then deep reads on: image-queue.ts (full), sharing.ts (full),
stripe webhook route (full), checkout route (full), download route (full), LR upload
route (full), serve-upload.ts (full) + both uploads route handlers, public.ts (full),
retryFailedImage, process-image saveOriginalAndGetMetadata + parseExifDateTime,
session.ts, request-origin.ts, restore-maintenance ordering vs queue quiesce,
feed.xml route, og/photo route, semantic search route, analytics.ts, upload-limits.

## Regression review of run4-cycle2 commits — PASS

- `toMySqlDateTime` (53e6722a): correct local-component literal; only write site
  (`failed_at`) migrated. Swept the repo for the bug class: NO remaining
  `.toISOString()` writes into `datetime(mode:'string')` columns. `capture_date`
  writers (`parseExifDateTime` string/Date/number branches) all emit local-component
  `YYYY-MM-DD HH:MM:SS` literals. `sharedGroups.expires_at` (the third string-mode
  datetime) has no write site (checked sharing.ts + data.ts; read path guards
  `> NOW() OR IS NULL` at data.ts:1134-1135). Class closed.
- Scanner hardening (605e07db), ImageOff tile (6dea1f92), label code points
  (9d582f08), resolvedEmail log (6fc59264), 200 MiB single source (7a8cfdf5),
  recordTopicView slug pre-check (20f4c8cc), code-point Stripe title (927d15db):
  all verified correctly implemented; no behavioral regressions found.

## Findings

### COR-R4C3-01 — `/uploads/[...path]` HEAD handler drops the `'HEAD'` method argument (twin-route divergence)
- **Severity/Confidence:** MEDIUM / High (confirmed by direct source comparison)
- **Files:**
  - `apps/web/src/app/uploads/[...path]/route.ts:15-22` — `HEAD` export calls
    `serveUploadFile(pathSegments, ifNoneMatch)` with NO third argument.
  - `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:12-20` — twin
    route passes `'HEAD'` explicitly with the R20-L1 comment.
  - `apps/web/src/lib/serve-upload.ts:46-50` — `method: 'GET' | 'HEAD' = 'GET'`
    defaults to `'GET'`; the R20-L1 early return at lines 169-171 only fires when
    `method === 'HEAD'`.
- **Why it's a problem:** the NON-locale route is the primary derivative-serving
  path (all image URLs are root-relative `/uploads/{fmt}/...`), and the service
  worker's stale-while-revalidate HEAD probes (R11-M1) hit it. Because the method
  parameter defaults to `'GET'`, every SW HEAD revalidate that misses the ETag
  short-circuit runs `createReadStream(resolvedPath)` — opening a file descriptor
  and constructing a web stream whose body Next.js then strips for HEAD. The
  R20-L1 optimization is dead on the primary route; it only works on the
  locale-prefixed twin nobody fetches images through. The stale comment in the
  non-locale route ("NextResponse will strip the body for HEAD") predates R20-L1
  and was never updated when the twin was.
- **Failure scenario:** gallery page with 40 cached images; SW revalidates each on
  navigation; each HEAD whose ETag changed (or whose If-None-Match missed) opens an
  fd + stream that is discarded. Under crawler HEAD bursts (the exact scenario
  R20-L1 cites), fd churn and wasted stream setup on every request.
- **Fix:** pass `'HEAD'` in the non-locale HEAD export (mirror the twin), refresh
  the stale comment, and add a wiring test that locks BOTH route files passing the
  method through (see TEST-R4C3-07).
- **Class:** confirmed issue.

### COR-R4C3-02 — webhook dup-key race window re-mints the C3-RPF-07 dead-token log line
- **Severity/Confidence:** MEDIUM / Medium (logic confirmed from source; needs a
  narrow race to trigger in production)
- **File:** `apps/web/src/app/api/stripe/webhook/route.ts:300-344` + 373-387.
- **Why it's a problem:** idempotency is SELECT-first (line 300), then
  `INSERT … ON DUPLICATE KEY UPDATE` as "belt-and-suspenders against a race
  between the SELECT and the INSERT (two concurrent retries hitting between
  them)" (comment, lines 333-335). But when that exact race occurs, BOTH
  requests pass the SELECT, both call `generateDownloadToken()`, both INSERT.
  The loser's INSERT degrades to the no-op dup-key UPDATE — yet execution
  continues to line 373: it logs `Entitlement created` AND (under
  `LOG_PLAINTEXT_DOWNLOAD_TOKENS=true`) the `[manual-distribution]` line with
  ITS token, whose hash was never stored. That is byte-for-byte the C3-RPF-07
  failure mode (operator `tail`s the newest line, emails a dead token, customer
  404s) — fixed for the sequential-retry case, re-introduced for the concurrent
  case the comment itself anticipates.
- **Mechanics of the fix:** mysql2 without CLIENT_FOUND_ROWS reports
  `affectedRows`: 1 = fresh insert, 2 = dup-key update that changed values,
  0 = dup-key update to identical values. The no-op `set: { sessionId }` lands
  on 0 (or 2 under driver-flag drift) — never 1. Gate the two log lines on
  `affectedRows === 1` from the insert result so only the true inserter logs.
- **Class:** confirmed logic issue, low-probability trigger, high blast radius
  (operator emails dead token to a paying customer).

### COR-R4C3-03 — download route "usedRow" heuristic missing the `downloadedAt` condition its own comment claims
- **Severity/Confidence:** LOW / High
- **File:** `apps/web/src/app/api/download/[imageId]/route.ts:85-103`.
- **Why it's a problem:** the comment says "If a row exists for this image whose
  tokenHash is NULL **and whose downloadedAt is set**, treat that as
  already-used" — but the query only filters `isNull(downloadTokenHash)`.
  `refundEntitlement` (`apps/web/src/app/actions/sales.ts:211`) sets
  `{ refunded: true, downloadTokenHash: null }` WITHOUT touching `downloadedAt`,
  so a refunded-never-downloaded entitlement satisfies the heuristic. Result:
  any shape-valid-but-wrong token for that image (multi-buyer images included:
  customer B mistypes their token after customer A's purchase was refunded)
  returns 410 "Token already used" — actively misleading; the customer believes
  their single-use token is burned and opens a refund dispute.
- **Fix:** add `isNotNull(entitlements.downloadedAt)` to the usedRow WHERE so
  the heuristic matches its documented intent; mistyped/refunded-unknown tokens
  fall through to the accurate 404 "Token not found".
- **Class:** confirmed code-comment divergence with user-facing wrong-message
  effect.

## Verified-clean (no finding)

- `retryFailedImage` (images.ts:1042-1111): clears `processing_error`/`failed_at`,
  purges all three in-memory maps, re-enqueues with full color signals. Correct.
- Queue claim/retry/permanent-failure state machine (image-queue.ts:229-515):
  claim-retry escalation, FIFO map pruning, eviction cross-cleanup (C7-MED-05),
  conditional UPDATE + orphan cleanup all consistent. `failed_at` persistence now
  uses the fixed literal.
- Restore ordering: `beginRestoreMaintenance()` precedes `quiesce…()` (db-actions.ts:
  310→334) so `enqueueImageProcessing`'s maintenance check closes the
  `queue.start()` un-pause race.
- LR upload route: per-file 200 MiB cap enforced inside `saveOriginalAndGetMetadata`
  (process-image.ts:757); tracker claim/settle pairing symmetric on every branch;
  contract lock released in finally.
- sharing.ts rate-limit rollback symmetry (in-memory + DB) on every early return.
- checkout `getTierPriceCents` strict-integer parse; idempotency key deterministic.
- `loadMoreImages` / `searchImagesAction` / view-record actions: validation +
  bounded maps + rollback posture consistent.
