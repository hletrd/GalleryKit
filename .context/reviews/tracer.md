# Tracer — Deep Review (cycle 3 / HEAD b1e9e0da)

Evidence-driven causal tracing of six riskiest end-to-end flows. Each flow traced
to its real code boundaries at HEAD `b1e9e0da8466b10113ac5a6065d570382f92c292`.
File:line citations are against the working tree at that HEAD.

Prior-cycle closed items deliberately NOT re-reported: CLIP embedding round-trip
(now raw-buffer, image-queue.ts:453-461), serve-upload fd leak (AGG-H5 abort
listener, serve-upload.ts:267-290), map-query LIMIT. CLIP semantic search is
disabled-by-design and is NOT proposed for activation.

---

## Summary of defects found

| # | Flow | Finding | Severity | Confidence |
|---|------|---------|----------|------------|
| D1 | Upload | Crash/SIGKILL between original-write and DB-insert orphans the `original/` file permanently — no sweep exists for that directory | LOW | High |
| D2 | Docs | CLAUDE.md says settings-hash covers "5 COLOR_IMPACTING_KEYS"; code covers 9. Stale doc, not a code defect | LOW (doc) | High |
| D3 | Backfill | `detection-failed` path is correct, BUT a permanently-undetectable row re-encodes every backfill pass (no progress guard) — wasted-work loop, not data corruption | LOW | Medium |

No CRITICAL or HIGH defects found. Flows 4 (auth), 5 (SW admin-render), and 6
(Stripe) are **clean** at HEAD — the suspected bypass/gap in each is already
closed. Details and the disconfirming evidence for each below.

---

## Flow 1 — Upload → temp → PQueue claim → Sharp encode → conditional UPDATE → orphan cleanup

### Flow (actual path)
1. `uploadImages()` (`actions/images.ts:268` loop) → `saveOriginalAndGetMetadata(file)` (`process-image.ts:800`) streams the original to `UPLOAD_DIR_ORIGINAL/{uuid}{ext}` via `createWriteStream(..., {mode:0o600})` (`process-image.ts:823`).
2. DB `INSERT` with `processed:false, pipeline_version:IMAGE_PIPELINE_VERSION` (`images.ts:382`, values at 333-380).
3. `enqueueImageProcessing({...})` fire-and-forget (`images.ts:441`).
4. Queue job (`image-queue.ts:255`): `acquireImageProcessingClaim(job.id)` → `GET_LOCK('gallerykit:image-processing:{id}', 0)` non-blocking (`image-queue.ts:195-212`).
5. Claim-check `SELECT ... WHERE id=job.id AND processed=false` (`image-queue.ts:286-291`).
6. `fs.access(originalPath)` (`image-queue.ts:296`) → `processImageFormats(...)` parallel AVIF/WebP/JPEG.
7. Verify all 3 outputs non-zero (`image-queue.ts:355-366`).
8. Conditional `UPDATE ... SET processed=true ... WHERE id=job.id AND processed=false` (`image-queue.ts:370-372`).
9. If `affectedRows===0` → deleted-mid-processing → `deleteImageVariants(..., [])` full-scan cleanup of all 3 dirs (`image-queue.ts:374-391`).

### Hypotheses
- **H1: A file can be orphaned.** (original dir vs derivative dirs)
- **H2: An image can be double-processed** across a restart boundary (two workers).
- **H3: An image can be marked `processed=true` WITHOUT derivatives.**

### Evidence

**H1 — CONFIRMED for the `original/` directory (D1, LOW).**
- For-loop happy path: original written at `images.ts:280`, then INSERT at `:382`. On any *thrown* error inside the try the `catch` at `images.ts:464-470` calls `deleteOriginalUploadFile(savedOriginalFilename)` — so a normal failure cleans the original. **Evidence for safety.**
- BUT a hard process kill (SIGKILL / OOM / container stop) between `:280` and the INSERT commit at `:382` leaves the `original/{uuid}` file on disk with **no DB row** referencing it. **Evidence for orphan.**
- The only orphan sweep is `cleanOrphanedTmpFiles()` (`image-queue.ts:32-73`), which scans **only** `UPLOAD_DIR_WEBP/AVIF/JPEG` for `*.tmp` (`:33`). There is **no readdir/sweep of `UPLOAD_DIR_ORIGINAL`** for files lacking a DB row (`grep` for `readdir.*original` finds only the LEGACY-dir migration warning in `upload-paths.ts:85`, not a sweep). **Evidence the orphan is permanent.**
- Derivative `.tmp` orphans (crash between link and rename inside `processImageFormats`, `process-image.ts:1598` writes `tmpPath` mode 0o600) ARE swept at bootstrap (`image-queue.ts:689`). So H1 is **scoped to the original dir only.**
- Severity LOW because: (a) it's disk-bloat, not a correctness/serving defect — an orphaned original is never served (not under a public dir) and never referenced; (b) requires an ungraceful kill in a sub-second window; (c) the filename is a random UUID so it cannot collide with a future upload. Re-open criterion: if a periodic "originals with no matching `images.filename_original` row" reaper is wanted for long-running hosts.

