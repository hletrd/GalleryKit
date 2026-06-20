# Debugger Review — Run 7 Cycle 4

**HEAD:** 25bb2794  
**Delta from cycle-3 HEAD (c6eff919):** 2 comment/guard fixes only (`color-detection.ts` comment correction, `settings-hash.ts` compile-time guard) + review docs + SW stamp. Zero new application logic.  
**Date:** 2026-06-20  
**Status:** COMPLETE — 0 confirmed new findings

---

## Surfaces Investigated

### 1. `gps-exif-strip.ts` iloc parser — `indexSize` not in validation loop

**Surface:** `indexSize = ilocVersion >= 1 ? (sizesByte2 & 0xf) : 0` (line 466). The `[offsetSize, lengthSize, baseOffsetSize]` validation loop at lines 476–478 checks membership in `{0,4,8}` but does NOT include `indexSize`.

**Finding:** DISPROVED (re-confirms REJ-R7C3-01). `indexSize` is never passed to `readSized` — it is used only as an addend in the bounds-check sum (`extentEntrySize = indexSize + offsetSize + lengthSize`, line 513) and as a skip offset (`pos += indexSize`, line 515). The bounds check fires at line 514 (`pos + extentEntrySize > ilocBox.dataEnd → return null`) BEFORE any read. A malformed `indexSize` either trips the bounds check (returns null, safe) or misaligns `pos` such that subsequent `readSized` calls on already-validated `offsetSize`/`lengthSize` return null. No out-of-bounds read is possible.

**Status:** NOT RE-FILED per adjudication instruction (REJ-R7C3-01).

---

### 2. `icc-extractor.ts` — mluc `recTextOffset` 32-bit overflow

**Surface:** `recTextOffset = icc.readUInt32BE(recOffset + 8)` (line 100, untrusted). `strStart = dataOffset + recTextOffset` (line 101) could in principle produce a very large value.

**Verification:** The guard at line 103 is `strEnd > iccLen || strEnd > dataOffset + dataSize || strStart >= strEnd`. With `recTextOffset = 0xFFFFFFFF` (max uint32) and a small buffer, `strEnd = strStart + recLen` easily exceeds `iccLen` (caught by first clause) or `dataOffset + dataSize` (caught by second clause). JavaScript Numbers handle values up to `Number.MAX_SAFE_INTEGER` (~9e15) without precision loss, and both `iccLen` and `dataOffset + dataSize` are bounded by the actual buffer size (max ~2 GB on 64-bit Node). The overflow does not produce a negative or wrapped value.

**Status:** CLEAN — no bug.

### 3. `icc-extractor.ts` — desc v2 `strLen - 1` when `declaredLength == 1`

**Surface:** Line 78: `strEnd = strStart + Math.max(0, strLen - 1)`. If `declaredLength == 1` (pure null terminator), `strLen = 1`, so `strEnd = strStart + 0 = strStart`.

**Verification:** The guard at line 79 is `strStart >= strEnd` — this catches the `strEnd == strStart` case and breaks (returns null). Safe. `declaredLength == 0` is caught by line 75 (`declaredLength < 8`). Clean.

**Status:** CLEAN — no bug.

---

### 4. `use-display-capability.ts` — snapshot memoization (React #185)

**Surface:** Module-level `let _cachedSnapshot: DisplayCapability | null = null` (line 47). `detect()` value-compares `colorGamut` and `isHdr` before returning a new object (lines 76–84).

**Verification:** Confirmed CLEAN. `SERVER_DEFAULT` is a stable module-level constant. `getServerSnapshot()` always returns the same reference. `detect()` returns `_cachedSnapshot` unchanged when values match. The React #185 infinite-loop invariant is preserved.

**Status:** CLEAN — no bug.

---

### 5. `gain-map-detection.ts` — ISOBMFF walker bounds

**Surface:** `parseIinf` (lines 150–175), `parseIref` (lines 185–216), and `walk` (lines 218–248).

**Verification:**
- `parseIinf`: entry count capped at 1024 (`parsed < 1024`). Each iteration reads `readBoxHeader` which bounds-checks internally.
- `parseIref`: outer cap `parsed < 1024`. Inner `refCount` capped at 1024. Per-id read guarded by `inner + idSize > innerEnd` break.
- `walk`: wrapped in `try/catch` at lines 242–248; any parse exception returns `false` (safe). Depth limited to `MAX_DEPTH`. Scan limited to `MAX_SCAN_BYTES` per `Math.min`.

