# Debugger Review — Cycle 3

**HEAD:** b1e9e0da
**Date:** 2026-06-16
**Scope:** Full-repo latent-bug / failure-mode sweep — stream & FD lifecycle, async
cleanup races, swallowed errors, migrate.js idempotency, date/time math, ISOBMFF
walkers, number parsing, concurrency caps, NULL-aggregation traps. Verified against
current HEAD; closed prior-cycle items (serve-upload FD leak, map LIMIT,
blur-data-url, backfill summary, SW LRU) were re-checked and confirmed fixed, not
re-reported.

---

## Files Examined (read in full or in the load-bearing region)

`lib/image-queue.ts`, `lib/process-image.ts` (stream save + atomic-rename +
parseExifDateTime + processImageFormats cleanup), `lib/process-topic-image.ts`,
`lib/serve-upload.ts`, `lib/color-detection.ts` (ISOBMFF nclx walker),
`lib/icc-chromaticity.ts`, `lib/gain-map-detection.ts` (ISOBMFF iinf/iref walker),
`lib/gps-exif-strip.ts` (TIFF IFD walk + GPS zeroing), `lib/admin-backfill-runner.ts`
(concurrency math + run loop + lock lifecycle), `lib/data.ts` (view-count flush
buffer + all GROUP_CONCAT / MAX aggregations), `lib/auth-rate-limit.ts`,
`lib/view-retention.ts`, `lib/upload-tracker.ts`, `lib/mysql-datetime.ts`,
`lib/photo-title.ts`, `lib/validation.ts` (tag-name comma rejection),
`lib/og-photo-fetch.ts`, `lib/smart-collections.ts`, `lib/admin-tokens.ts`,
`scripts/migrate.js` (journal hash post-condition + reconcileLegacySchema +
fresh/partial-baseline paths), `app/actions/images.ts` (upload tracker settlement),
`app/actions/auth.ts` (login rate-limit flow), `app/api/download/[imageId]/route.ts`,
`app/[locale]/admin/db-actions.ts` (mysqldump stream), `app/api/og/photo/[id]/route.tsx`,
`app/api/stripe/webhook/route.ts`, `app/api/checkout/[imageId]/route.ts`.

Plus targeted greps across all of `lib/` + `app/` for: `createReadStream`/
`createWriteStream`/`pipeline`, `.catch(()=>{})` / empty catch, `JSON.parse`,
`setTimeout`/`setInterval` without unref, `affectedRows`/`rows[0]`/array-index,
`tag_names` consumers.

---

## CRITICAL Findings

None.

## HIGH Findings

None confirmed at HIGH for this cycle. The prior-cycle DBG-H1 (upload-tracker
quota over-claim) is re-assessed DOWN to LOW — see DBG-L1.

---

## LOW / NEEDS-VALIDATION Findings

### DBG-L1 — Upload-tracker quota settlement is not in a `finally` (defense-in-depth gap; prior DBG-H1, downgraded)
**Confidence:** Medium | **Status:** Likely (very-low trigger probability)
**File:** `apps/web/src/app/actions/images.ts:251-253` (pre-claim) →
`:490` / `:512` (settlement) vs `:538-540` (`finally` only releases the contract lock)

**Mechanics:** At lines 251-253 the in-memory upload tracker is pre-incremented by
the whole batch (`tracker.bytes += totalSize; tracker.count += files.length`).
`settleUploadTrackerClaim` reconciles claimed-vs-actual at line 490 (all-failed
path) and line 512 (success path) — **both inside the outer `try`**. The outer
`finally` (538-540) releases only `uploadContractLock`, NOT the tracker claim.

**Trigger:** an exception that propagates OUT of the per-file loop but is NOT caught
by the inner per-file `try/catch` (lines 271-481). The realistic per-file faults
(Sharp decode, DB insert, GPS strip, disk write) are all caught inside the loop and
`continue`. The only remaining throw surface between pre-claim and settlement is
framework-level: an unexpected throw in the loop's structural code, OOM, or a
Next.js internal error in `revalidateLocalizedPaths` ordering. The post-loop region
(488-512) is synchronous up to the settlement, so it cannot throw on an `await`.

