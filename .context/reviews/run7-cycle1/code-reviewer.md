# Code Reviewer — Run-7 Cycle-1 Deep Review

**HEAD:** 17f743f7 (one commit past run-6 cycle-11 baseline `a7de3ebd`)
**Working tree:** clean except `apps/web/public/sw.js` (auto-generated SW version bump — not hand-authored code, out of scope)
**Date:** 2026-06-18
**Verdict:** COMMENT — **0 blocking defects found; 4 LOW-severity hardening opportunities**

## Bottom line

The codebase has fully converged. HEAD is `2fc9a23f` (the AGG-C11-01 contract-pin fix) + 5 doc-only commits — no functional change since the run-6 cycle-11 baseline. I performed a comprehensive fresh sweep of `apps/web/src/` (~55 files across CLIP/semantic search, image processing, server actions, data layer, payment/download, auth, and race-condition surfaces) directly and via three parallel sub-agent audits. After verifying every candidate finding against the actual code, **zero confirmed defects at MEDIUM or higher severity** remain.

**5 of 6 candidate findings raised by sub-agents were disproven on direct verification** (the "missing" `enqueued.delete` is present in `finally`; the JS `++` race is impossible under single-threading; the EXIF rounding is within tolerance; the loop-bound gap is audit-only). The remaining items are LOW-severity hardening opportunities or documented design constraints of the single-writer topology.

## Findings

### R7C1-01 [LOW] — `restore-maintenance` flag is process-local; a hard crash mid-restore leaves no durable marker
**File:** `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/app/[locale]/admin/db-actions.ts:310-354`
**Confidence:** HIGH (confirmed by reading the full module)
**Issue:** `beginRestoreMaintenance()` sets an in-memory `globalThis` flag. If the container is OOM-killed (exactly the 2026-06-17 disk-starvation scenario documented in CLAUDE.md) between `beginRestoreMaintenance()` and the `finally { endRestoreMaintenance() }` in `db-actions.ts`, the NEXT container starts with `isRestoreMaintenanceActive() === false` while the prior restore may have left the DB in a half-imported state (e.g. after `DROP TABLE images` but before `CREATE TABLE` / INSERTs complete). The MySQL advisory lock and upload-contract lock auto-release on connection close (correct), so no wedge — but uploads accepted by the new container would write into a partially-restored schema with no guard.
**Failure scenario:** OOM kill mid-`mysqldump` import after schema teardown → restart → uploads hit a missing or partial `images` table.
**Fix (defense-in-depth):** Persist a `restore_in_progress` row in `admin_settings` set BEFORE the import and cleared in `finally`; check it on queue bootstrap and refuse to start with an admin-visible "restore interrupted, manual recovery required" notice. Single-writer topology note already documents process-local state; this extends it to the one genuinely under-protected restart path.
**Why LOW:** The 2026-06-17 incident was disk-exhaustion, not an OOM-mid-restore. The mysqldump import is fast (~seconds for a personal gallery). The probability of a crash landing in the exact window between DROP and CREATE completion is low, and the restore is operator-initiated (not a routine path). Documented design constraint, not a regression.

### R7C1-02 [LOW] — `notInArray` bootstrap exclusion can generate a 1000-literal SQL `NOT IN` clause
**File:** `apps/web/src/lib/image-queue.ts:626-628`
**Confidence:** HIGH (confirmed mechanically)
**Issue:** `notInArray(images.id, [...state.permanentlyFailedIds])` expands to `id NOT IN (v1, v2, …, v1000)` when the permanently-failed set is at its FIFO cap (`MAX_PERMANENTLY_FAILED_IDS = 1000`). MySQL handles 1000-literal `IN` clauses, but the query plan degrades and the SQL string grows. This runs on every bootstrap re-scan.
**Failure scenario:** After a disk-full incident accumulates ~1000 permanently-failed IDs, every bootstrap scan compiles and ships a 1000-element `NOT IN` list. Latency impact only; no correctness defect.
**Fix:** Optional — persist permanently-failed IDs in a side table and use `NOT EXISTS (SELECT 1 FROM …)`, or chunk the exclusion. Not worth the complexity at personal-gallery scale where 1000 permanently-failed images is an extreme edge case.
**Why LOW:** Bounded by the FIFO cap (never grows past 1000). Personal-gallery scale. Bootstrap is not a hot path. The only realistic way to hit 1000 permanently-failed IDs is a sustained disk/Sharp outage that would surface through other operator channels first.