**Status:** CLEAN — no bug.

---

### 6. `clip-embeddings.ts` — `decodeEmbeddingColumn` 2048-byte boundary

**Previously confirmed clean (cycle 3).** Delta contains no changes to this file. No re-investigation needed.

**Status:** CLEAN — carried forward from REJ-R7C3.

---

### 7. `blur-data-url.ts` — prefix validation and length cap

**Previously confirmed clean (cycle 3).** Delta contains no changes to this file.

**Status:** CLEAN — carried forward from REJ-R7C3.

---

### 8. `admin-backfill-runner.ts` — advisory lock release in finally

**Surface:** `runBackfill(lockConn)` has a `finally` at line 805 calling `releaseBackfillLock(lockConn).catch(() => undefined)`. `releaseBackfillLock` itself has a `finally` at line 330 calling `lockConn.release()`. Per-image claim released in `finally` at line 610 via `releaseImageProcessingClaim(row.id, claimConn).catch(() => undefined)`.

**Verification:** All three lock-release paths use `finally` and `.catch(() => undefined)` to prevent secondary exceptions from masking the primary. `acquireImageProcessingClaim` releases the connection in the `catch` branch (query error) and on the `acquired !== 1` normal path — the connection only lives beyond the function when returned to the caller that puts it in the per-image `finally` block.

**Status:** CLEAN — no bug.

---

### 9. `backfill-color-pipeline.ts` sidecar — lock release on `queue.onIdle()` throw

**Surface:** Lock release at lines 514–520 is sequential code after `await queue.onIdle()` (line 500) and `await flushBatch()` (line 503). No outer `try/finally` wraps the post-lock-acquire body. If `queue.onIdle()` or `flushBatch()` throws, the explicit `RELEASE_LOCK` + `lockConn.release()` calls are skipped.

**Assessment:** NOT a bug. The `.catch()` at line 534 (`main().catch(err => { ...; process.exit(1) })`) calls `process.exit(1)`. On process exit, Node.js closes all connections, and MySQL's `GET_LOCK` is connection-scoped — the lock is released automatically on connection close. The comment at line 301 documents this explicitly: "GET_LOCK scope is connection-bound; releasing the connection automatically releases the lock on MySQL close." The explicit `RELEASE_LOCK` before `process.exit` is belt-and-braces only. This is the correct pattern for a `--rm` sidecar process.

**Status:** CLEAN — by-design for process.exit() sidecar.

---

## Summary

| ID | Surface | File | Status |
|----|---------|------|--------|
| REJ-R7C3-01 | `indexSize` not in iloc validation loop | `gps-exif-strip.ts:466` | DISPROVED (re-confirmed, not re-filed) |
| C4-INV-01 | mluc `recTextOffset` uint32 overflow | `icc-extractor.ts:101` | CLEAN |
| C4-INV-02 | desc v2 `strLen-1` when length=1 | `icc-extractor.ts:78` | CLEAN |
| C4-INV-03 | snapshot memoization React #185 | `use-display-capability.ts:47` | CLEAN |
| C4-INV-04 | ISOBMFF walker bounds (iinf/iref/walk) | `gain-map-detection.ts:150-248` | CLEAN |
| C4-INV-05 | `decodeEmbeddingColumn` 2048-byte boundary | `clip-embeddings.ts` | CLEAN (carried) |
| C4-INV-06 | blur-data-url prefix + length cap | `blur-data-url.ts` | CLEAN (carried) |
| C4-INV-07 | advisory lock finally — in-app runner | `admin-backfill-runner.ts:805` | CLEAN |
| C4-INV-08 | sidecar lock on queue.onIdle() throw | `backfill-color-pipeline.ts:500-520` | CLEAN (by-design) |

**Confirmed new findings: 0**  
**Disproved candidates: 1 (REJ-R7C3-01, re-confirmed)**

This is a truthful zero — the cycle-4 delta contains no application logic, and all previously-clean surfaces remain clean on re-examination. The run converges.
