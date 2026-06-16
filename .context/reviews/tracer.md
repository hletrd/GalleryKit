# Tracer — Run 6 / Cycle 5

**HEAD:** 2f603716 (working tree CLEAN)
**Date:** 2026-06-16
**Angle:** evidence-driven causal tracing of the trickiest end-to-end data flows — competing hypotheses, evidence for/against, uncertainty tracking, next-probe recommendations.
**Tests run this pass (from `apps/web`):** backfill-color-pipeline-deleted-mid-reencode + admin-backfill-runner-detection-failure + data-view-count-flush + stripe-webhook-source + checkout-route → **52/52 passing**.

---

## Headline

Every assigned suspicious flow traces **CLEAN or DOCUMENTED-and-accepted**. The cycle-4 fix I was asked to re-verify (TRC-C4-01 / AGG-C4-04 — sidecar `detectionFailures` walk-back, commit `1fd350be`) is **sound**: the `updateResults.slice(items.length)` recovers exactly the detection-failure batch slice, and the matrix is unit-pinned. The Stripe async-payment gap is **correctly documented AND operationally closed** by the card-only checkout pin — the doc warning is accurate. View-count undercount is the documented best-effort tradeoff with the crash window narrowed to a single in-flight chunk. Settings→ETag invalidation works on both serve paths and CLAUDE.md already states the correct 9-key count (the "5" in the task framing is a stale snapshot — current doc says 9). **ZERO new actionable findings.**

---

## FLOW 1 — Backfill `detectionFailures` walk-back (re-verifying the cycle-4 fix `1fd350be` — do NOT re-flag)

### Observation
TRC-C4-01 was: the sidecar `detectionFailures++` fires per-row when `reprocessRow` returns `derivativeOnly`, but `flushBatch`'s deleted-mid-reencode partition adjusted `processed`/`deletedMidReencode` WITHOUT walking back `detectionFailures`, so a detection-failed-AND-then-deleted row left the counter elevated and `process.exit(... detectionFailures>0 ...)` returned non-zero for a row that no longer exists. Commit `1fd350be` claims a fix.

### Hypothesis table
| Rank | Hypothesis | Confidence | Evidence Strength |
|------|------------|------------|-------------------|
| 1 | Fix is sound — the slice recovers exactly the detection-failure∩deleted overlap; no over/under-count | **High** | Strong (source-traced + 52 tests pass) |
| 2 | The slice mis-indexes (off-by-one or wrong partition) under some batch ordering | Refuted | Strong |
| 3 | `processed -=` now double-counts or under-counts the deleted rows | Refuted | Strong |

### Evidence FOR Hypothesis 1 (fix sound) — decisive
- **Batch ordering is deterministic.** In `flushBatch` (`scripts/backfill-color-pipeline.ts:405-433`), success rows (`items`) are pushed into `updateResults` FIRST (loop `:407-423`), then derivative rows (`derivativeItems`) are pushed SECOND (loop `:424-432`). So `updateResults` indices `[0, items.length)` are success outcomes and `[items.length, end)` are derivative (detection-failure) outcomes.
- **The slice is exact.** `const derivativeResults = updateResults.slice(items.length)` (`:454`) recovers precisely the derivative-slice outcomes. `countDeletedMidReencodeDetectionFailures(derivativeResults)` (`:159-163`) filters `affectedRows===0` over ONLY that slice, and `detectionFailures -= …` (`:455`) subtracts exactly the detection-failure∩deleted overlap. A detection-failure row still alive (`affectedRows===1`) keeps its count; one deleted (`affectedRows===0`) is walked back. **Correct by construction.**
- **`processed -=` is correct (refutes H3).** `processed++` fires for ANY `outcome==='processed'` (`:467`) — both success and derivative rows. `deletedMidReencodeFiles` is collected over the FULL `updateResults` (success + derivative, `:436`), and `processed -= deletedMidReencodeFiles.length` (`:444`) decrements by the total deleted count. Since both row types contributed `+1` to `processed`, decrementing by the combined deleted count is exact. No double-count.
- **Pinned by tests.** `backfill-color-pipeline-deleted-mid-reencode.test.ts`:
  - `countDeletedMidReencodeDetectionFailures([{1},{0},{0}]) === 2` (`:166-178`) — the overlap counter.
  - `computeBackfillExitCode` matrix 0/0→0, errors→1, detectionFailures→1, both→1 (`:191-207`).
  - source-shape pins that `flushBatch` calls `collectDeletedMidReencodeFiles(updateResults)`, maps cleanup, and decrements via `detectionFailures -= countDeletedMidReencodeDetectionFailures(` (`:138-159`).
  - All pass in this pass's run.