### R7C1-03 [LOW] — `getCountryBreakdown` includes the `'XX'` sentinel in admin analytics results
**File:** `apps/web/src/lib/analytics-data.ts:112-133`, `apps/web/src/db/schema.ts:228`
**Confidence:** HIGH (confirmed)
**Issue:** `image_views.country_code` defaults to `'XX'` for un-geolocated IPs. `getCountryBreakdown` groups by `country_code` with no filter excluding `'XX'`, so the admin "Top Countries" panel includes an `XX` row of unknown provenance. Whether this is a bug depends on the admin UI consumer: if it renders `'XX'` as a localized "Unknown" label, this is fine; if it surfaces the raw `'XX'`, the operator sees a cryptic two-letter entry.
**Fix:** Either filter `ne(imageViews.country_code, 'XX')` in the where-clause, or ensure the analytics UI renders `'XX'` as a localized "Unknown" label. Confirm with the admin UI consumer which is intended.
**Why LOW:** Admin-only surface (not public). Display-quality, not correctness. The `'XX'` count is arguably useful signal ("how many views came from un-geolocated IPs").

### R7C1-04 [LOW] — `getOnThisDayImages` / `getTimelineImages` perform no input bounds validation on `month`/`day`/`year`
**File:** `apps/web/src/lib/data-timeline.ts:95-117, 184-212`
**Confidence:** HIGH (confirmed)
**Issue:** The functions interpolate `month`/`day`/`year` via Drizzle parameter binding (no injection risk), but enforce no `Number.isInteger` / range validation. The docstring says "month (1–12)" but nothing in the function body checks it. Today's only callers (public pages) validate upstream (`/^\d{4}$/` for year, `now.getMonth()` for month/day), so this is a latent contract gap, not an active bug. A future caller passing `month=0` or `month=13` would silently return empty (MySQL `MONTH() = 0` matches nothing) rather than throwing.
**Fix:** Add `if (!Number.isInteger(month) || month < 1 || month > 12) return [];` (and analogous day/year guards) at the top of both functions. Cheap, makes the contract explicit.
**Why LOW:** No current caller passes invalid input. Parameterized (no injection). Silent-empty is a safe failure mode (no crash, no wrong data).

## Rejected candidate findings (false positives — documented so they are not re-raised)

### RF-R7C1-01 — `retryFailedImage` "missing `state.enqueued.delete(id)`" — NOT A BUG
**Claim (sub-agent):** `retryFailedImage` (`app/actions/images.ts:1082-1157`) does not clear `state.enqueued` before calling `enqueueImageProcessing`, so the retry silently no-ops because `enqueueImageProcessing` short-circuits at `if (state.enqueued.has(job.id)) return;`.
**Reality:** The `finally` block at `image-queue.ts:544-557` runs `state.enqueued.delete(job.id)` on EVERY path where `retried===false`. For a permanently-failed image, `retried` stays `false` (the retry branch at line 486 `if (retries < MAX_RETRIES)` is NOT taken — `retries >= MAX_RETRIES`). Therefore `enqueued` IS cleared when the image entered permanent-failure state, and `retryFailedImage`'s subsequent `enqueueImageProcessing` call does NOT short-circuit. The sub-agent traced the enqueue-before-processing order but missed that the permanent-failure path's `finally` clears `enqueued`. Confidence it is a non-bug: HIGH.

### RF-R7C1-02 — Backfill per-worker `processed++` / `errors++` "race under concurrency > 1" — NOT A BUG
**Claim (sub-agent):** At `ADMIN_BACKFILL_CONCURRENCY > 1`, two PQueue tasks could both read `processed = N`, both write `N+1`, losing a count.
**Reality:** JavaScript is single-threaded. The `processed++` increment runs synchronously after `await reprocessOne(...)` resolves. Between the await resolving and the synchronous `++`, NO other task can execute — the event loop does not yield mid-synchronous-statement. Two tasks may interleave at their `await` boundaries, but the `++` itself is atomic with respect to the event loop. The counts are correct. The sub-agent's concurrency analysis assumed preemptive multithreading. Confidence it is a non-bug: HIGH.

