# Tracer Review — Run-9 Cycle-1 fixes follow-on (cycle 5 deep-review fan-out)

**Date:** 2026-06-13
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6)
**HEAD:** `1dde9b1e` — working tree CLEAN (only `.context/reviews/*.md` peer outputs + plan files modified; no source residue).
**Angle:** evidence-driven causal tracing with competing hypotheses, evidence for/against, uncertainty tracking.

**What changed since the prior tracer pass (`ce0029aa`):** six commits landed the cycle-4 (run-9 c1) scheduled batch —
`40a65aef` (touch-target `max-` regex), `300009d4` (**sidecar `flushBatch` orphan-cleanup — NET-NEW code**), `fd708c1e` (sales badge contrast), `18de78eb` (upload-queue dir-scan cleanup), `2251b122` (runner detection-failure cleanup test), `1dde9b1e` (doc honesty). The highest-yield NET-NEW target is `300009d4`: the sidecar gained a **deferred-cleanup-after-commit** pattern that is structurally DIFFERENT from the in-app runner's clean-inside-the-lock pattern. The aggregate explicitly asked: does deferring the unlink past tx-commit open a window the runner doesn't have?

**Bottom line:** **No new confirmed CORRECTNESS bug.** The sidecar's new deferred-cleanup pattern is causally proven safe across all interleavings — the wider write→cleanup gap does NOT open a residual orphan window. One NET-NEW LOW test-depth finding: the sidecar's `flushBatch` deferred cleanup (the very code `300009d4` added) is **unexported and has zero direct test coverage** — the sibling gap to AGG-C4-05 (which closed the same gap for the in-app runner). Every other traced flow refuted.

---

## Flow 1 — Delete-while-re-encoding across ALL THREE writers; the sidecar's deferred-cleanup-after-commit pattern (NET-NEW `300009d4`)

**Hypotheses under test:**
- **H1 (defect):** Deferring the orphan-cleanup unlink past tx-commit (sidecar `flushBatch`) opens an orphan window the in-app runner (cleans inside the per-image lock) does not have.
- **H2 (defect):** The sidecar holds NO per-image processing lock, so the much wider gap between encode-write (PQueue worker) and the deferred UPDATE+cleanup (`flushBatch`, after up to 100 rows accumulate) lets a delete re-orphan files.
- **H3 (clean):** The cleanup is correct across all interleavings; deferring is not just safe but *required* for batch-transaction integrity, and is a deliberate, correct design difference — not a divergence bug.

**VERDICT: H3 confirmed; H1 and H2 REFUTED. Zero residual orphan window. Confidence: High (deductive interleaving proof + write-completion ordering verified at file:line).**

### Call chains

**Sidecar (no per-image lock; deferred cleanup):**
- `reprocessRow` (`scripts/backfill-color-pipeline.ts:129`) → `await processImageFormats(...)` (`:140`) → returns only after all 3 formats' base files are materialized + verified non-empty (`process-image.ts:1253-1267`). Row pushed to `updateBatch` with its filenames (`:404`).
- `flushBatch` (`:337`) → `tx.execute(UPDATE … WHERE id=${item.id})` (`:348-361`) → `if affectedRows===0 → deletedMidReencodeFiles.push(item.files)` (`:362-364`); derivative branch identical (`:366-376`).
- **AFTER tx commit** (`:378`): `processed -= …` (`:385`) + `cleanupDeletedMidReencode(files)` (`:386`) → `deleteImageVariants(dir, fn, [])` (`:329-335`) — full dir-scan, ENOENT-tolerant.

**In-app runner (per-image lock; clean inside lock):** `reprocessOne` (`admin-backfill-runner.ts:442`) acquires `gallerykit:image-processing:{id}` (`:486`), holds it across encode→detect→UPDATE→cleanup, cleans on `affectedRows===0` INSIDE the lock (`:573-576`, `:605-608`), releases in `finally` (`:610-613`).