**H2 — REFUTED. No double-processing across restart.**
- Two workers (restart boundary, or `retryFailedImage` re-enqueue racing the live queue) both attempt `GET_LOCK('gallerykit:image-processing:{id}',0)`. The lock is MySQL-SERVER-scoped (`advisory-locks.ts:40`, doc C8R-RPL-06). The loser gets `acquired!==1` → `null` → claim-retry path (`image-queue.ts:262-283`); it does NOT process. **Evidence against double-encode.**
- Even if the lock were somehow bypassed, the conditional `UPDATE ... WHERE processed=false` (`image-queue.ts:372`) means only ONE worker's UPDATE matches; the loser sees `affectedRows===0` and cleans its own variants (`:374-391`). **Independent second line of evidence.**
- The backfill runner claims the SAME per-image lock (`admin-backfill-runner.ts:343-359`, TRC-R5C2-01) so a backfill re-encode of a `processed=true` row cannot interleave-write with a `retryFailedImage` re-encode of the same id. **Cross-path evidence.**

**H3 — REFUTED. `processed=true` is never set without verified derivatives.**
- The `UPDATE ...processed=true` (`image-queue.ts:370`) is reached only AFTER the three-format `verifyFile` `Promise.all` (`:359-363`) and the `if (!webpOk||!avifOk||!jpegOk) throw` (`:364-366`). A missing/zero-byte derivative throws before the UPDATE → retry → eventual permanent-fail path (`:485-543`), leaving `processed=false`. **Direct evidence.**

### Conclusion
H1 confirmed (D1, LOW — original-dir orphan on ungraceful kill, no reaper). H2/H3
refuted — the advisory-lock + conditional-UPDATE pairing is sound across restart.
**No double-process, no processed-without-derivatives.**

---

## Flow 2 — Backfill (admin runner + sidecar) → advisory lock → re-encode → detection → DB write

Traced `admin-backfill-runner.ts` line by line. Core question: does the
"detection fails AFTER successful re-encode → `pipeline_version` NOT bumped →
retry later" claim actually hold?

### Flow
- `triggerAdminBackfill()` (`:816`) → `acquireBackfillLock()` non-blocking `GET_LOCK(gallerykit_color_pipeline_backfill,0)` (`:303-322`) → `runBackfill(lockConn)` fire-and-forget (`:855`).
- `runBackfill` (`:617`): resets tallies, reads config, `resolveBackfillConcurrency` (`:663`), keyset-paginated `fetchCandidateBatch(cursor)` `WHERE processed=TRUE AND (pipeline_version IS NULL OR pipeline_version < CURRENT) AND id>cursor` (`:400-408`), each row → `reprocessOne` via PQueue.
- `reprocessOne` (`:442`): access-check original → width guard → per-image claim → `processImageFormats` → `detectColorSignals` → conditional UPDATE.

### Hypotheses
- **H1: detection-failure path bumps version** (would strand color metadata) — the historically-fixed bug.
- **H2: detection-failure path leaves a no-progress loop.**
- **H3: deleted-mid-reencode orphans derivatives.**

### Evidence

**H1 — REFUTED at HEAD. The claim holds.**
- `signals` is `null` only when the detection `try` threw (`:551-554` sets `detectionError`, leaves `signals=null`).
- When `signals` is truthy → the FULL UPDATE incl. `pipeline_version = CURRENT` runs (`:557-570`). **Bumps only on detection success.**
- When `signals` is null → a DIFFERENT UPDATE runs that sets ONLY `was_downscaled`/`avif_10bit` and **does NOT touch `pipeline_version`** (`:594-599`), then returns `{ok:false, reason:'detection-failed'}` (`:609`). Since candidate selection is `pipeline_version < CURRENT` (`:404`), the row stays a candidate. **Direct evidence the resume contract holds.** Fix documented inline at `:580-593` (R-run2c1 AGG-01), locked by `__tests__/admin-backfill-runner-detection-failure.test.ts` per CLAUDE.md.
- Sidecar parity: CLAUDE.md states `backfill-color-pipeline.ts` "already has the correct semantics (no version bump on detection failure)"; the runner now matches.

