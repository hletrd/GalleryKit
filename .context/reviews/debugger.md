# Debugger Review — Cycle 17 (HEAD 7b5c1943)

Latent-bug / failure-mode hunt. Priority: verify the cycle-16 fixes did not introduce
NEW regressions, and find adjacent latent bugs. Scope per brief: off-by-one/boundary,
null/undefined/NaN/Infinity, error-swallowing catch, races across awaits, transaction
atomicity, idempotency, resource leaks, incorrect early-returns, silent failure paths.

## Verdict on the cycle-16 fixes (all VERIFIED CORRECT)

| Cycle-16 fix | Commit | Verified |
|---|---|---|
| topic_views re-point before rename delete (DBG-16-01) | 097c472b | ✅ in ONE transaction; CASCADE no longer fires |
| smart-collection topic-rule remap on rename (DBG-16-03) | 35d7f171 | ✅ conservative eq/in remap, only changed rows written |
| upload claim-before-await TOCTOU (CR-16-01) | 78a9c0c2 | ✅ no double-settle; see DBG-17-1 for a throw-path leak it opened |
| og-photo Content-Length finite guard (DBG-16-02) | ada6817b | ✅ correct; sibling numeric reads all guarded |
| migrate 0024_drop_reactions journaling (C16-F1) | caa57769 | ✅ idempotent drops, monotonic journal, baseline-before-migrate |
| image-queue config reuse for semantic mode (PERF-16-01) | 6babb405 | ✅ benign; reuses one snapshot, adds no staleness |

### Topic rename — fully closed
FK references to `topics.slug` are exactly three (`schema.ts:16` topicAliases CASCADE,
`:33` images RESTRICT, `:236` topicViews CASCADE) plus smart-collection `query_json` (text).
All four are re-pointed inside ONE `db.transaction` wrapped by `LOCK_TOPIC_ROUTE_SEGMENTS`
(`topics.ts:250-323`). New-row INSERT is first, so a mid-rename slug collision throws
ER_DUP_ENTRY → full rollback → `slugAlreadyExists` (no half-rename). No other denormalized
topic-slug column exists. **No CASCADE-exposed sibling remains.** sharedGroups/tags do not
reference topics.slug; tags rename by integer PK (no recreate). This surface is clean.

### migrate.js 0024 — idempotent on every path
`dropColumnIfPresent` guards on INFORMATION_SCHEMA (`migrate.js:215-222`); `dropTableIfPresent`
uses `DROP TABLE IF EXISTS`. Both no-op on an already-dropped DB. On an already-baselined prod
DB the new 0024 journal entry flips `journalCovered === false` (`migrate.js:710`) → reconcile +
baseline re-run → 0024 hash inserted BEFORE `runMigrations` → drizzle.migrate() no-op → the
unguarded `ALTER … DROP COLUMN reaction_count` in the .sql never executes via drizzle. Journal
`when` for 0024 (1782100000000) is the max → cursor not poisoned. Post-condition cannot misfire.

---

## NEW findings

### DBG-17-1 — uploadImages leaks an upload-tracker claim when the topic-existence SELECT throws  (LOW, confidence: High, NEW — cycle-16 regression)

**File:** `apps/web/src/app/actions/images.ts:226-263` (claim at 226-228; unguarded await at 256-259).

**Latent bug.** The cycle-16 TOCTOU fix (CR-16-01) moved the quota CLAIM to *before* the
topic-existence `db.select`:

```js
tracker.bytes += totalSize; tracker.count += files.length;   // 226-228  CLAIM
uploadTracker.set(uploadTrackerKey, tracker);
... // disk check (try/catch → settles on error, 244/249)
const [topicRow] = await db.select({ slug: topics.slug })     // 256  UNGUARDED await
    .from(topics).where(eq(topics.slug, topic)).limit(1);
if (!topicRow) { settle(…,0,0); return topicNotFound; }       // 261  early-return settles
```

The function body is `try { … } finally { uploadContractLock.release(); }` with **no `catch`**
(confirmed `images.ts:561-564`). Every *early return* after the claim rolls it back
(244/249/261/513/535). But the topic-existence `db.select` at line 256 is **not** wrapped in
try/catch. If it throws — a transient DB error / pool-exhaustion / killed connection — the
exception propagates straight through `finally` to the framework, and the claim made at
226-228 is **never settled**. The author's own comment ("roll it back on early return") covers
returns but not throws.

**Exact trigger:** an admin upload where the disk pre-check passes, then the topic-existence
SELECT throws (DB blip, pool timeout, server restart mid-request). Pre-cycle-16 the claim was
made *after* this SELECT, so a throw here left the tracker untouched — this leak path is new.

**Observable failure:** that IP+user's window tracker is inflated by `+files.length` count and
`+totalSize` bytes even though zero files were stored. Subsequent uploads in the same window can
hit false `uploadLimitReached` / `cumulativeUploadSizeExceeded`. Self-inflicted, recovered when
the window expires and `pruneUploadTracker()` (line 183) evicts the stale entry on a later
upload — so bounded, hence LOW.

**Fix (minimal, house style — mirror the disk-check settle-on-catch):**
```js
let topicRow;
try {
    [topicRow] = await db.select({ slug: topics.slug })
        .from(topics).where(eq(topics.slug, topic)).limit(1);
} catch (err) {
    settleUploadTrackerClaim(uploadTracker, uploadTrackerKey, files.length, totalSize, 0, 0);
    throw err;
}
if (!topicRow) { settleUploadTrackerClaim(…, 0, 0); return { error: t('topicNotFound') }; }
```
(Robust alternative: track a `settled` flag and settle-if-unsettled in `finally`.)

