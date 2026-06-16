# Tracer Report — Cycle 6

- HEAD: `4eb83aab`
- Agent: tracer
- Date: 2026-06-17
- Angle: causal tracing of high-consequence flows with competing hypotheses, evidence for/against, file+line evidence. Independently re-traced from source at HEAD.

## TL;DR

**0 ACTIONABLE findings.** All six target flows traced end-to-end and ruled CLEAN with file+line evidence. The system remains converged. One INFO-level documentation-drift note (CLAUDE.md + a stale inline docstring summary say "5 COLOR_IMPACTING_KEYS" while the code correctly carries 9) — this is doc text, not a code defect, and the *behavior* is correct on both serve paths.

This honest 0-actionable result is the expected, desirable outcome for a hard-converged system. No findings were fabricated.

---

## ACTIONABLE FINDINGS

None.

---

## INFO / VERIFIED-CORRECT FLOWS

### INFO-1 — Backfill detection-failure walk-back: CLEAN (both paths). Counter math exact.

**Observation.** On a successful re-encode whose color detection THEN throws, does `pipeline_version` correctly stay BEHIND `IMAGE_PIPELINE_VERSION` so a later run retries? Is the `slice`/counter arithmetic exact?

**Hypotheses.**
- H1 (CLEAN): detection-failure branch persists derivative-only columns WITHOUT a version bump; row stays a candidate (`pipeline_version < CURRENT`).
- H2 (BROKEN-strand): a branch bumps `pipeline_version` on detection failure → row never re-picked → stale color metadata stranded forever.
- H3 (BROKEN-math): the script's `slice(items.length)` mis-partitions success vs detection-failure UPDATE results → off-by-one or `detectionFailures` underflow → wrong exit code.

**Evidence (in-app runner, `apps/web/src/lib/admin-backfill-runner.ts`).**
- `reprocessOne`: when `detectColorSignals` throws, `signals` stays `null` (lines 533-554). Control falls to the derivative-only UPDATE at lines 594-599 which sets ONLY `was_downscaled`, `avif_10bit` — NO `pipeline_version` — and returns `{ ok: false, reason: 'detection-failed' }` (line 609). The success branch (lines 556-578) is the only place that writes `pipeline_version = ${IMAGE_PIPELINE_VERSION}` (line 559), and it requires `signals` truthy.
- Candidate selection is `pipeline_version IS NULL OR pipeline_version < ${IMAGE_PIPELINE_VERSION}` (fetchCandidateBatch line 404; fetchCandidateCount line 374), so a row left behind IS re-picked. Resume contract holds. → H1.
- Counter partition is complete and disjoint: `processed + skippedMissingOriginal + skippedLocked + encodeFailures + detectionFailures + deletedMidReencode + errors` (line 752). Each `reprocessOne` return reason maps 1:1 to exactly one tally (switch lines 702-727); a thrown UPDATE lands in `errors` (line 730). No double-count, no missed bucket.

**Evidence (sidecar script, `apps/web/scripts/backfill-color-pipeline.ts`).**
- `reprocessRow` detection-failure branch returns `{ outcome: 'processed', derivativeOnly: {...} }` (lines 260-263) — counted as `processed` (line 466) AND increments `detectionFailures` (line 480), pushed to `derivativeBatch` (NOT `updateBatch`).
- `flushBatch` ordering: `items` (success) pushed to `updateResults` FIRST (line 422), then `derivativeItems` (detection-failure) pushed SECOND (line 431). So `updateResults = [...success_results, ...derivative_results]` and `updateResults.length === items.length + derivativeItems.length`.
- The derivative-batch UPDATE (lines 425-430) sets ONLY `was_downscaled`, `avif_10bit` — NO `pipeline_version`. → H1, mirrors the runner.
- `slice(items.length)` math (line 454): `derivativeResults = updateResults.slice(items.length)` recovers EXACTLY the derivative-slice tail. The boundary is exact because derivative results are appended after all success results. → H3 refuted.
- Walk-back arithmetic on a row deleted mid-re-encode:
  - `processed -= deletedMidReencodeFiles.length` (line 444) — correct: EVERY deleted row (success or detection-failure) had incremented `processed` (line 466).
  - `detectionFailures -= countDeletedMidReencodeDetectionFailures(derivativeResults)` (line 455) — counts only detection-failure-slice rows with `affectedRows === 0` (helper lines 159-163). Each such row incremented `detectionFailures` exactly once in THIS batch (derivativeItems come from `derivativeBatch.splice`, this-batch only), so the per-batch subtraction can never exceed this-batch increments; cumulative `detectionFailures` ≥ this-batch increments. **No underflow.**