**Upload queue:** `image-queue.ts:368-389` — conditional `UPDATE … WHERE id=? AND processed=false`; `affectedRows===0 → deleteImageVariants(…, [])` (`:383-387`, now `[]` per `18de78eb`).

**deleteImage (the racing writer):** SELECT filenames (`images.ts:557-565`) → **DB-delete transaction FIRST** (`:598-602`) → **file-unlink SECOND** via `deleteImageVariants(dir, fn, [])` dir-scan (`:613-620`). This delete-row-before-unlink ordering is the load-bearing invariant.

### Interleaving proof (sidecar specifically)

Let W = sidecar encode-write (PQueue worker), U = sidecar deferred UPDATE, C = sidecar deferred cleanup. Happens-before: **W → U → C** (the row enters `updateBatch` only after `await processImageFormats` returns, so W fully completes — all files on disk, verified non-empty — before U can ever observe it). For `deleteImage`: DR = row-delete, DU = file-unlink, with **DR → DU**.

| Case | Sequence | sidecar UPDATE affectedRows | Outcome |
|---|---|---|---|
| S-1 | DR+DU both complete before W | 0 | C dir-scans + unlinks the files W just wrote. Clean. |
| S-2 | DR before U, DU before C | 0 | C dir-scan finds files already gone (DU removed them) → ENOENT no-op. Clean. |
| S-3 | DR before U, C before DU | 0 | C unlinks W's files; DU dir-scan then finds nothing → no-op. Clean. |
| S-4 | U commits (row present) before DR | 1 | version bumped, files kept; deleteImage later DR+DU dir-scans every `{uuid}_*`. Clean. |

The only way an orphan survives is if files exist on disk but neither DU nor C touches them. That is impossible because **whenever DR precedes U, U observes `affectedRows===0` and C always runs** (`:362-364` → `:386`), and **C uses the `sizes=[]` dir-scan** (`:329-335`) which catches every `{uuid}_*` variant regardless of the configured size list. UUID filenames (`process-image.ts:800-804`) confine C's dir-scan to this id's namespace — no cross-image collision.

**Why deferring past commit does NOT widen the orphan window (the core refutation of H1/H2):** the wider W→C gap only means the freshly-written files sit on disk *longer for a row that still exists* (until U). During that gap they are legitimate derivatives, not orphans. The instant the row is deleted, the LATER of {DU, C} removes them — both use the identical dir-scan + ENOENT-tolerant unlink. The gap width is irrelevant to the terminal state.

**Why deferring is CORRECT, not merely safe (H3):** the sidecar batches up to 100 rows in one transaction (`:346-377`). Running `cleanupDeletedMidReencode` (best-effort fs unlink) INSIDE the `db.transaction` callback would let a stray unlink throw roll back legitimate sibling-row version bumps in the same batch. The comment at `:341-344` documents exactly this. The in-app runner processes ONE row per lock-window (`:557-577`), so it has no sibling-rollback concern and can clean inline. **This is a deliberate, correct design difference between a batched writer and a per-row writer — not the AGG-C4-R1 "divergence" class.**

### Counter-tally consistency (checked end-to-end)

- `processed++` fires for ANY `outcome==='processed'`, including the `derivativeOnly` (detection-failure) branch (`:396,:405`). A deleted-mid-reencode row in EITHER batch is decremented via `processed -= deletedMidReencodeFiles.length` (`:385`) and added to `deletedMidReencode` (`:384`). The two batches push to the SAME `deletedMidReencodeFiles` list (`:363,:374`), so a detection-failure row that vanished is also cleaned + re-tallied. No double-count, no miscount.
- `deletedMidReencode` is surfaced in the final summary (`:432`) and is NOT folded into the `errors`-based exit code (`process.exit(errors > 0 ? 1 : 0)`, `:442`) — a deliberate concurrent delete is not an operator-actionable failure. Mirrors the runner's exclusion from the WITH-FAILURES banner (`admin-backfill-runner.ts:791`).

### Evidence against (where I tried to break it)

