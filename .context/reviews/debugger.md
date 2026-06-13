# Cycle-6 Debugger Review

**NEW findings: 1 confirmed bug, 1 dead-code note, 1 test-naming defect**

---

## Bug DBG-C6-01 — `stripGpsFromWebpBuffer` reads RIFF chunk fields in wrong order (lossless WebP GPS-strip path always dead)

**Severity:** Medium  
**Confidence:** High (deterministic logic error, no speculation)  
**Privacy impact:** None (GPS is still stripped via re-encode fallback)  
**Quality impact:** Every WebP original with `strip_gps_on_upload=true` is silently re-encoded at q95 instead of having GPS losslessly scrubbed in-place. Paid-download deliverable is quality-degraded.

### Root Cause

`apps/web/src/lib/gps-exif-strip.ts` lines 564–565:

```typescript
const chunkSize = buf.readUInt32LE(offset);                    // BUG: reads ChunkTag bytes as size
const chunkTag = buf.toString('ascii', offset + 4, offset + 8); // BUG: reads ChunkSize bytes as tag
```

RIFF sub-chunk wire format is `[ChunkTag: 4 bytes ASCII][ChunkSize: 4 bytes LE uint32][ChunkData]`. The code has the two reads swapped. On the very first sub-chunk in every real WebP file (e.g. `VP8X` = FourCC `0x56503858`; as LE uint32 = 0x58385056 = 1,479,749,718), that FourCC value is misread as `chunkSize`. Then:

```typescript
const dataEnd = dataStart + chunkSize; // = 12 + 8 + ~1.48 GB
if (dataEnd > buf.length) return null; // always true for real WebP files
```

The function returns `null` on the first iteration for every real WebP file. It never reaches the `EXIF` or `XMP ` tag comparisons.

Additionally, if the loop were ever reached, line 580 writes the JUNK retag to the wrong offset:
```typescript
buf.write('JUNK', offset + 4, 4, 'ascii'); // offset+4 is the ChunkSize field, not ChunkTag
```
The correct write target is `offset` (the ChunkTag field position).

### Effect

`stripGpsFromWebpBuffer` returning `null` causes `stripGpsFromOriginal` in `apps/web/src/lib/process-image.ts` line 1565 to log `'lossless WebP scrub failed; re-encoding at q95'` and fall through to the Sharp WebP re-encode tier. The GPS is stripped (no privacy leak) but the original is lossy-reencoded instead of byte-surgically scrubbed.

### Fix (minimal — 2 lines changed plus 1 write offset)

`apps/web/src/lib/gps-exif-strip.ts` lines 564–565 and 580:

```typescript
// Before (wrong):
const chunkSize = buf.readUInt32LE(offset);
const chunkTag = buf.toString('ascii', offset + 4, offset + 8);
// ...
buf.write('JUNK', offset + 4, 4, 'ascii');  // wrong: overwrites size field

// After (correct):
const chunkTag = buf.toString('ascii', offset, offset + 4);    // ChunkTag first (bytes 0–3)
const chunkSize = buf.readUInt32LE(offset + 4);                // ChunkSize second (bytes 4–7)
// ...
buf.write('JUNK', offset, 4, 'ascii');  // correct: overwrites ChunkTag field
```

### Test gap (DBG-C6-01b)

`apps/web/src/__tests__/strip-gps-from-original.test.ts` line 116 is titled `'removes GPS from a WebP original via the RIFF scrub (pixels byte-identical)'`. The test only checks:
1. GPS is absent after the call.
2. Pixel values are identical before and after.

Both assertions pass when the Sharp re-encode fallback runs (the fallback also strips GPS and preserves pixels). The test does NOT verify that the lossless RIFF path was taken. The test name is incorrect and the contract it claims to enforce (lossless byte-surgery) is not tested. A test that calls `stripGpsFromWebpBuffer(input)` directly and asserts it returns a non-null result with `stripped: true` would catch this regression.

---

## Dead Code Note DBG-C6-NC-01 — `readNullTerminatedAscii` unreachable guard in gain-map-detection.ts

**Severity:** Low / no impact

`apps/web/src/lib/gain-map-detection.ts` line 87:

```typescript
function readNullTerminatedAscii(start: number, end: number): string {
    const limit = Math.min(end, buffer.length);
    let p = start;
    while (p < limit && buffer[p] !== 0) p++;
    if (p > limit) return '';   // unreachable: while loop guarantees p <= limit on exit
    return buffer.toString('ascii', start, p);
}
```

The `if (p > limit)` guard can never be true because the `while` loop condition `p < limit` ensures `p <= limit` on exit. Dead code only; the function is correct.

---

## Surfaces Confirmed Clean (no regressions from cycle 5)

- **`color-detection.ts`** — NCLX `parseCicpFromHeif`: size=1 box BigUInt64 without MAX_SAFE_INTEGER guard, but the `pos + size > buffer.length` check with the 1 MB scan cap catches imprecise values. All NCLX field reads bounds-checked before use. Clean.
- **`icc-extractor.ts`** — `tagCount` capped at 100, `tagOffset + 12 > iccLen` guard holds, `mluc` record loop fully validated. Clean.
- **`icc-chromaticity.ts`** — Tag table bounded by `MAX_TAG_COUNT=100` and `MAX_TAG_TABLE_BYTES=4KB`. `readXyzTag` validates `offset + 20 > buf.length`. `invert3x3` guards `Math.abs(det) < 1e-12`. `readChadMatrix` checks `offset + 44 > buf.length`. Clean.
- **`gain-map-detection.ts`** — ISOBMFF walk bounded at `MAX_DEPTH=5`, `MAX_SCAN_BYTES=1MB`. All `readBoxHeader` calls bounds-checked. `parseInfe`/`parseIref` guards hold. Clean (dead code noted above).
- **`gps-exif-strip.ts` JPEG/TIFF/ISOBMFF sections** — JPEG APP1 segment walk bounded. TIFF `valueSize = typeSize * valueCount` with `inBounds` guard catches 32-bit overflow. ISOBMFF walker correctly checks `big > BigInt(Number.MAX_SAFE_INTEGER)` for size=1 boxes. Clean.
- **`use-display-capability.ts`** — `_cachedSnapshot` value-memoization prevents React error #185. `subscribe` removes all MQ listeners, visibility, and focus handlers in cleanup. Clean.
- **`histogram.tsx`** — Worker lifecycle under StrictMode double-fire: second mount re-creates worker after unmount termination. `aborted` flag and AbortController prevent stale callbacks. Clean.
- **`image-queue.ts`** — `enqueued` Set `finally`-deleted correctly. `permanentlyFailedIds` FIFO eviction bounded at 1000 (intentional design). `bootstrapContinuationScheduled` guard prevents duplicates. Advisory lock connections released in `finally`. Clean.

---

## References

- `apps/web/src/lib/gps-exif-strip.ts:563–568` — field-order swap (chunkSize/chunkTag reversed)
- `apps/web/src/lib/gps-exif-strip.ts:580` — JUNK write to wrong offset (ChunkSize field instead of ChunkTag field)
- `apps/web/src/lib/process-image.ts:1565` — re-encode fallback warn log; fires for every WebP with GPS when lossless scrub fails
- `apps/web/src/__tests__/strip-gps-from-original.test.ts:116` — test title claims lossless RIFF path, contract not actually enforced
- `apps/web/src/lib/gain-map-detection.ts:87` — dead-code guard `if (p > limit)` (no functional impact)