- Exit code: `computeBackfillExitCode({errors, detectionFailures})` returns 1 if either > 0 (lines 174-176), so a detection-failure run correctly signals "color metadata still stale, will retry" to a CI/cron wrapper.

**Test lock.** `__tests__/admin-backfill-runner-detection-failure.test.ts:199` asserts the detection-failure UPDATE does NOT contain `pipeline_version` while still containing `was_downscaled`/`avif_10bit` (lines 201-202). `__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts:152-189` locks the `detectionFailures -= countDeletedMidReencodeDetectionFailures(...)` walk-back and the slice idiom (`updateResults.slice(items.length)`).

**Conclusion: CLEAN.** H1 confirmed; H2 and H3 refuted with code + test evidence. No off-by-one, no underflow.

---

### INFO-2 — Stripe paid-download: checkout → webhook → entitlement → single-use token. CLEAN. `async_payment_succeeded` gap closed operationally.

**Observation.** Is the documented `async_payment_succeeded` gap actually closed by the card-only pin? Any double-spend / token-replay window?

**Hypotheses.**
- H1 (CLEAN): `payment_method_types:['card']` at checkout makes `completed+unpaid` unreachable, so the missing `async_payment_succeeded` handler can never cost a paid customer their goods. Single-use claim is an atomic conditional UPDATE; concurrent POSTs cannot double-spend.
- H2 (BROKEN-money): an async payment method is reachable somewhere, so a buyer is charged with no entitlement (money-taken-no-goods), OR the webhook mints an entitlement for an unpaid async session.
- H3 (BROKEN-replay): the single-use claim has a TOCTOU window where two concurrent download POSTs both stream the file.

**Evidence — card-only pin.**
- `apps/web/src/app/api/checkout/[imageId]/route.ts:207` — `payment_method_types: ['card']`, with a block comment (lines 196-206) explaining this forces `completed+unpaid` unreachable until the `async_payment_succeeded` handler ships. Locked by `__tests__/checkout-route.test.ts:210-211` (`expect(sessionPayload.payment_method_types).toEqual(['card'])`). → H1.
- Defense-in-depth at the webhook: `apps/web/src/app/api/stripe/webhook/route.ts:105-118` gates on `session.payment_status !== 'paid'`; an async `'unpaid'` session is rejected with `console.warn` (not error) and returns 200 (no entitlement minted). So even if a card-only bypass were ever introduced, the webhook would still refuse to mint on `unpaid`. → H2 refuted (gap closed at two layers).

**Evidence — webhook idempotency / no double-mint.**
- SELECT-by-`sessionId` guard before token generation (lines 320-331): a Stripe retry for an already-recorded entitlement skips token generation + the manual-distribution log and returns 200.
- Belt-and-braces `onDuplicateKeyUpdate({set:{sessionId}})` (line 365) + `insertedFresh = affectedRows === 1 && insertId > 0` (line 382) correctly disambiguates a fresh insert from a no-op dup-key loser under mysql2's FOUND_ROWS flags (documented R4C5 COR-R4C5-09 live-verified behavior). The dup-key loser returns at lines 419-421 WITHOUT logging a dead plaintext token. → no double-mint, no dead-token leak.
- Deleted-image FK case: `entitlements.image_id` NOT NULL FK; a paid session for a deleted image is answered 200 + manual-refund error log at lines 273-281 (pre-check) and lines 390-398 (ER_NO_REFERENCED_ROW_2 catch), avoiding the prior 500-retry storm.