- **Re-materialization after delete-cleanup:** I looked for W occurring AFTER DU (sidecar writes files after the delete already cleaned up). If W is after DU, W is after DR too, so at U the row is gone → affectedRows===0 → C cleans W's files. Refuted.
- **Lock absence harming the sidecar where the runner is fine:** the runner's per-image lock prevents a *double-encode* race with `retryFailedImage` (a `processed` row re-enqueued to the live queue), NOT the delete race. `deleteImage` takes neither lock, so neither writer is protected against delete by a lock — both rely on the affectedRows guard + dir-scan. The sidecar's documented mitigation (`:36-43`: "do not trigger admin Retry while a sidecar run is active; the global backfill lock serializes the sidecar against the in-app runner") covers the double-encode gap operationally. Refuted as a delete-race concern.

### NET-NEW finding — TRC-C5-01 (LOW, test-depth)

**The sidecar's `flushBatch` deferred orphan-cleanup (the code `300009d4` added) is unexported and has ZERO direct test coverage.** The sidecar exports only `ImageRow` + `reprocessRow` (`scripts/backfill-color-pipeline.ts:64,129`). Both `backfill-color-pipeline.test.ts` (277 LOC, 9 `reprocessRow` assertions) and `backfill-detection-failure-contract.test.ts` exercise `reprocessRow` ONLY — they prove the per-row outcome/classification, never `flushBatch`'s `affectedRows===0 → deferred cleanup`. The contract test's own docstring even says "so `flushBatch` persists them WITHOUT advancing pipeline_version" but never invokes `flushBatch`. This is the EXACT sibling of AGG-C4-05 (run-9 c1 TE-1, `2251b122`), which just closed the identical gap for the in-app runner's detection-failure branch via `admin-backfill-runner-deleted-mid-reencode-detection-failure.test.ts`. A refactor that drops the sidecar's `:362-364`/`:373-374` guard, or regresses the `[]` dir-scan in `cleanupDeletedMidReencode` (`:331-333`) to default sizes, would orphan production derivatives (the sidecar IS the prod re-encode path per CLAUDE.md) with a fully green suite. **Severity LOW** (the cleanup is correct by the proof above; it is the *regression guard* that is missing, on freshly-landed correctness code on the production path). **Fix:** export `flushBatch` (+ the batch arrays / counters via a tiny test seam, or refactor the cleanup decision into an exported pure helper) and add one test: seed `updateBatch` with a row, mock `db.transaction`'s `tx.execute` → `affectedRows:0`, assert `cleanupDeletedMidReencode` calls `deleteImageVariants` for all 3 dirs with `[]`, `deletedMidReencode` incremented, `processed` decremented, exit code unaffected. Mirror it for the `derivativeBatch` branch. Confidence: High (mechanism + coverage gap both verified).

---

## Flow 2 — Settings-hash → ETag → cache invalidation across BOTH serving paths (static Next server vs serve-upload.ts)

**Hypotheses under test:**
- **H1 (defect):** Flipping a `COLOR_IMPACTING_KEY` fails to invalidate cached variants on one of the two serving paths.
- **H2 (defect):** On the static Next path (which rides mtime+size, NOT the settings hash), a backfill re-encode does NOT actually change BOTH mtime and size, so cached clients keep stale bytes.
- **H3 (clean):** Both paths invalidate — serve-upload via the settings-hash-bearing ETag; the static path via the mtime+size ETag that a re-encode's atomic rewrite necessarily changes.

**VERDICT: H3 confirmed; H1 and H2 REFUTED. Confidence: High.**

### Evidence chain