### Evidence AGAINST / gaps
- The decrement uses a `.slice(items.length)` that depends on the two push-loops keeping their relative order. A future refactor that interleaves success/derivative pushes into `updateResults` would break the slice silently. The source-shape test pins the CALL but not the push ORDER. **Pre-existing INFO-level brittleness, NOT a new defect** — the ordering is a single function's two adjacent loops and the comment at `:450-453` explicitly documents the invariant ("derivativeItems are pushed last").

### Verdict: cycle-4 fix **SOUND / CLEAN**. Not re-reported. Critical unknown: none.

---

## FLOW 2 — Stripe checkout → entitlement (the documented `async_payment_succeeded` gap)

### Observation
CLAUDE.md warns: `checkout.session.async_payment_succeeded` is not handled — delayed payment methods (bank transfer / ACH) complete checkout but never receive an entitlement row; only card / immediate-payment methods supported until plan-316 CRT-R5C1-04 ships. The webhook handles only `checkout.session.completed`.

### Hypothesis table
| Rank | Hypothesis | Confidence | Evidence Strength |
|------|------------|------------|-------------------|
| 1 | The doc warning is ACCURATE and the gap is operationally closed by the card-only checkout pin | **High** | Strong (both routes source-traced) |
| 2 | The gap WIDENED — the app's own checkout can now create an async session that strands a paying customer | Refuted | Strong |
| 3 | The doc is WRONG — entitlements ARE created for async/unpaid sessions (money-no-goods inverse, double-mint) | Refuted | Strong |

### Evidence FOR Hypothesis 1 (accurate + operationally closed)
- **Checkout is pinned card-only.** `api/checkout/[imageId]/route.ts:207` sets `payment_method_types: ['card']`. The comment `:196-206` (AGG-H1 / CRT-R5C1-04) explains card-only makes `completed+unpaid` unreachable through the app, closing the gap operationally, and "DO NOT add async methods here before the async_payment_succeeded handler ships." So a buyer **cannot initiate an async-payment session via the app**.
- **The webhook defends in depth anyway.** `api/stripe/webhook/route.ts:105` gates `if (session.payment_status !== 'paid')` and returns `200 {received:true}` — `unpaid` (the async happy-path-pending state) is rejected with `console.warn` (`:106-110`), unexpected statuses with `console.error` (`:111-116`). So even a manually-created (Stripe-dashboard) async session that fires `completed+unpaid` mints NO entitlement (refutes H3 — no money-no-goods double-mint).
- **The residual gap is exactly what the doc says.** If an async session were created OUT-OF-BAND (Stripe dashboard / direct SDK), it fires `completed+unpaid` (rejected → no entitlement), then settles later via `async_payment_succeeded` — which this route does NOT handle (only `checkout.session.completed` at `:88`), so it falls through to `:453` `{received:true}` and never creates an entitlement. The customer paid, no entitlement. **This is precisely the documented "complete checkout but never receive an entitlement row."** The doc is correct; the app's own flow can't reach it (card-only); the residual is the out-of-band path, bounded and tracked in plan-316.
- **No widening (refutes H2).** The card-only pin is present at HEAD; `git log` shows commit `22d02262` added the lineage cross-ref to CLAUDE.md. Nothing in the cycle-5 delta (`6ab40644`, `9a262e3f`, `1fd350be`) touches the Stripe surface.
- **Idempotency + correctness corroborated** by `stripe-webhook-source.test.ts` + `checkout-route.test.ts` (pass): SELECT-by-sessionId idempotency skip (`:320-331`), `affectedRows===1 && insertId>0` dup-key disambiguation (`:382`), deleted-image FK 200 (`:273-281`, `:390-398`), zero-amount reject (`:299-305`), tier allowlist (`:231-235`).

### Verdict: **DOCUMENTED + ACCEPTED + operationally closed.** NOT a finding (the doc is accurate and the gap is bounded as documented). Critical unknown: none.

---

## FLOW 3 — View-count buffer → async flush → crash window (undercount path)