**Observable failure (if hit):** the `${userId}:${ip}` tracker entry stays
over-counted by the full batch (count + bytes) until the window's
`resetUploadTrackerWindowIfExpired` fires on a later upload. The admin loses upload
quota for the remainder of the window on a degraded server. No data loss, no
security impact.

**Why downgraded from prior HIGH:** the per-file inner try/catch makes the trigger
path nearly unreachable in practice. It is a defense-in-depth gap, not a routinely
reachable bug.

**Fix (minimal):** wrap the two settlement calls in the outer `finally`, or
pre-increment per-file. Idiomatic form: hoist a `let settled = false;` and in the
`finally` do `if (!settled) settleUploadTrackerClaim(...)` with the
already-computed `successCount` / `uploadedBytes` (both are in outer scope). The
existing `Math.max(0, …)` in `settleUploadTrackerClaim` already makes a
double-settle safe to guard against.

---

## Verified-SAFE (initially suspicious, confirmed NOT bugs)

These are documented to prevent re-flagging in future cycles.

- **`tag_names.split(',')`** in `lib/photo-title.ts:72` and
  `components/image-manager.tsx:487/489`: `tagNamesAgg` (data.ts:605) is
  `GROUP_CONCAT(DISTINCT tags.name …)` with the DEFAULT comma separator, so a tag
  *name* containing a comma would shatter into false tags. **`isValidTagName`
  (validation.ts:124) explicitly rejects `,`** (`!trimmed.includes(',')`) precisely
  to keep this split safe — a deliberate validation⇄aggregation coupling. Not a bug.
  (The slug+name combined concat in `getImageByShareKey`, data.ts:1137, uses
  `CHAR(0)`/`CHAR(1)` delimiters and is independently safe.)

- **`getLoginRateLimitEntry` mutating `entry.count = 0` in place** (auth-rate-limit.ts:24):
  the window-reset mutates the cached object reference, but the only caller that reads
  `.count` (auth.ts login flow) immediately increments and `.set()`s it (auth.ts
  105/128-130). No read-only path leaves a spuriously-zeroed entry in the map.

- **Backfill `state.running` in-process flag window** (admin-backfill-runner.ts:821 vs
  628): `triggerAdminBackfill` returns before the fire-and-forget `runBackfill` sets
  `state.running = true`, so there is a window where the flag is stale. The MySQL
  advisory lock (`acquireBackfillLock`, line 828) is the true mutex — a concurrent
  trigger fails lock acquisition and returns `already_running`. The flag is advisory
  belt-and-braces only. Not a bug.

- **View-count flush partial-failure backoff** (data.ts:152-153): `if (succeeded > 0)
  consecutiveFlushFailures = 0` resets backoff even when some groups failed and were
  re-buffered. The per-group `VIEW_COUNT_MAX_RETRIES` cap (line 117) drops a
  persistent failer after 3 tries, so there is no infinite re-buffer loop. Matches
  the documented best-effort-analytics posture. Not a bug.

- **Stream lifecycle** in `download/[imageId]/route.ts`, `serve-upload.ts`,
  `process-image.ts`, `process-topic-image.ts`, `db-actions.ts`: every
  `createReadStream`/`createWriteStream`/`pipeline` closes on error (catch +
  `destroy()` / `unlink`), on abort (serve-upload AGG-H5 signal listener), and on
  success (autoClose / `pipeline` resolution). The download route's open→stat→claim
  ordering (R4C4/R4C5) closes the handle on every post-open path. No FD leaks found.