- **serve-upload.ts path** (locale-prefixed `/{locale}/uploads/…` + files missing from `public/`): ETag = `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"` (`serve-upload.ts:201`). `settingsHash` = `getServingColorSettingsHash()` (`:200`) → `getColorSettingsHash(config)` → `buildHashFromConfig` over all **9** `COLOR_IMPACTING_KEYS` (`settings-hash.ts:37-49,72-85`). Flipping ANY of the 9 (5 color + 3 quality + `image_sizes`) changes the hash → changes the ETag → `must-revalidate` forces 304→200. The serving-path debounce (`:46-48`, 5 s TTL + stale-while-revalidate) means the flip reaches the ETag within ≤ 5 s + one refresh, never blocking on the DB. Confirmed.
- **Static Next server path** (existing files in `public/uploads/`, the production hot path per CLAUDE.md R4C6 ARCH-R4C6-06): ETag = Next's `W/"{size-hex}-{mtime-hex}"`. **Does a backfill re-encode change BOTH?** `processImageFormats` writes each base file via atomic rename: `fs.link(outputPath, tmpPath)` → `fs.rename(tmpPath, basePath)` (`process-image.ts:1224-1234`), with copyFile→rename and direct-copyFile fallbacks. A `rename` over an existing path REPLACES the inode → **new mtime** (the rename target's mtime is the freshly-created file's). Re-encoded bytes (different settings/version) → **new size**. So both ETag components change. Even in the degenerate case where re-encoded bytes happen to be byte-identical in length (same size), the mtime still changes — and the two are concatenated, so the ETag differs. Confirmed.
- **Pipeline-version bumps:** invalidate ALL variants on serve-upload (the `v${IMAGE_PIPELINE_VERSION}` prefix) and, after backfill rewrites the files, on the static path (via mtime+size). Confirmed.

### Doc cross-check (consistent — not a finding)

`settings-hash.ts:4` docstring says "9 settings" and the array IS 9 (`:37-49`). CLAUDE.md's prior "5 keys" reference is the older COLOR-only subset; the docstring was corrected by AGG-R7-08 and matches the code. No drift.

### Evidence against

I looked for a 4th serving path (nginx) that might cache independently. The nginx config shares the `public, max-age=3600, must-revalidate` policy (CLAUDE.md), and `must-revalidate` defeats stale serving past max-age; the origin ETag (either path) drives the revalidation. No independent stale cache. Refuted.

---

## Flow 3 — libheif 10-bit AVIF probe Promise-singleton → per-image 8-bit fallback (probe rejects mid-batch)

**Hypotheses under test:**
- **H1 (defect):** If the probe rejects (or transiently fails) mid-batch, the singleton caches a wrong/stale verdict that mis-encodes the rest of the batch.
- **H2 (defect):** A per-image bitdepth rejection after a `true` probe verdict throws and counts as a fatal encode failure instead of falling back to 8-bit.
- **H3 (clean):** The singleton resolves the verdict exactly once and consistently; transient failures are retried with backoff; bitdepth rejection is permanent-`false`; a per-image post-probe rejection cleanly downgrades to explicit `bitdepth:8`.

**VERDICT: H3 confirmed; H1 and H2 REFUTED. Confidence: High.**

### Evidence chain

- **Singleton** (`process-image.ts:69,119-123`): `canUseHighBitdepthAvif()` memoizes `_highBitdepthAvifProbePromise` — the FIRST caller triggers `_probeHighBitdepthAvif()`; all concurrent callers `await` the same promise. The result (true/false) is observed once and is consistent for the process lifetime. A rejection inside `_probeHighBitdepthAvif` cannot escape: every path RETURNS a boolean (`:101,:105,:113,:116`) — it never throws — so the cached promise always resolves to a clean boolean, never a rejected promise that would re-throw to every awaiter. **H1 refuted.**
- **Transient vs permanent** (`:84-117`): bitdepth rejection (`/bitdepth/i`, `:77-79`) → permanent `false` (no retry). Transient (EIO/ENOSPC/EMFILE/EAGAIN, `:71-75`) → up to 3 retries with exponential backoff (`:107-110`); final/unknown failure → `false` (treat as unsupported). A mid-batch transient blip during the probe degrades to 8-bit for the whole process — conservative and correct (never ships a broken 10-bit encode).
- **Per-image post-probe rejection** (`:1140-1176`): `wantHighBitdepth = isWideGamutSource && await canUseHighBitdepthAvif()`. If the probe said `true` but THIS specific encode throws a bitdepth error, the catch (`:1153`) re-encodes with **explicit `bitdepth:8`** via `base.clone()` (`:1164-1172`). The COR-R4C8-06 comment (`:1157-1163`) documents why `bitdepth:8` must be explicit (Sharp option setters never RESET prior state; clone copies the options snapshot, so an implicit retry would re-send heifBitdepth 10 and fail again). Non-bitdepth errors re-throw (`:1174`) → correctly counted as `encode-failed`. `avif10bit` is set to `true` ONLY on a successful 10-bit encode (`:1152`); the 8-bit fallback leaves it `false`, so the persisted public `avif_10bit` chip honestly reflects delivered bytes. **H2 refuted.**