**H2 — CONFIRMED as a minor inefficiency (D3, LOW).**
- A row whose source is *permanently* undetectable (e.g. a corrupt ICC block that always throws in `detectColorSignals`) will: re-encode successfully every run, write the `was_downscaled`/`avif_10bit`-only UPDATE (`:594`), return `detection-failed`, and **remain a candidate forever** because `pipeline_version` never advances. Each subsequent backfill invocation re-encodes it again (full Sharp AVIF/WebP/JPEG fan-out) with no progress. **Evidence for a wasted-work loop.**
- This is the deliberate trade-off of the resume contract (retry transient detection failures), so it is correct for transient failures but unbounded for permanent ones. Severity LOW: backfill is operator-initiated (not continuous), the encode is idempotent (no corruption), and a permanently-undetectable source is rare. Re-open criterion: if a `detection_attempts` counter / dead-letter is wanted to stop re-encoding chronically-failing rows. Confidence Medium — depends on whether any real source deterministically throws in detection (most detection failures are transient I/O).

**H3 — REFUTED. Deleted-mid-reencode is handled in BOTH update branches.**
- Success branch: `affectedRows===0` → `cleanupDeletedMidReencodeVariants(row)` (`:573-576`) full-scan `deleteImageVariants(..., [])` (`:430-440`).
- Detection-failed branch: the `was_downscaled`-only UPDATE ALSO checks `affectedRows===0` → same cleanup (`:605-608`). **Both branches covered** — derivatives for a row deleted mid-encode are removed, no orphan. Matches the queue worker (`image-queue.ts:374-391`).

### Concurrency-cap correctness (secondary)
- `resolveBackfillConcurrency` (`:129-142`) guards non-finite `poolLimit` (test-mock `@/db` omitting `POOL_CONNECTION_LIMIT`) by falling back to 10 (`:137`), preventing a NaN concurrency that "would silently freeze PQueue" (`:135-136`). cap = `floor((10-5-1)/2)=2` at shipped pool size. Pool-exhausted claim acquire treated as `locked` skip, not error-spin (`:485-490`). **Sound.**

### Conclusion
The detection-failure resume claim **holds** (H1 refuted — the historical
version-bump bug is fixed and test-locked). H3 refuted. D3 (LOW) is a no-progress
re-encode loop for permanently-undetectable rows — wasteful, not corrupting.

---

## Flow 3 — ETag generation & cache invalidation (static path vs serve-upload path)

### Flow
Two serving paths (R4C6 ARCH-R4C6-06, CLAUDE.md):
- **Static path** (existing files in `public/uploads/`): Next.js static server emits `W/"{size-hex}-{mtime-hex}"`. Cache policy `public, max-age=3600, must-revalidate` via `next.config.ts headers()`.
- **serve-upload path** (`app/uploads/[...path]` route, and `/{locale}/uploads/...`): `serve-upload.ts:215` emits `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"`.

### Hypothesis
**H1: A color-setting flip fails to invalidate cached variants on one or both paths.**

### Evidence

**serve-upload path — invalidates correctly. REFUTED.**
- `settingsHash = await getServingColorSettingsHash()` (`serve-upload.ts:214`) → `getColorSettingsHash(config)` (`:63`) → `buildHashFromConfig` over all 9 keys (`settings-hash.ts:72-85`). A flip of any of the 9 `COLOR_IMPACTING_KEYS` (`settings-hash.ts:37-49`) changes the hash → changes the ETag → `must-revalidate` forces 304→200. **Direct evidence.**
- The 5s TTL + stale-while-revalidate (`serve-upload.ts:50-83`) bounds skew to "≤5s + one refresh latency" — documented acceptable. SW also probes via HEAD `If-None-Match` (`sw.js:236-253`) and serves the network 200 when the ETag differs (R10-H3). **Consistent end-to-end.**