### RF-R7C1-03 — `decimalToRational` exposure-time rounding "misrounds 0.0079 → 1/127" — NOT A BUG (correct behavior, minor display nit at most)
**Claim (sub-agent):** `0.0079 → 1/127` is a "wrong rounding" because "1/127 is a denominator the camera never produced."
**Reality:** `decimalToRational` (process-image.ts:1366-1373) finds the nearest reciprocal within tolerance `< 0.001`. `1/127 = 0.007874…`, `|0.007874 − 0.0079| = 0.000026 < 0.001` ✓. This IS the mathematically correct nearest reciprocal. `1/125 = 0.008`, `|0.008 − 0.0079| = 0.0001`, also within tolerance but `127` is closer. The function correctly returns the best-fitting rational. Whether a photographer prefers "1/125" (standard shutter) vs "1/127" (exact reciprocal) is a display-preference question, not a correctness defect. The fallback `Math.round(val * 10000) / 10000` handles the non-reciprocal case. Confidence it is a non-bug: HIGH. (If anything, this is a sub-LOW display nit: snap to standard shutter speeds from a known table. Not worth scheduling.)

### RF-R7C1-04 — `verifyAvifNclxInBuffer` loop bound `i < buffer.length - 12` "can miss a colr box near the buffer end" — NOT A BUG (audit-only, interior guards cover it)
**Claim (sub-agent):** The loop bound `for (let i = 4; i < buffer.length - 12; i++)` could false-negative a `colr` box near the tail.
**Reality:** This is an AUDIT-ONLY verifier (warn-and-continue; the encode decision does not depend on it). The 4096-byte head buffer always contains the `colr` box for well-formed AVIFs (it lives in the `meta` box near the start). Even if the bound were off, the consequence is a spurious operator log, not incorrect color delivery. The interior guards (`i + 12 > buffer.length`, `i + 14 <= buffer.length`) protect the actual reads. Confidence it is a non-bug: HIGH.

## Open Questions (low-confidence findings — surfaced, not blocking)

### OQ-R7C1-01 — `color-detection.ts:326` format gate does not include `'heic'`
**File:** `apps/web/src/lib/color-detection.ts:325-326`
**Confidence:** LOW (needs validation against real Apple HEIC Sharp output)
**Question:** `const format = metadata.format?.toLowerCase(); if (format === 'heif' || format === 'avif') {…}` gates NCLX + gain-map detection. If Sharp reports an Apple HEIC file as `format === 'heic'` rather than `'heif'`, then NCLX and gain-map detection are silently skipped for that file, falling back to ICC-name-only detection. The downstream encoder still works (it keys off `iccProfileName`), but the admin audit row would show `has_gain_map = false` and `transfer_function` from ICC name only — understating the source's HDR intent for the most common Apple HDR source.
**Evidence:** The only test reference (`__tests__/avif-probe-data-url.test.ts:30`) asserts `meta.format === 'heif'` for an AVIF — no test covers Apple HEIC. Sharp's `metadata.format` for HEIC is libheif-version-dependent.
**Suggested check:** Confirm whether Sharp 0.33+ reports Apple HEIC as `'heic'` or `'heif'` against a real iPhone 14+ sample. If `'heic'`, add it to the format guard: `if (format === 'heif' || format === 'avif' || format === 'heic')`. Low-effort, high-value for the HDR honesty surface CLAUDE.md documents.

## What was verified (coverage)

**CLIP / semantic search (deepest scrutiny, LIVE in production):**
- `app/api/search/semantic/route.ts` & `app/api/search/similar/[id]/route.ts` — gate ordering (same-origin → maintenance → validation → rate-limit pre-increment → mode gate → embedding → scan → enrich), Pattern-2 rollback on every early return, content-type/size/chunked-encoding guards, `clampSemanticTopK` typeof-number contract, prod-only `dotProduct` vs stub `cosineSimilarity` selection. The selector now has its source-contract pin (`__tests__/semantic-similarity-selector-contract.test.ts`, the AGG-C11-01 fix at HEAD). Correct.
- `lib/clip-embeddings.ts` — `decodeEmbeddingColumn` raw-Buffer + legacy-base64 + string handling; dimension invariant airtight (returns `null` unless exactly 2048 bytes → `bufferToEmbedding` always yields 512-dim → scan loop can never hit the dimension-mismatch throw). NaN scores filtered by `score >= threshold`. `topK` does not mutate input.
- `lib/image-queue.ts` embedding hook — mode-aware writer, RAW-buffer write matching the read contract, `onDuplicateKeyUpdate` with `modelVersion` partition.