### Evidence against

I looked for a window where the singleton is set to a *rejected* promise (which would make every subsequent `await` re-throw and turn every wide-gamut encode into a fatal error). Refuted — `_probeHighBitdepthAvif` has no throwing exit; the assignment at `:121` always stores a promise that resolves to a boolean. I also checked whether a `false` verdict ever blocks an sRGB encode — no, `wantHighBitdepth` is gated on `isWideGamutSource` first, so sRGB sources never touch the 10-bit path regardless of the probe.

---

## Flow 4 — Upload-processing contract advisory lock vs the first-image-commit race (image_sizes / strip_gps_on_upload lock-once-photos-exist)

**Hypotheses under test:**
- **H1 (defect):** A settings change to `image_sizes`/`strip_gps_on_upload` can race the first image commit so the first image is processed under a contract the admin intended to lock once photos exist.
- **H2 (clean):** The upload path and the settings path serialize on the same `gallerykit_upload_processing_contract` lock; the upload reads its config snapshot UNDER the lock; the settings change is blocked once any image exists with a differing value.

**VERDICT: H2 confirmed; H1 REFUTED. Confidence: High.**

### Evidence chain

- **Upload path** (`images.ts:171-177`): acquires `acquireUploadProcessingContractLock()` UNCONDITIONALLY at the top of `uploadImages`, then resolves `uploadConfig = await getGalleryConfig()` (`:177`) INSIDE the lock. That snapshot drives both the HDR gate (`:283`) and the GPS strip (`:306-312`). Released in `finally` (`:533-535`). So the first image's processing contract is frozen under the lock.
- **Settings path** (`settings.ts:68-79`): when the change touches `image_sizes` or `strip_gps_on_upload` (`changesUploadProcessingContract`), it (a) checks the in-process `hasActiveUploadClaims()` guard (`:70-72`) AND (b) acquires the SAME lock (`:74-76`), failing with `uploadSettingsLocked` if either blocks. The lock helper (`upload-processing-contract-lock.ts:9-74`) converts pool/query errors to a `null` return (friendly toast, not a 500) and releases on close.
- **Lock-once-photos-exist** (`settings.ts:82-134`): under the lock, for `image_sizes` (`:103-112`) and `strip_gps_on_upload` (`:124-133`), if the requested value differs from current AND `SELECT id FROM images LIMIT 1` returns a row, the change is rejected (`imageSizesLocked`/`uploadSettingsLocked`). Because both writers serialize on the lock, the first-committed image cannot interleave between the "any image exists?" check and the settings write.

### Evidence against

I looked for a TOCTOU where the settings change reads "no images exist" then commits while an upload commits its first image concurrently. Refuted — they hold the same exclusive advisory lock for their respective windows; whichever acquires first runs to completion (releasing in `finally`), and the second sees the committed state. The dual guard (`hasActiveUploadClaims()` in-process + the cross-process DB lock) covers both the single-process and multi-process cases. (Note: CLAUDE.md documents the shipped topology as single-writer; the lock additionally hardens the multi-process case.)

---

## Flow 5 — Stripe webhook idempotency dup-key-loser disambiguation + the documented async_payment_succeeded gap