**Static path — invalidates via mtime+size only, NOT via settings hash. Correct-by-construction.**
- The static-server ETag is `{size}-{mtime}` only — it does NOT contain the settings hash. **Evidence the hash does not ride the static path.**
- BUT a color-setting flip is operationally followed by a **backfill re-encode** (CLAUDE.md: "Flipping any of these requires a backfill pass"). The re-encode rewrites the derivative file in place → mtime AND size change → static ETag changes → revalidation. So invalidation on the static path "rides the mtime+size ETag" (CLAUDE.md ETag section). **Documented and correct design** — the static server cannot read admin settings, so the only honest invalidation signal is the re-encoded bytes.
- Risk window: between the setting flip and the backfill completing, the static path serves OLD bytes with an unchanged ETag. This is **by design** — the bytes genuinely haven't changed until backfill rewrites them. A hash-only invalidation there would force a needless 200 of identical old bytes. **No correctness defect.**

**D2 (LOW, doc-only).** CLAUDE.md "ETag / cache invalidation" section says the
settings hash "covers all **5** `COLOR_IMPACTING_KEYS`" and lists 5. The code
(`settings-hash.ts:37-49`) and the serve-upload comment (`serve-upload.ts:199-202`)
both correctly say **9** (the 5 color keys + 3 quality keys + image_sizes). The
hash FORMULA is correct; only the CLAUDE.md prose is stale. settings-hash.ts:6-7
even notes "AGG-R7-08 corrected this docstring from a stale 3-key summary" — the
CLAUDE.md copy was not similarly corrected. No functional impact.

### Conclusion
Cache invalidation is **correct on both paths** for the real operational flow
(flip → backfill). serve-upload invalidates immediately via the 9-key hash; static
invalidates via re-encode mtime+size. D2 is a stale CLAUDE.md count (says 5, code
does 9), doc-only.

---

## Flow 4 — Session auth: cookie → proxy.ts guard → isAdmin() → timingSafeEqual

### Flow
1. Middleware `isProtectedAdminRoute(pathname)` (`proxy.ts:54-74`) matches `/[locale]/admin/*` and `/admin/*` but NOT the bare login page.
2. Cookie format pre-check: `token.length >= 100` (`proxy.ts:90`) AND `token.split(':').length===3` with no empty segments (`proxy.ts:103`), else redirect to login. **Format only — no crypto here.**
3. Server action / page: `isAdmin()` (`auth.ts:54`) → `getCurrentUser()` (`auth.ts:33`, React-cached) → reads `COOKIE_NAME` (`auth.ts:24-25`) → `verifySessionToken(token)` (`session.ts:94`).
4. `verifySessionToken`: split → 3 parts (`session.ts:99-100`) → HMAC-SHA256 expected sig (`:108`) → **length-equality guard then `timingSafeEqual`** (`:113-119`) → shape asserts AFTER crypto (`:121-125`) → age check ±24h (`:127-134`) → DB lookup by `sha256(token)` (`:136-139`) → expiry check + lazy delete (`:145-148`).

### Hypotheses
- **H1: Bypass — a request reaches a protected route without a valid session.**
- **H2: TOCTOU between the middleware format check and the action crypto check.**
- **H3: Timing oracle in `verifySessionToken`.**

### Evidence

**H1 — REFUTED. No bypass.**
- The middleware is a CHEAP gate (format + redirect), explicitly NOT the auth boundary: "Full cryptographic validation happens in verifySessionToken() within server actions" (`proxy.ts:84-85`). Every mutating admin action independently calls `requireSameOriginAdmin()` (`action-guards.ts:37`) and pages/actions call `isAdmin()`. **Defense in depth — the middleware is not load-bearing for crypto.**
- API routes are EXCLUDED from the middleware matcher (`proxy.ts:140`, comment :137-139), but `/api/admin/**` routes are independently gated by `withAdminAuth(...)` enforced by the `lint:api-auth` blocking gate (CLAUDE.md Lint Gates). **No matcher-gap bypass.**
- A forged cookie of correct *format* (length≥100, 3 colon-parts) passes the middleware but fails HMAC `timingSafeEqual` (`session.ts:117`) → `verifySessionToken` null → `isAdmin()` false. **The format check cannot be leveraged into access.**

**H2 — REFUTED. No exploitable TOCTOU.**
- The middleware check and the action check read the SAME cookie value from the same request; no attacker-controlled mutable state sits between them, and the cookie cannot change mid-request. The middleware's only output is "redirect or continue" — continuing still hits the full crypto check. **No window.**