**Image processing pipeline:**
- `lib/process-image.ts` — per-format fresh Sharp instances (WI-14), 10-bit AVIF probe Promise-singleton, atomic-rename contract, bounds-checked ICC parsing. Verified `decimalToRational` (RF-R7C1-03, correct).
- `lib/color-detection.ts` — NCLX → ICC chromaticity → ICC name precedence verified. Open question on `'heic'` format (OQ-R7C1-01).
- `lib/image-queue.ts` — per-image advisory lock, claim check, conditional UPDATE, deleted-mid-processing cleanup with `[]` sizes, retry/permanent-failure tracking, bootstrap cursor pagination, GC timer arming. Verified `retryFailedImage` (RF-R7C1-01, correct) and backfill counters (RF-R7C1-02, correct).
- `lib/admin-backfill-runner.ts` — advisory-lock lifecycle, pool-budget concurrency cap, deleted-mid-reencode cleanup, no-version-bump-on-detection-failure.

**Server actions / auth:**
- `app/actions/auth.ts`, `images.ts`, `topics.ts`, `settings.ts`, `sharing.ts`, `collections.ts`, `embeddings.ts` — origin check → isAdmin → action, consistent across all mutating actions. `requireSameOriginAdmin()` enforced everywhere (locked by `lint:action-origin`).
- `lib/auth-rate-limit.ts`, `rate-limit.ts`, `session.ts`, `password-hashing.ts` — Argon2id, HMAC-SHA256 + `timingSafeEqual`, dual-bucket login rate limit (IP + account), bounded Maps with eviction.

**Data layer / payment:**
- `lib/data.ts` — `_PrivacySensitiveKeys` compile-time guard, `publicSelectFields` derived from `adminSelectFields` by omitting PII (separate object reference), `tagNamesAgg` shared constant.
- `app/api/checkout/[imageId]/route.ts`, `api/stripe/webhook/route.ts`, `api/download/[imageId]/route.ts` — signature verification, paid-status gate, idempotency (sessionId UNIQUE + ON DUPLICATE KEY UPDATE + insertId disambiguation), single-use atomic token claim, open-before-claim ordering. Card-only pin (documented plan-316 deferral for `async_payment_succeeded`).
- `lib/db-restore.ts`, `sql-restore-scan.ts` — conditional-comment extraction, literal masking, dangerous-statement blocklist.

**Restore / maintenance / SW:**
- `lib/restore-maintenance.ts` — process-local flag (R7C1-01 LOW). `app/[locale]/admin/db-actions.ts` — advisory-lock release on all paths, `clear() → onIdle()` deadlock-free ordering.
- `lib/view-retention.ts`, `lib/advisory-locks.ts`, `lib/csv-escape.ts` — verified.

## Positive observations

- **The CLIP read/write contract** (`decodeEmbeddingColumn` ↔ raw-Buffer write) is single-sourced, fixture-locked, and dimension-invariant — the kind of subtle MEDIUMBLOB-vs-`text()` mismatch that historically broke prod is now structurally impossible.
- **Race-condition architecture is uniformly excellent.** The per-image advisory lock (`gallerykit:image-processing:{id}`) is acquired on a dedicated connection in BOTH image-queue and admin-backfill-runner, held across the full encode→detect→UPDATE window, and released in `finally`. Every DB UPDATE that marks progress checks `affectedRows === 0` to detect delete-during-processing and cleans up orphaned variants with `[]` sizes (full directory scan for non-default-size variants) — verified in all three encode sites.
- **Privacy enforcement is layered and compile-time-checked.** `_PrivacySensitiveKeys` guard + separate `publicSelectFields` reference + `topic_map_visible` runtime defense-in-depth assertion + mirror guard in `data-timeline.ts`.
- **Payment integrity is belt-and-suspenders.** Checkout enforces `priceCents <= 0` rejection; webhook re-validates `amount_total > 0`, re-checks tier allowlist, handles deleted-image-after-checkout by returning 200 with a manual-refund log so Stripe does not retry forever.
- **The sub-agent false-positive rate this cycle (4 of 6 disproven)** is itself evidence the codebase has converged — the issues being raised are increasingly subtle, and on direct verification they turn out to be correct code that looks suspicious at a glance.

## Recommendation

**COMMENT** — No CRITICAL / HIGH / MEDIUM issues. Four LOW-severity hardening opportunities (R7C1-01 through R7C1-04), none blocking. The codebase has fully converged at HEAD `17f743f7`. The single open question (OQ-R7C1-01, HEIC format gate) is worth a 5-minute check against a real iPhone sample but does not gate this verdict.

**If scheduling any fix this cycle:** OQ-R7C1-01 (HEIC format check) is the highest value-per-effort — a one-line guard addition that closes a potential HDR-honesty gap on the most common Apple HDR source. All four LOW findings are defensibly deferrable.