**Evidence — single-use claim atomicity (`apps/web/src/app/api/download/[imageId]/route.ts`).**
- Claim is `UPDATE entitlements SET downloadedAt=NOW(), downloadTokenHash=null WHERE id=? AND downloadedAt IS NULL` (lines 379-385). Two concurrent POSTs race on the row; MySQL serializes the conditional UPDATE — only ONE gets `affectedRows === 1`, the loser gets `affectedRows === 0` → 410 (lines 396-401). → H3 refuted: no double-stream window.
- File `open()` happens BEFORE the claim (lines 349-351), so a missing/replaced file returns 404 WITHOUT burning the token (the C3-RPF-05 / R4C4-06 ordering). Content-Length comes from the opened inode (line 351) so a concurrent replace cannot desync it.
- Replay defense: the claim clears `downloadTokenHash` (line 381), so even a DB leak cannot replay the token; the D-101-06 used-row heuristic (lines 154-165) still returns an accurate 410 without the hash.
- The `affected = header?.affectedRows ?? 1` fallback (line 397) intentionally defaults to "allow download" on a driver-shape change — a documented anti-false-410 measure. mysql2's `[ResultSetHeader, ...]` shape is stable, so this is not a realistic double-spend vector. INFO-only, no change.

**Conclusion: CLEAN.** H1 confirmed at two layers; H2 and H3 refuted. The `async_payment_succeeded` gap is genuinely closed operationally by the tested card-only pin, with the `payment_status !== 'paid'` gate as a second wall.

---

### INFO-3 — Settings change → ETag invalidation across both serve paths. CLEAN (asymmetric-but-correct, documented).

**Observation.** Does flipping a `COLOR_IMPACTING_KEY` invalidate cached variants on BOTH the static Next server path and the `serve-upload.ts` path?

**Hypotheses.**
- H1 (CLEAN): serve-upload path folds the settings hash into the ETag (immediate invalidation on flip); static path rides mtime+size, which the mandatory backfill changes.
- H2 (BROKEN): a flip silently fails to invalidate on one path, serving stale bytes indefinitely.

**Evidence.**
- serve-upload path: ETag `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"` (`serve-upload.ts:215`); `settingsHash` from `getServingColorSettingsHash()` (line 214) → `getColorSettingsHash(config)` (line 63) → `buildHashFromConfig` over all 9 `COLOR_IMPACTING_KEYS` (`settings-hash.ts:76-89`). Flipping ANY of the 9 keys changes the hash → ETag → forced 304→200 revalidation. → H1 (immediate).
- Static path: `next.config.ts:69-71` sets `Cache-Control: public, max-age=3600, must-revalidate` for `/uploads/:format(jpeg|webp|avif)/:file*` but does NOT compute a settings-hash ETag — the static path uses Next's default `W/"{size}-{mtime}"` weak ETag. A setting flip ALONE does not change the static-path ETag.
- BUT: flipping any COLOR_IMPACTING_KEY mandates a backfill to re-encode existing photos (CLAUDE.md "Flipping any of these requires a backfill pass"). The backfill re-encode rewrites the derivative in place under the unchanged filename → mtime + size both change → static-path ETag changes → revalidation. Exactly the documented behavior ("On the static path, invalidation rides the mtime+size ETag: a backfill re-encode rewrites the file, changing both"). The deliberately-non-`immutable` Cache-Control (ARCH-R4C6-06) makes the mtime-based revalidation reachable. → H1 (deferred-but-correct).

**Conclusion: CLEAN.** The two paths are asymmetric (serve-upload invalidates instantly on flip; static path invalidates when the mandatory backfill rewrites bytes) but jointly correct — there is no configuration where a flipped color setting serves stale bytes once the operator runs the backfill the flip requires. H2 refuted.

---

### INFO-4 — Upload → process → delete race; double-process across workers. CLEAN. Encoder is effective last-writer; affectedRows-0 cleanup is the backstop.

**Observation.** Can a deleted-mid-processing image strand orphaned derivatives or double-process across two queue workers? Is the encoder always the last writer?

**Hypotheses.**
- H1 (CLEAN): per-image advisory lock + conditional `WHERE processed=false` UPDATE + `affectedRows===0` cleanup prevent double-process and orphans.
- H2 (BROKEN-double): two workers (restart boundary / multi-process) both encode the same upload, interleaving writes.
- H3 (BROKEN-orphan): a delete that races the encoder leaves derivative files on disk for a row that no longer exists.

