# Debugger — Cycle 6 RPL

Date: 2026-04-23. Reviewer role: debugger (latent bugs, failure modes,
regressions).

## Scope

Look for latent bugs and failure modes in code that appears correct but
has subtle off-by-one, error-swallowing, or state drift issues.

## Findings

### D6-01 — `saveOriginalAndGetMetadata` returns `originalHeight` fallback to `originalWidth` when metadata missing
- File: `apps/web/src/lib/process-image.ts:273-274, 347-348`.
- Severity: LOW. Confidence: HIGH.
- `height = width when metadata.height missing` is a guess-fallback. If
  a tall portrait image has metadata.height but missing metadata.width, or
  vice versa, the other dimension defaults to `width` producing a square
  aspect ratio. This results in distorted rendering in the gallery
  masonry layout.
- Scenario: corrupted JPEG with truncated SOF marker — Sharp returns
  partial metadata. Width is valid (parsed from earlier marker), height
  is undefined. Fallback sets height=width. User sees a square cropped
  version of a tall image.
- Fix: prefer throwing on missing dimensions (image unsupported) rather
  than silently defaulting. Or use Sharp's `metadata.pageHeight` as a
  secondary source. Defensive improvement.

### D6-02 — `convertDMSToDD` rejects exactly-boundary DMS values
- File: `apps/web/src/lib/process-image.ts:496-505`.
- Severity: LOW. Confidence: HIGH.
- `dms[1] >= 60 || dms[2] >= 60` uses `>=`. Legitimate EXIF GPS values at
  exactly 60.0 (unusual but theoretically valid when rolled over from
  the lower minute unit) would be rejected. For latitude 34°60'00.0" the
  math would convert to 35°00'00.0", not invalid. Cameras normalize, so
  in practice no real EXIF tag has 60.0 in mins/secs. Observational.
- Separate: `Math.abs(dd) > maxDegrees` uses `>`, so a computed 90.0 is
  allowed; good.

### D6-03 — `parseExifDateTime` with typeof string path uses `cleanString` on camera Model etc. but returns full EXIF sub-objects untyped
- File: `apps/web/src/lib/process-image.ts:480-513`.
- Severity: LOW. Confidence: MEDIUM.
- `extractExifForDb` accesses `exifData.exif || exifData.Photo || {}` and
  `exifData.image || exifData.Image || {}`. If both branches return empty
  objects (EXIF block missing), all downstream fields are null. Good.
- But `exifData.gps || exifData.GPSInfo || {}` — `gpsParams` is an empty
  object when GPS missing. `gpsParams.GPSLatitude && gpsParams.GPSLatitudeRef`
  short-circuits safely. OK.

### D6-04 — `cleanOrphanedTmpFiles` doesn't rate-limit or restrict to "old" .tmp files
- File: `apps/web/src/lib/image-queue.ts:23-37`.
- Severity: LOW. Confidence: MEDIUM.
- The function runs at bootstrap and iterates 3 dirs, unlinking ALL .tmp
  files. If a concurrent image-processing task is mid-atomic-rename (i.e.,
  the `.tmp` file exists briefly between `fs.link` and `fs.rename`), this
  bootstrap cleanup could race and unlink the .tmp file, causing the
  rename to fail and the processing to fallback to copy+rename.
- Triggering scenario: bootstrap fires at the same instant an upload is
  processing its last size variant. Unlikely but possible on a stalled
  queue.
- Fix: restrict to .tmp files older than a threshold (e.g., mtime > 5
  minutes). Defensive.

### D6-05 — `incrementRateLimit` uses `sql\`${rateLimitBuckets.count} + 1\`` but `decrementRateLimit` uses `sql\`GREATEST(${...count} - 1, 0)\``
- File: `apps/web/src/lib/rate-limit.ts:213`, `apps/web/src/lib/rate-limit.ts:248-265`.
- Severity: LOW. Confidence: HIGH.
- The two operations are asymmetric: INSERT...ON DUPLICATE KEY UPDATE for
  increment (row always exists afterward) vs UPDATE + conditional DELETE
  for decrement. The decrement's post-delete query is a second round-trip;
  when `count > 0`, the delete runs but affects 0 rows. This is 2 DB
  round-trips instead of 1.
- Fix: use a single SQL with a CASE to either decrement or delete. Current
  perf is acceptable. Observational.