- **ISOBMFF walkers** (`color-detection.ts parseCicpFromHeif`,
  `gain-map-detection.ts hasGainMap`): both bound depth (≤5), scan bytes (≤1 MB),
  validate `size < headerSize || pos + size > buffer.length` before recursing, advance
  `pos` by ≥8 every iteration (no infinite loop on a 0-data box), cap entry counts at
  1024, and wrap the top-level walk in try/catch. 64-bit `size` via
  `Number(readBigUInt64BE)` is bounds-checked after conversion so a >2^53 size is
  rejected, not silently truncated into a valid offset. A crafted/truncated file
  returns null/false, never hangs.

- **ICC chromaticity math** (`icc-chromaticity.ts`): `xyzToXy` guards `|X+Y+Z| < 1e-9`
  (no divide-by-zero), `invert3x3` guards `|det| < 1e-12`, `readS15Fixed16` /
  `readXyzTag` / `readChadMatrix` bounds-check + `Number.isFinite`. Tag-table walk
  capped at 100 tags / 4 KB. No NaN escape, no OOB read.

- **Concurrency cap math** (`admin-backfill-runner.ts:129-142`
  `resolveBackfillConcurrency`): `Number.isFinite(poolLimit) ? poolLimit : 10`
  handles undefined pool; `Math.max(1, …)` floors the cap at 1;
  `Math.max(1, Math.floor(requested) || 1)` neutralizes NaN/0/negative requested
  (`Math.floor(NaN)→NaN`, `NaN||1→1`; `Math.max(1, -5)→1`). The prior-cycle NaN/zero
  concern is fully closed.

- **migrate.js** journal post-condition (lines 698-719) throws loud on any
  silently-skipped migration; `getAllJournalMigrations` rejects an empty journal
  (147-149) and a missing `.sql` file (readFileSync throws); fresh-DB
  (`!hasGalleryTables`) and partial-baseline paths both route through
  `reconcileLegacySchema` + per-entry hash baseline (idempotent). No empty-journal or
  partial-baseline edge slips through.

- **Date/time:** `mysql-datetime.ts toMySqlDateTime` and `process-image.ts
  parseExifDateTime` consistently use SERVER-LOCAL getters (PP-BUG-1 /
  COR-R4C2-01) matching mysql2's `Date` serialization and `NOW()`. The string branch
  of `parseExifDateTime` emits raw matched components without a `new Date()`
  round-trip — the most TZ-robust path. The documented assumption (Node TZ == MySQL
  session TZ, typically UTC in Docker) is an accepted design constraint, not a fresh
  regression. `view-retention.ts resolveRetentionMs` guards negative/non-finite
  retention from putting the cutoff in the future.

- **JSON.parse** sites (`smart-collections.ts:310`, `admin-tokens.ts:120`,
  `search/semantic/route.ts:167`) are all try/catch-guarded into typed errors or `[]`.

- **NULL-returning aggregations** (`data.ts`): `getLatestImageUpdatedAt`
  (`row?.latest ?? null`), `last_image_updated_at` (typed `Date | null`), count
  aggregations (COUNT → 0 for empty groups), and all `rows[0]?.…` accesses use
  optional chaining. The prior tagNamesAgg-style NULL-deref bug class is
  systematically closed.

---

## Top-findings summary

The latent-bug surface is in very good shape after ~58 prior closures. This cycle
surfaced **no new CRITICAL/HIGH** confirmed bugs. The single actionable item is
**DBG-L1** (LOW): the upload-tracker quota settlement in `images.ts` lives inside the
`try`, not the `finally` — a narrow defense-in-depth gap that only over-claims a
photographer's in-window upload quota on a framework-level throw that escapes the
per-file try/catch. Recommend moving settlement to `finally` behind a `settled`
guard. Everything else examined (stream/FD lifecycle, ISOBMFF walkers, chromaticity
math, concurrency caps, migrate.js post-conditions, date/time handling, NULL
aggregations) is correctly hardened, and several initially-suspicious patterns were
confirmed safe and recorded above to prevent churn.