**H3 — REFUTED. Timing-oracle-hardened.**
- `timingSafeEqual` requires equal-length buffers, so the code length-guards FIRST and returns null on length mismatch (`session.ts:113-115`) — the only length-dependent early exit, leaking only the signature-hex *length* (fixed at 64 for any real token). The byte comparison is constant-time (`:117`).
- Crucially, the `random`/`signature` shape regexes run AFTER the crypto compare (`:121-125`) with the explicit comment "so these checks cannot be used as a timing oracle" (`:121-123`). A forged token fails HMAC first. **Direct evidence the ordering is deliberate and correct.**
- Production refuses DB-fallback session secret (`session.ts:30-36`) — signing key lives only in env, outside the user-data trust domain. **Forgery-on-DB-compromise closed.**

### Conclusion
**Clean.** The middleware is a non-load-bearing format gate; the real boundary is
`verifySessionToken` with correct constant-time ordering (HMAC → shape → age → DB)
plus per-action `requireSameOriginAdmin()` + `isAdmin()` defense in depth. No
bypass, no TOCTOU, no timing oracle.

---

## Flow 5 — Service worker networkFirstHtml: does an admin-personalized page ever get cached as offline fallback?

### Flow
- `proxy.ts:128-130`: `if (request.cookies.get('admin_session')) response.headers.set('x-gk-admin-render','1')`. **Set on cookie PRESENCE** (not validity), on the `intlMiddleware`-produced response.
- `sw.js networkFirstHtml` (`:271`): caches into `HTML_CACHE` only `if (networkResponse.ok && networkResponse.headers.get('x-gk-admin-render') !== '1')` (`:279`).
- Admin routes never reach `networkFirstHtml` anyway — `isAdminRoute(pathname)` bypasses to network at the fetch dispatcher (`sw.js:357-358`).

### Hypothesis
**H1: An admin-personalized HTML response gets stored in the shared offline HTML cache** (would serve admin content to a later anonymous / different-client visitor offline).

### Evidence

**H1 — REFUTED. The exclusion is sound and conservative.**
- The header is set whenever the `admin_session` cookie is **present** (`proxy.ts:128`), regardless of token validity/expiry. So ANY request carrying the cookie — even on a public page like `/en/p/123` — gets `x-gk-admin-render:1` → the SW refuses to cache it (`sw.js:279`). **The decision is over-inclusive in the SAFE direction.**
- For the cache to be poisoned with admin content, a response would have to be (a) admin-personalized BUT (b) carry NO `admin_session` cookie. Admin personalization in this app requires the cookie (the page reads it via `getCurrentUser`), so (a)∧¬(b) is unreachable. **The failure mode is structurally impossible.**
- The header reflects only the requester's own cookie back to that same client (`proxy.ts:124-127`) — discloses nothing cross-user.
- Pinned by contract test: `sw-template-contract.test.ts:35,41` pin the exact `!== '1'` guard in the template; `:161-162` pin `headers.set('x-gk-admin-render','1')` in proxy.ts. The template (`sw.template.js:279`) and the built `sw.js:279` match. **Drift-locked.**
- HTML cache is offline-ONLY (served only in the network-failure `catch`, `sw.js:294-310`), 24h TTL (`:303`), 50-entry cap (`:128-145`).

### Secondary observation (not a defect)
- The HTML cache stores 200 GET HTML DESPITE `Cache-Control: no-cache` from dynamic rendering (deliberate exemption, `sw.js:8-17`, R4C6 COR-R4C6-05). The image path keeps full `isSensitiveResponse` semantics (pinned `sw-template-contract.test.ts:50-55`); only the HTML path takes the narrow exemption, gated by `.ok` + `x-gk-admin-render`. Consistent with the documented design.

### Conclusion
**Clean.** An admin-personalized page can never be cached as an offline fallback —
the `x-gk-admin-render` exclusion fires on cookie presence (safe over-inclusion),
admin routes bypass entirely, and the unsafe case (admin content without the cookie)
is structurally unreachable. Contract-test-locked against drift.

---

## Flow 6 — Stripe webhook → entitlement row (async_payment_succeeded gap)

### Flow
- Checkout: `POST /api/checkout/[imageId]` (`route.ts:68`) → rate-limit → image/tier/price validation → `stripe.checkout.sessions.create` with **`payment_method_types: ['card']`** (`:207`) and `metadata{imageId,tier}` (`:223-226`).
- Webhook: `POST /api/stripe/webhook` (`route.ts:57`) → `constructStripeEvent` signature verify (`:74`) → on `checkout.session.completed` (`:88`) → **gate `session.payment_status === 'paid'`** (`:105`) → metadata/email/tier/amount validation → idempotency SELECT by `sessionId` (`:320-324`) → INSERT entitlement + token (`:357-365`).