**Evidence — double-process.**
- Queue worker claims `gallerykit:image-processing:{id}` non-blocking (image-queue.ts:195-212, `GET_LOCK(?, 0)`), then conditional `UPDATE ... SET processed=true ... WHERE id=? AND processed=false` (lines 370-372). A second worker fails the lock → claim-retry path (lines 262-283); if it ever got past the lock, the conditional UPDATE matches 0 rows for an already-processed row. → H2 refuted.
- Backfill paths claim the SAME `gallerykit:image-processing:{id}` lock (admin-backfill-runner.ts:343-359; the runner SKIPS a row the queue worker holds → `locked` tally, no version bump). The sidecar script does NOT take the per-row lock but is serialized against the runner by the global `gallerykit_color_pipeline_backfill` lock and the documented operational rule (don't trigger admin Retry during a sidecar run). → H2 refuted across all three encode paths.

**Evidence — delete race / orphans.**
- `deleteImage` (`apps/web/src/app/actions/images.ts:543-637`) deletes the row in a transaction (lines 603-607) and unlinks files best-effort with `[]` full-scan sizes (lines 618-625) WITHOUT acquiring the per-image processing lock (grep confirmed: no `GET_LOCK`/`getImageProcessingLockName` in images.ts deleteImage). So a delete CAN race a concurrent encode of the same id — the documented basis for the affectedRows-0 cleanup.
- Backstop: every encode path checks `affectedRows === 0` after its UPDATE and cleans the just-written variants with `[]` full-scan:
  - queue worker: image-queue.ts:374-391 (`deleteImageVariants(..., [])` ×3);
  - runner success branch: admin-backfill-runner.ts:573-576 → `cleanupDeletedMidReencodeVariants`;
  - runner detection-failure branch: lines 605-608 (same cleanup);
  - sidecar: `collectDeletedMidReencodeFiles` + `cleanupDeletedMidReencodeVariants` (script lines 436-457).
- Last-writer reasoning: the only true orphan window is "encoder writes derivative bytes AFTER deleteImage's prefix-scan already enumerated the dir." In that window the row is gone, so the encoder's conditional/version UPDATE matches 0 rows → the affectedRows-0 cleanup unlinks the freshly-written bytes. The encoder is therefore the effective last writer, and its own post-write 0-rows check is the cleanup trigger. → H3 refuted (orphan is caught).
- All cleanups use `[]` sizes → full directory scan → removes non-default-size variants too (image_sizes admin-tunable to 8). Locked by `__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts:107-124` (asserts every cleanup call's 3rd arg is `[]`).

**Conclusion: CLEAN.** H2 and H3 refuted. This is the documented, mitigated single-writer-topology design. (One unavoidable residual: a best-effort unlink that itself fails leaves a logged orphan — already documented as best-effort cleanup, not a tracer-actionable defect.)

---

### INFO-5 — Session verify + paid-download single-use: no timing oracle, no replay.

**Observation.** Any timing oracle or replay window in session verification or the paid-download single-use claim?

**Hypotheses.**
- H1 (CLEAN): HMAC compared with `timingSafeEqual` after length-equalization; shape checks placed AFTER the crypto compare so they cannot be a timing oracle.
- H2 (BROKEN-oracle): a structural check runs BEFORE the constant-time compare, leaking validity via early-return timing.
- H3 (BROKEN-replay): a verified session or a used download token can be replayed.

**Evidence — session (`apps/web/src/lib/session.ts`).**
- `verifySessionToken` (lines 94-151): split into 3 parts (early-return on shape — leaks nothing beyond "is it 3 colon-parts", not validity); compute expected HMAC; **length-check then `timingSafeEqual`** (lines 110-119). The `random`/`signature` regex shape assertions are DELIBERATELY placed AFTER the `timingSafeEqual` (lines 121-125, explicit comment "so these checks cannot be used as a timing oracle"). → H1 confirmed, H2 refuted.
- Replay: DB lookup is by `hashSessionToken(token)` (lines 136-139); expired sessions are deleted (lines 145-148). Stored value is the SHA-256 hash, so a DB leak doesn't yield usable cookies. Token age capped at 24h (lines 128-134). → H3 refuted.

**Evidence — download token (`apps/web/src/lib/download-tokens.ts` + download route).**
- `verifyTokenAgainstHash` (lines 65-85): shape checks on the user token (`isValidTokenShape`) and the stored hash (`STORED_HASH_SHAPE`) gate STRUCTURE / stored-value integrity, not a comparison against the secret; the actual secret comparison is `timingSafeEqual` over equal-length hex buffers (lines 78-81). A wrong-but-well-formed token reaches `timingSafeEqual` and fails in constant time. → no token-enumeration oracle.
- Single-use replay closed by the atomic claim clearing `downloadTokenHash` (download route line 381), covered in INFO-2/H3.

**Conclusion: CLEAN.** H1 confirmed; H2 and H3 refuted. The shape-after-crypto ordering in session verify is the textbook anti-oracle pattern and is explicitly commented as such.

---

### INFO-6 — View-count buffering (shared-group): swap-before-write ordering correct; no double-count, bounded loss.

**Observation.** Is the swap-before-write ordering correct (no double-count, loss bounded to the documented crash-only tradeoff)?

**Hypotheses.**
- H1 (CLEAN): the Map reference is swapped to a fresh Map BEFORE any DB write, under an `isFlushing` guard; the DB increment is relative (`+ count`) so concurrent increments and re-buffered failures never overwrite each other.
- H2 (BROKEN-double): a flush double-applies a count (concurrent flushes both drain the same batch, or a re-buffer adds back a count that also succeeded).
- H3 (BROKEN-loss): increments arriving mid-flush are silently lost beyond the documented crash window.

**Evidence (`apps/web/src/lib/data.ts:43-200`).**
- Ordering: `isFlushing` guard (line 76) → set `isFlushing = true` (line 89) → swap `batch = viewCountBuffer; viewCountBuffer = new Map()` (lines 95-96) → THEN DB writes (lines 103-134). The swap precedes every write. Increments arriving during the flush go to the fresh `viewCountBuffer` (via `bufferGroupViewCount` line 52), NOT the swapped `batch`. → H1.
- No double-count: a single flush drains exactly `batch` once (lines 102-134); the concurrent-flush guard (lines 76-88) returns early and re-arms a timer rather than re-draining. The DB write is `view_count = view_count + count` (relative, line 108) — a re-buffered failure (line 129) adds its `count` back to the fresh buffer and is applied on the NEXT flush; it is NOT also counted as succeeded (the `.then` success path and the `.catch` re-buffer path are mutually exclusive per-row, lines 110-131). → H2 refuted.
- Bounded loss: the only loss path is a process crash AFTER the swap but BEFORE the DB write commits — the swapped `batch` is in-memory only. This is the explicitly documented undercount-on-crash tradeoff (CLAUDE.md "Shared-group view_count is best-effort approximate analytics... a crash... can undercount"). Capacity drops (lines 47-50, 125-128) and max-retry drops (lines 117-120) are additional documented bounded-loss paths under sustained DB outage, not silent steady-state loss. → H3 refuted.
- Timer-handle correctness: `viewCountFlushTimer = null` on entry (line 75, the COR-R4C11-01 fix) keeps the handle an accurate "drain pending" signal so a slow flush cannot strand the buffer.

**Conclusion: CLEAN.** H1 confirmed; H2 and H3 refuted. The swap-before-write invariant holds; the relative `+ count` DB update makes re-buffering and concurrent increments composable without double-count.

---

## DOCUMENTATION-DRIFT NOTE (INFO, not a code change)

`settings-hash.ts` correctly carries **9** `COLOR_IMPACTING_KEYS` (lines 41-53), and its file-header docstring line 4 correctly says "9 settings". However:
- The same file's inline list-summary comment (lines 6-12) and CLAUDE.md ("covers all **5** `COLOR_IMPACTING_KEYS`") still describe the historical 5-key set.
- `serve-upload.ts:200-202` already correctly defers to the constant ("intentionally NOT re-enumerated here"), so the ETag code is right.

This is stale prose only — the runtime hash covers all 9 keys, so ETag invalidation is correct (see INFO-3). Flagging for a documentation reviewer; tracer would not push a code change. The repo-root CLAUDE.md is not code and is outside tracer's change surface.

---

## Critical Unknowns / Residual Uncertainty

None material to the traced flows. Every conclusion rests on tier-1/tier-2 evidence (source file:line + locking unit tests). The only items not collapsible to certainty by static reading are intrinsically runtime-timing properties (the download single-use race, the view-count concurrent-flush guard) — but each is mediated by a DB-level atomic primitive (conditional UPDATE / relative increment) plus an in-process guard, and each is locked by tests, so the static conclusion is high-confidence.

## Discriminating Probes (only if a future cycle wants runtime confirmation)

- Download double-spend: fire two concurrent `POST /api/download/{id}?token=...` and assert exactly one 200 + one 410 (the conditional UPDATE guarantees this).
- View-count: drive `bufferGroupViewCount` for the same group across a flush boundary with a mocked slow `db.update` and assert the summed DB increment equals total calls minus any capacity/retry drops.