### D6-06 — `db-actions.ts::runRestore` `pipeline` fails-open on mid-transfer errors
- File: `apps/web/src/app/[locale]/admin/db-actions.ts:319-328`.
- Severity: LOW. Confidence: MEDIUM.
- `await pipeline(nodeStream, createWriteStream(tempPath, { mode: 0o600 }))`
  — if the write stream errors out mid-pipe (disk full), pipeline rejects
  with an error. The catch block unlinks tempPath. BUT: if the error is
  caught and the function returns `failedToSaveUpload`, the header + scan
  passes are skipped. The tempPath is gone. No way to tell if a partial
  file was written or zero bytes. The outer restore gate (isAdmin,
  same-origin, rate-limit) was already consumed.
- Fix: log the pipeline error for diagnosis. Current `catch {}` swallows
  silently. Minor observability improvement.

### D6-07 — `scanFd.read` doesn't verify bytes-read count
- File: `apps/web/src/app/[locale]/admin/db-actions.ts:353`.
- Severity: LOW. Confidence: MEDIUM.
- `await scanFd.read(chunkBuf, 0, readSize, off)` returns `{bytesRead, buffer}`.
  Code uses `chunkBuf.toString('utf8')` without checking bytesRead. If
  the read returns fewer bytes than requested (EOF or interrupted read),
  the unused portion of the buffer contains zeros. `toString('utf8')`
  would include those zeros as U+0000 characters, which `containsDangerousSql` might misinterpret.
- Impact: stripSqlCommentsAndLiterals masks string literals AND strips null
  bytes through the existing control-char strip step (db-actions.ts:31).
  Actually, `containsDangerousSql` uses a different stripSqlCommentsAndLiterals function that strips comments and quoted literals; it does NOT strip null bytes. A trailing zero-filled region would be treated as "whitespace" by the regex patterns (no match on boundary-sensitive patterns). So impact is mostly benign.
- Fix: use `bytesRead` to `.subarray(0, bytesRead)` before toString. Defensive.

### D6-08 — `shareRateLimit` uses Map iteration order for LRU eviction, but iteration order is insertion order, not access order
- File: `apps/web/src/app/actions/sharing.ts:41-49`.
- Severity: LOW. Confidence: HIGH.
- Current eviction strategy: `for (const key of shareRateLimit.keys()) {...}`
  iterates in insertion order. This evicts the oldest-inserted keys, not
  the least-recently-accessed. If an attacker can seed old keys early
  and then use recent keys, the attacker's recent keys persist while
  legitimate users' early keys get evicted.
- Impact: moot for share-rate-limit because the attacker can't seed
  unlimited keys without an admin session.
- Same pattern used in `loginRateLimit` prune (rate-limit.ts:110-118) and
  `uploadTracker` prune. Documented behavior; not LRU.
- Fix: documentation. Rename "LRU evict" comments to "FIFO evict" to match
  behavior. Observational.

### D6-09 — `purgeExpiredSessions` swallows errors silently
- File: `apps/web/src/lib/image-queue.ts:284-290`.
- Severity: LOW. Confidence: HIGH.
- `catch (err) { console.error(...) }` is the right pattern. Good. No bug.

### D6-10 — `bootstrapImageProcessingQueue` runs `setInterval` that accumulates if module re-imported
- File: `apps/web/src/lib/image-queue.ts:329-336`.
- Severity: LOW. Confidence: HIGH.
- Line 329: `if (state.gcInterval) clearInterval(state.gcInterval);` —
  correctly clears a prior interval before setting a new one. Defends
  against hot-reload in dev. Good. No bug.

### D6-11 — `deleteImage` transaction doesn't check if `imageTags` delete returned 0 rows but image delete also returned 0 rows
- File: `apps/web/src/app/actions/images.ts:383-388`.
- Severity: LOW. Confidence: MEDIUM.
- If both deletes affect 0 rows (concurrent deletion by another request),
  `deletedRows = 0` and audit event is skipped. Then outer code returns
  `{ success: true, cleanupFailureCount: ...}`. The caller sees success
  but nothing was deleted.
- This is correct behavior: if another admin concurrently deleted the
  same image, the SECOND delete is a no-op from the DB perspective; the
  files are already gone (or in cleanup); returning success is semantically
  fine. The audit log is deduplicated.
- Observational — not a bug.

## Summary

- **11 LOW** findings. Most are observational or defensive. The most
  actionable: **D6-01** (image dimension fallback to square) and **D6-04**
  (cleanOrphanedTmpFiles race with in-flight processing).
- No HIGH/MEDIUM latent bugs found. The code's layered defenses handle
  the races and error paths cleanly.