### Observation
CLAUDE.md states shared-group `view_count` is "best-effort approximate analytics" — increments buffered in process memory, flushed asynchronously, so a crash/kill/DB-outage can undercount. The question: is the undercount bounded as documented, or has a wider loss path opened?

### Hypothesis table
| Rank | Hypothesis | Confidence | Evidence Strength |
|------|------------|------------|-------------------|
| 1 | Loss is bounded to the in-flight chunk on crash; matches the documented best-effort tradeoff | **High** | Strong (source-traced + flush invariants pinned) |
| 2 | A wider window loses the whole buffer (regression of the pre-C2-F01 clear-before-write) | Refuted | Strong |
| 3 | An unbounded-growth or busy-loop path exists during DB outage | Refuted | Strong |

### Evidence FOR Hypothesis 1
- **Swap-before-write narrows the loss window.** `flushGroupViewCounts` (`lib/data.ts:63-189`) does `const batch = viewCountBuffer; viewCountBuffer = new Map();` (`:95-96`) BEFORE any DB write (first `db.update(sharedGroups)` at `:107`). New increments during a flush land in the fresh Map. A crash mid-flush loses only the in-flight `batch` (and only the chunks not yet committed), not subsequently-buffered increments. This is strictly the documented behavior (refutes H2 — the pre-C2-F01 clear-before-write is gone).
- **Chunked drain bounds concurrency** to `FLUSH_CHUNK_SIZE=20` (`:103-104`), so the connection pool (10) is never flooded.
- **Failure handling bounded (refutes H3):** per-group re-buffer on `.catch` (`:111-131`) with `VIEW_COUNT_MAX_RETRIES=3` drop (`:117-121`), capacity guard `MAX_VIEW_COUNT_BUFFER_SIZE=1000` symmetric in producer + re-buffer path (`:47`, `:125`), post-flush FIFO eviction while over cap (`:143-150`), `viewCountRetryCount` hard cap `500` with collect-then-delete eviction (`:169-187`), exponential backoff capped at `MAX_FLUSH_INTERVAL_MS=300000` (`:37-41`). Timer re-arm guarded on `viewCountBuffer.size > 0 && !viewCountFlushTimer` (`:159`) — no busy-loop after an empty flush.
- **COR-R4C11-01 stale-timer fix present:** `viewCountFlushTimer = null` on ENTRY before the `isFlushing` guard (`:75`), with re-arm on the early return (`:83-86`) — the buffer cannot strand when a timer fires during a slow drain.
- **Restore-maintenance gate:** `bufferGroupViewCount` returns early if `isRestoreMaintenanceActive()` (`:44-46`).
- All 12 source-level flush invariants pinned by `data-view-count-flush.test.ts` (pass).

### Verdict: **DOCUMENTED + ACCEPTED best-effort tradeoff**, crash window correctly narrowed to the in-flight chunk. NOT a finding. Critical unknown: none.

---

## FLOW 4 — Settings change → backfill → ETag invalidation across both serve paths

### Observation
A color/quality/size admin setting change must invalidate cached derivatives. Two serve paths: Next static (mtime+size ETag) and `serve-upload.ts` (settings-hash-bearing ETag). The task framing quoted CLAUDE.md as "covers all 5 COLOR_IMPACTING_KEYS" — does the code/doc match, and does a flip actually invalidate on both paths?

### Hypothesis table
| Rank | Hypothesis | Confidence | Evidence Strength |
|------|------------|------------|-------------------|
| 1 | Invalidation correct on both paths; CLAUDE.md accurately states the current key count | **High** | Strong (code + doc both read at HEAD) |
| 2 | CLAUDE.md drifts ("5 keys") vs code (9 keys) — undocumented doc defect | Refuted | Strong |