**Hypotheses under test:**
- **H1 (defect):** The dup-key loser (a raced second insert of the same `sessionId`) still mints/logs a plaintext download token whose hash was never stored (the C3-RPF-07 dead-token hazard).
- **H2 (defect):** The documented async_payment_succeeded gap silently mints an entitlement for an unpaid async session.
- **H3 (clean):** Both are handled — `insertedFresh` disambiguates the loser via `(affectedRows===1 && insertId>0)`; async/unpaid sessions are rejected at the `payment_status` gate.

**VERDICT: H3 confirmed; H1 and H2 REFUTED. The async gap is honestly documented (no entitlement minted), matching CLAUDE.md. Confidence: High. (This flow is also marked VERIFIED-CLEAN A08 in the prior aggregate; re-confirmed unchanged at HEAD.)**

### Evidence chain

- **Payment gate** (`route.ts:105-118`): `if session.payment_status !== 'paid'` returns 200 `{received:true}` with NO entitlement, NO token. Async-paid (`'unpaid'`) → `console.warn` (not `.error`, so it doesn't page); `'no_payment_required'`/unexpected → `console.error`. The documented async_payment_succeeded gap is a *missing positive handler* (a later `async_payment_succeeded` would mint the entitlement when funds settle), NOT a path that mints prematurely. CLAUDE.md's entitlements warning matches exactly: delayed methods "complete checkout but never receive an entitlement row." **H2 refuted — fails CLOSED.**
- **Idempotency SELECT** (`route.ts:320-331`): SELECT by `sessionId`; if a row exists → `idempotent skip`, no token, 200. This is the primary guard against Stripe's retries.
- **Dup-key-loser disambiguation** (`route.ts:357-422`): the `onDuplicateKeyUpdate({set:{sessionId}})` no-op (`:365`) handles the SELECT→INSERT race. `insertedFresh = insertHeader.affectedRows === 1 && insertHeader.insertId > 0` (`:382`) — the R4C5 COR-R4C5-09 fix correctly accounts for mysql2's DEFAULT FOUND_ROWS flag (under which a no-op dup-key update reports `affectedRows=1`, identical to a fresh insert). `insertId` disambiguates: fresh = `(1, >0)`; no-op loser = `(1, 0)`; changed-value dup = `(2, existing id)`. If NOT fresh → `idempotent skip (raced insert)`, no token log (`:419-422`). **H1 refuted — the dead-token hazard is closed by the insertId check.**
- **Deleted-image FK** (`route.ts:263-281,384-398`): both the pre-INSERT `!currentImage` check and the `ER_NO_REFERENCED_ROW_2` catch return 200 + manual-refund error log (not a 500 that re-arms Stripe's multi-day retry loop). Correct.

### Evidence against

I looked for a path where `insertedFresh` is `true` for a no-op dup-key loser (which would re-introduce the dead-token log). Refuted — the live-verified `(1,0)` loser signature fails the `insertId > 0` conjunct. I also checked whether a zero-amount coupon session could mint a token: the `amountTotalCents <= 0` gate (`:299-305`) rejects it with 200. No token leak.

---

## Findings by severity

### LOW (NET-NEW)
- **TRC-C5-01** — Sidecar `flushBatch` deferred orphan-cleanup (added by `300009d4`) is unexported and has ZERO direct test coverage. The mechanism is correct (proven in Flow 1), but the regression guard is missing — the sibling gap to AGG-C4-05, which closed the same gap for the in-app runner. A dropped guard or regressed dir-scan would orphan production derivatives with a green suite. `scripts/backfill-color-pipeline.ts:337-391` (esp. `:362-364`, `:373-374`, `:386`). Fix: export `flushBatch` (or a pure cleanup-decision helper) + add the `affectedRows:0` test for both batches. Confidence: High.

### Record-only (confirmed unchanged, not defects)
- AGG-C4-08 SW LRU meta lost-update — served-byte-neutral, best-effort by design. DEFER (matches aggregate; not re-traced, settled-clean prior).
- AGG-C4-R1 (architect): the three writers (`image-queue.ts`, `admin-backfill-runner.ts`, sidecar) still triplicate the encode→detect→write-10-columns→cleanup operation. The two correctness divergences it produced (AGG-C4-02 sidecar, AGG-C4-04 upload-worker) are now FIXED, so the symptom is closed; the consolidation refactor remains correctly DEFERRED. Note (Flow 1): the sidecar's deferred-after-commit cleanup vs the runner's clean-inside-lock is a CORRECT batched-vs-per-row design difference, NOT part of this divergence class.

---

## VERIFIED-CLEAN (independently re-traced this cycle, NO action)

- **Sidecar deferred-cleanup-after-commit (NET-NEW `300009d4`)** — proven safe across all 4 interleavings (S-1..S-4); the wider write→cleanup gap does not open an orphan window because cleanup always fires on `affectedRows===0` with a `sizes=[]` dir-scan, and the LATER of {delete's own cleanup, sidecar cleanup} removes the files regardless of gap width. Deferring past commit is required for batch-transaction integrity (a per-row writer can clean inline; a 100-row batched writer cannot). `scripts/backfill-color-pipeline.ts:337-391`.
- **Delete-race across all 3 writers** — all carry the `affectedRows===0 → deleteImageVariants(…, [])` guard: sidecar (`:362-364,386`), runner (`admin-backfill-runner.ts:573-576,605-608`), upload queue (`image-queue.ts:383-387`, now `[]` per `18de78eb`). The load-bearing invariant (delete-row-before-unlink, `images.ts:598-602` then `:613-620`) + UUID namespacing + ENOENT-tolerant unlink (`process-image.ts:525`) make "files gone but row present → orphan" structurally impossible on every path.
- **Settings-hash → ETag → cache invalidation** — both serving paths invalidate: serve-upload via the 9-key settings-hash ETag (`serve-upload.ts:201`, `settings-hash.ts:37-49`); static Next path via mtime+size, which a backfill atomic-rename rewrite necessarily changes (`process-image.ts:1224-1234`).
- **libheif 10-bit probe** — Promise-singleton resolves the verdict once + consistently; never stores a rejected promise (every `_probeHighBitdepthAvif` exit returns a boolean); transient→retry, bitdepth→permanent-false; per-image post-probe rejection → explicit `bitdepth:8` downgrade; `avif10bit` honestly tracks delivered bytes. `process-image.ts:69-123,1140-1176`.
- **Upload-contract lock vs first-image race** — upload + settings serialize on `gallerykit_upload_processing_contract`; upload reads config snapshot under the lock; settings change blocked once any image exists with a differing value. `images.ts:171-177`, `settings.ts:68-134`.
- **Stripe webhook** — dup-key loser disambiguated by `(affectedRows===1 && insertId>0)`; async/unpaid + zero-amount + deleted-image all fail CLOSED with 200 (no premature token); async_payment_succeeded gap is a missing positive handler honestly documented, not a premature-mint path. `route.ts:105-118,320-422`.

---

## Critical unknown / next probe (none blocking)

No flow ended UNCERTAIN. The single residual fact to re-probe if the code is refactored:

- **TRC-C5-01 regression surface:** the sidecar's `flushBatch` cleanup is correct today but unguarded by a test. The discriminating probe if a future refactor touches `scripts/backfill-color-pipeline.ts` batching: assert that a row whose `tx.execute` returns `affectedRows:0` triggers `deleteImageVariants(dir, fn, [])` for all three formats (NOT default sizes) and is tallied `deletedMidReencode`, not `processed`/`error`. Until that test exists, the sidecar's production-path orphan-cleanup contract rests on inspection + the deductive proof in Flow 1, not on a non-vacuous guard.
- **Flow 1 load-bearing invariant (unchanged from prior pass):** if any future change makes `deleteImage` unlink files BEFORE deleting the row, the delete-row-before-unlink ordering breaks and the orphan window re-opens on ALL THREE writers simultaneously. That ordering (`images.ts:598-602` → `:613-620`) is the single fact to re-verify if the delete path is refactored.

---

NET-NEW FINDINGS THIS CYCLE: 1