**Verification:** unit test — stub `db.select` to reject once; assert the tracker entry's
`count`/`bytes` return to their pre-call values after the action rejects.

---

### DBG-17-2 — upload-tracker under-count when the tracking window expires between claim and settle  (LOW, confidence: Medium, NEEDS REPRO — pre-existing, exposure marginally widened by cycle-16)

**File:** `apps/web/src/lib/upload-tracker.ts:30-31` + `images.ts:195` (`resetUploadTrackerWindowIfExpired`).

`settleUploadTrackerClaim` reconciles with **relative deltas** (`success - claimed`), clamped by
`Math.max(0, …)`. This is correct under concurrency *within one window*. But if the tracking
window expires between a claim and its settle (a long upload that outlives the window), another
concurrent invocation calls `resetUploadTrackerWindowIfExpired` and zeroes the shared tracker
object; the in-flight settle then applies a *negative* delta (`success < claimed`) against the
fresh window, under-counting the new claim. Net: the window cap is relaxed by up to the
under-settled amount → a marginal quota relaxation.

**Trigger:** upload processing duration > window length, plus a concurrent same-key upload that
triggers the window reset mid-flight. Cycle-16 moved the claim earlier (now before disk+topic
awaits), lengthening the claim→settle span by those awaits — milliseconds vs the multi-second
loop, so exposure widened only marginally. Best-effort-by-design accounting; not a hard cap.

**Fix (if hardening desired):** stamp each claim with its `windowStart`; in settle, no-op the
reconcile when `tracker.windowStart` has advanced past the claim's stamp (the claim belongs to a
window that no longer exists). Otherwise document as accepted best-effort and leave as-is.

**Status:** NEEDS REPRO; low confidence it manifests in practice (windows are minutes-to-an-hour,
uploads rarely outlive them). Reported for completeness per the brief's under-count focus.

---

## Swept and CLEAN (no new issue)

- **NaN-survives-comparison sweep** — every `parseInt`/`Number()` site that feeds a comparison
  or DB query is guarded: route ids use `/^\d+$/` before `parseInt` (`og/photo/[id]:51`,
  `similar/[id]:74`, `g/[key]:92`, `p/[id]`); config coercions use `Number.isInteger`
  (`gallery-config-shared.ts:181/188/295`); year page uses `Number.isInteger` (`year/[year]:24/50`);
  exposure/shutter use `Number.isFinite` (`image-types.ts:118`, `process-image.ts:1392/1426/1515`);
  semantic Content-Length uses `Number.isFinite` (`route.ts:137`); offsets use `Number(x)||0`
  (NaN is falsy — `data.ts:798/1422`, `public.ts:117/123/169/181`); `view-retention.ts:43-46` and
  `audit.ts:111` fall back to default on non-finite/non-positive. og-photo-fetch.ts finite guard
  (the cycle-16 fix) is correct and its only other numeric read (`buffer.length`) is always finite.
- **Multi-step mutation / transaction-wrapper sweep** — `deleteImage` (626), `deleteImages` (738),
  `tags.deleteTag` (116), `tags.batchUpdateImageTags` (387), `bulkUpdateImages` (979),
  `sharing` group-create (transactional, affectedRows-checked), `admin-users.deleteUser`
  (advisory lock → beginTransaction → rollback-on-error → release in finally) are all atomic.
  `collections.ts` mutations are single-statement (no transaction needed). No unwrapped multi-step
  write found.
- **admin_users FK-child sweep** — `deleteUser` covers every FK to `admin_users.id`: images.uploaded_by
  (SET NULL via FK), audit_log.user_id (manual `UPDATE … SET user_id = NULL`, since the FK is
  NO ACTION — `admin-users.ts:260`), sessions (CASCADE + manual delete), admin_tokens (CASCADE).
  No errno-1451 gap.
- **Empty/swallowing catch sweep** — all `.catch(() => {})` hits are benign cleanup (fs.unlink of
  temp/derivative files, `RELEASE_LOCK`, `conn.rollback`, `exitFullscreen`, logout session delete).
  None swallow a correctness-bearing error.
- **view-count buffer flush** (`data.ts:100-174`) — atomic Map swap, bounded re-buffer with FIFO
  eviction + retry cap, backoff. Best-effort analytics by design; no new defect.
- **image-queue delete-during-processing** (`image-queue.ts:439-462`) — conditional
  `WHERE processed = false` UPDATE + full-scan variant cleanup on affectedRows===0. Correct.

## Test gate
`vitest run topics-actions + smart-collections + upload-tracker + migration-journal +
migrate-reconcile-coverage` → 115/115 passing. Cycle-16 fixes are test-locked.

## Summary
- The data-loss surface the prior cycle opened (topic rename CASCADE) is fully closed; no adjacent
  CASCADE-exposed sibling remains. All six cycle-16 fixes verified correct.
- **1 NEW confirmed latent bug** (DBG-17-1, LOW): a cycle-16-introduced claim-leak on the
  topic-existence SELECT throw path — over-counts the offending admin's own quota window.
- **1 NEW needs-repro** (DBG-17-2, LOW): pre-existing best-effort under-count on window-expiry-
  during-claim, marginally widened by cycle-16's earlier claim.
- No new MEDIUM+ correctness/data-loss bug found this cycle.