### Evidence FOR Hypothesis 1
- **Code: 9 keys.** `settings-hash.ts:41-53` `COLOR_IMPACTING_KEYS` = 5 color (`wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`) + 3 quality (`image_quality_{webp,avif,jpeg}`) + 1 size (`image_sizes`). The docstring (`:5-13`) says "9 settings" and notes "AGG-R7-08 corrected this docstring from a stale 3-key summary."
- **CLAUDE.md: also says 9 (refutes H2).** `CLAUDE.md:264` reads "covers all **9** `COLOR_IMPACTING_KEYS` (`settings-hash.ts:37-49`)" and lists all 9, with the parenthetical "(AGG-R7-08 corrected the count from a stale "5")". The task prompt's quoted "5" is a STALE SNAPSHOT, not the current file. **No drift.**
- **serve-upload path invalidates immediately on a flip.** `serve-upload.ts:215` builds `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs}-${stats.size}-${settingsHash}"`; `settingsHash` from `getServingColorSettingsHash()` (`:50-69`) → `getColorSettingsHash(config)` (validated-values form). Flipping any of the 9 keys changes the hash → ETag changes even with unchanged mtime → `must-revalidate` 304→200 on every cached client.
- **Static path invalidates via re-encode.** Production existing files are served by Next's static server (mtime+size ETag, no settings-hash). A backfill re-encode rewrites the file → mtime AND size change → ETag changes. CLAUDE.md `:264` documents this as "Operational gotcha (CRT-D1)": a settings flip does NOT invalidate STATIC derivatives until a re-encode rewrites the bytes — the operator must run a backfill. Accurate.
- Pipeline-version bumps invalidate everywhere (serve-upload via the `v${VERSION}` ETag prefix; static via re-encode mtime after backfill).

### Verdict: **CLEAN** for the supported flow; CLAUDE.md is accurate (9 keys, static-path gotcha documented). NOT a finding. Critical unknown: none. (Matches Flow-4 cycle-4 verdict.)

---

## FLOW 5 — Upload → original save → queue claim → Sharp fan-out → conditional UPDATE → delete cleanup (re-verify no state desync)

### Observation
Re-verify the delete-while-processing invariant from cycle-4 hasn't drifted: `uploadImages` writes original → INSERT (`processed:false`) → enqueue; queue claims a per-image lock, re-checks, encodes, conditional UPDATE; `deleteImage` runs concurrently WITHOUT the per-image lock.

### Hypothesis table
| Rank | Hypothesis | Confidence | Evidence Strength |
|------|------------|------------|-------------------|
| 1 | No interleaving orphans a served derivative or desyncs DB/disk; encoder is always the last writer | **High** | Strong (full chain re-read at HEAD) |
| 2 | A regression since cycle-4 reopened the orphan window | Refuted | Strong |

### Evidence FOR Hypothesis 1
- **Upload order intact:** `saveOriginalAndGetMetadata` (`actions/images.ts:279`) → `db.insert(images)` `processed:false, pipeline_version:CURRENT` (`:382`) → `enqueueImageProcessing` (`:441`). Original on disk before INSERT; INSERT before enqueue, so the queue never claims a row whose original is missing.
- **Claim lock prevents double-encode:** non-blocking `GET_LOCK(name, 0)` (`image-queue.ts:199`), acquired before encode (`:261`), released in `finally` (`:545`). A losing worker reschedules (`:262-283`).
- **Conditional UPDATE + cleanup terminal:** `UPDATE … WHERE id=? AND processed=false` (`:370-372`); on `affectedRows===0` (deleted mid-process) the worker cleans ALL variants with `[]` full-dir-scan (`:374-391`). The worker never writes derivatives after its own `affectedRows===0` cleanup → **encoder is always the last writer.**
- **`deleteImage` takes no per-image lock** (`actions/images.ts:543-637`): removes id from `enqueued`/retry maps (`:593-599`), transactionally deletes the row (`:603-607`), cleans variants with `[]` (`:622-624`). Confirms the cycle-4 chain.
- Atomic base-rename via `.tmp` closes the partial-base 404 window; orphaned `.tmp` swept at bootstrap (`image-queue.ts:32-73`, `:689`).
- 52-test run includes no regression on this surface; the encoder/backfill/delete `[]` cleanup contract is pinned across `image-queue-delete-race-cleanup-wiring` + the backfill deleted-mid-reencode tests.

### Evidence AGAINST / gaps
- `original/{uuid}` SIGKILL orphan between original-write (`:279`) and INSERT (`:382`) — disk-bloat only, never served/referenced (sweep covers webp/avif/jpeg only). **Documented AGG-C3-08 deferred — NOT re-reported.**

### Verdict: **CLEAN.** No regression since cycle-4. Critical unknown: none.

---

## FLOW 6 — Session token verification (timing / replay) + paid-download single-use (opportunistic)

### Observation
Verify the HMAC session-token path has no timing oracle / replay weakness, and the paid-download single-use claim cannot double-deliver or leak a handle.