### Hypothesis
**H1: A bank-transfer / async-payment customer pays but never receives an entitlement** (money-taken-no-goods).

### Evidence

**H1 — CONFIRMED-as-DOCUMENTED-and-OPERATIONALLY-CLOSED. Not an exploitable defect at HEAD.**
- The webhook does NOT handle `checkout.session.async_payment_succeeded` — CLAUDE.md admits this and the route comment confirms "a future cycle should add a handler" (`webhook/route.ts:98-99`). **The handler genuinely does not exist.** This is the gap the prompt asks to confirm — confirmed.
- WHAT a bank-transfer customer ACTUALLY experiences at HEAD: they **cannot initiate** an async payment. The checkout session is pinned to `payment_method_types: ['card']` (`checkout/route.ts:207`). SEPA/ACH/bank-transfer/OXXO/Boleto are not offered in the hosted Checkout UI, so the customer never reaches a completed+unpaid state. Inline rationale at `checkout/route.ts:196-206`: "Forcing card-only makes completed+unpaid unreachable, closing the gap operationally. DO NOT add async methods here before the async_payment_succeeded handler ships."
- Defense in depth: even IF an async method were used (coupon-modified / SDK-created session), the webhook's `payment_status !== 'paid'` gate (`webhook/route.ts:105`) returns `{received:true}` 200 WITHOUT minting an entitlement or token, logging `console.warn` for `'unpaid'` (the documented async happy-path, not a PagerDuty `console.error`, `:106-110`). A completed+unpaid event is a no-op, not a false entitlement. **Two independent barriers: card-only at creation + paid-gate at webhook. The money-no-goods scenario requires BOTH to fail.**

### Other webhook paths verified clean
- Idempotency: SELECT-by-sessionId (`:320`) is the primary guard; `onDuplicateKeyUpdate({set:{sessionId}})` (`:365`) + `insertedFresh = affectedRows===1 && insertId>0` (`:382`) correctly disambiguates a fresh insert from a no-op dup-key loser under mysql2's FOUND_ROWS flags (R4C3/R4C5, `:366-382`). The dup-key loser returns without logging a dead plaintext token (`:419-421`). **Dead-token hazard closed.**
- Deleted-image: a paid session for a deleted image returns 200 + manual-refund error log (no Stripe retry storm) both at the pre-check (`:273-281`) and in the FK-violation catch `ER_NO_REFERENCED_ROW_2` (`:390-398`). **Permanent condition handled without retry loop.**
- Zero-amount (coupon to $0) rejected (`:299-305`); oversized/malformed email rejected with 200 (`:153-189`); unknown tier rejected (`:231-235`). All return 200 for permanent metadata errors (no retry storm), 500 only for transient DB errors (`:412`).

### Conclusion
The async_payment_succeeded handler gap is **real but operationally closed** by the
card-only pin at the checkout route (`:207`) plus the webhook's `payment_status==='paid'`
gate (`:105`). A bank-transfer customer cannot initiate the flow, so no money is taken
without goods at HEAD. **Not an exploitable defect today.** Re-open trigger (tracked
as plan-316 CRT-R5C1-04): if async payment methods are added to `payment_method_types`
BEFORE the `async_payment_succeeded` handler ships — the comment at
`checkout/route.ts:205-206` is the guardrail.

---

## Cross-flow uncertainty notes / next probes

1. **D3 (backfill no-progress loop) confidence is Medium** — depends on whether any real-world source deterministically throws inside `detectColorSignals` (`color-detection.ts`) on every attempt. Most detection failures are transient I/O. **Next probe:** grep prod logs for repeated `[admin-backfill] id=N detection failed` on the SAME id across runs; a stable set warrants a `detection_attempts` cap.
2. **D1 (original-dir orphan) is bounded** to ungraceful-kill windows; a normal failure is cleaned by the `images.ts:464-470` catch. **Next probe (optional):** `ls data/uploads/original/` count vs `SELECT COUNT(*) FROM images` on the deploy host to quantify accumulated orphans before deciding a reaper is worth the complexity.
3. All HIGH-risk hypotheses (auth bypass, SW admin-content poisoning, Stripe money-no-goods, double-process, processed-without-derivatives) were **refuted with direct file:line evidence** — these flows are clean at HEAD.