### Evidence (session — `lib/session.ts`)
- Constant-time: length-equality check (`:113-115`) BEFORE `timingSafeEqual` (`:117`) — avoids the throw-on-unequal-length oracle.
- Shape regexes for `random`/`signature` run AFTER crypto verify (`:121-125`) with an explicit comment that they cannot be a timing oracle (a forged token fails HMAC first).
- Age bound 24 h, `tokenAge < 0` rejected (`:128-134`); DB-backed with expiry purge + delete-on-expired (`:137-148`).
- Production refuses DB-stored secret fallback (`:30-36`) — signing key lives only in process env.
- Per-request `cache()` dedup keyed on token string (`:94`) — correct, not a cross-request leak.

### Evidence (paid download — `api/download/[imageId]/route.ts`)
- Open-before-claim: `open()` awaited (`:349`) BEFORE the atomic `UPDATE … SET downloadedAt=NOW(), downloadTokenHash=null WHERE id=? AND downloadedAt IS NULL` (`:379-385`). A missing-file failure never burns the token (`:356-360`).
- Single-use: `affectedRows===0` → 410 (`:398-401`); handle closed on every post-open path (`:387`, `:399`, `:456`).
- GET = claim-free interstitial (scanner-safe, `:198-258`); POST = the claim. Path-traversal containment (`:309`, `:334`) + symlink reject (`:323`). Constant-time `verifyTokenAgainstHash` (`:170`). Refund clears the hash → replay impossible even on DB leak.

### Verdict: **CLEAN.** Critical unknown: none.

---

## Convergence / separation notes
- Flows 1 and 5 **converge** on the same root mechanism verified in cycle-4: `deleteImage` takes no per-image lock; the encoder/backfill is the last writer and self-cleans on `affectedRows===0`. The cycle-4 fix `1fd350be` closed the only place this mechanism leaked into an observable (sidecar exit code) — and the slice logic confirms it closed it correctly without introducing an inverse under-count.
- Flows 2, 3, 4 are all **documented-and-accepted tradeoffs** (Stripe async-payment, view-count best-effort, static-path settings-flip) where the doc is accurate at HEAD — they are NOT findings by the convergence honesty rule.
- The task framing's "5 COLOR_IMPACTING_KEYS" was a stale snapshot; the live CLAUDE.md says 9 and matches the code. Surfacing this only to record that the suspected doc-drift does NOT exist at HEAD.

---

## Findings summary

| ID | Severity | Confidence | Status |
|----|----------|------------|--------|
| (none) | — | — | **ZERO new actionable findings.** |

### Verified-correct flows (INFO — evidence chains above)
| ID | Flow | Verdict |
|----|------|---------|
| TRC-C5-01 (INFO) | Backfill `detectionFailures` walk-back (`1fd350be`) | Fix SOUND — slice recovers exact detection-failure∩deleted overlap; matrix unit-pinned; 52 tests pass. Cycle-4 TRC-C4-01 **CLOSED**, not re-reported. |
| TRC-C5-02 (INFO) | Stripe async-payment gap | Doc ACCURATE + operationally closed by card-only checkout pin (`route.ts:207`). Documented-accepted, not a finding. |
| TRC-C5-03 (INFO) | View-count undercount | Documented best-effort; crash window narrowed to in-flight chunk via swap-before-write. Not a finding. |
| TRC-C5-04 (INFO) | Settings→ETag both paths | CLEAN; CLAUDE.md accurate (9 keys, static-path gotcha documented). Suspected "5 vs 9" doc-drift does NOT exist at HEAD. |
| TRC-C5-05 (INFO) | Upload→process→delete race | CLEAN; encoder always last writer; no regression since cycle-4. |
| TRC-C5-06 (INFO) | Session verify + paid-download single-use | CLEAN; constant-time, replay-safe, no handle leak. |

**Deferred items re-validated, NOT re-reported:** AGG-C3-08 (original/ SIGKILL orphan — disk-bloat only, reasoning correct at HEAD).

**HARD GUARD honored:** no proposal to activate CLIP semantic search. (Traced the embedding write at `image-queue.ts:434-478` only to confirm the delete-race chain — `disabled`-mode early-return at `:442` is correct; not flagged.)

**Honest-convergence note:** Every suspicious flow either checks out at the source or is a correctly-documented accepted tradeoff. Per the convergence honesty requirement, that is the correct and desirable outcome — no hypothetical races manufactured, no accepted tradeoffs re-litigated.
