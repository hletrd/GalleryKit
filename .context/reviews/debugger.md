# Cycle-8 Debugger Review

**HEAD:** `9c40d261` (clean working tree). Run-9 cycle-4's scheduled fixes landed since the prior cycle's `d0920957`.

**NEW confirmed latent bugs: 0.** I did NOT trust the prior cycle-7 summary — I re-read every binary parser, lifecycle FSM, and the two substantive code deltas line-by-line at this HEAD. The codebase remains converged on the failure-mode / boundary-arithmetic surface I own. The two new code changes this cycle are both correct. One previously-recorded harmless dead-code note persists (DBG-C6-NC-01). Two below-the-bar quality notes recorded for completeness (no fix warranted).

---

## What changed since `d0920957` (the only new code, re-verified fresh)

| Commit | Change | Verdict |
|---|---|---|
| `85bca582` | New `isLosslessWebpByChunk()` in `process-image.ts:1498-1518`; replaces the `input.includes(Buffer.from('VP8L'))` whole-buffer substring scan at the Tier-2 WebP GPS re-encode (was AGG-C7-05) | **CORRECT** — re-traced (below). Bounds-safe, terminates, fails to the SAFE lossy default. |
| `b47cdbb6` | `admin-header.tsx:16` brand `<Link>` gained `min-h-11` (was AGG-C7-01) | Out of my lane (a11y); noted as present. No logic impact. |
| `5ef545bf` | New direct `stripGpsFromWebpBuffer` XMP-branch tests (was AGG-C7-02) | Test-only; pins the privacy-critical XMP `JUNK`-retag branch. |
| `99071d76` / `5d7bd2ac` | touch-target scale-token catch-all extended to Link/a/select + doc (AGG-C7-03/04) | Test/doc only. |

### `isLosslessWebpByChunk` (`process-image.ts:1498-1518`) — re-traced every edge

- Loop guard `offset + 8 <= buf.length` (1505) bounds both the `tag` read (`offset..offset+4`) and `readUInt32LE(offset+4)` (`offset+4..offset+8`). Correct.
- `VP8L`→true / `VP8 `→false (1508-1509); VP8X/ICCP/ANIM/EXIF/XMP skipped to reach the real pixel chunk. A VP8X-wrapped lossy file correctly returns false (walks past VP8X to the top-level `VP8 `). Correct.
- `next = offset + 8 + size + (size % 2)` (1513): `size` is u32 (≤ ~4.29e9), `next` ≤ ~4.29e9, exact in JS Number — no 32-bit wrap. `8 + size + pad ≥ 8 > 0`, so `next > offset` always; the `next <= offset` guard (1514) is belt-and-braces. Loop always terminates (offset strictly increases; the `offset+8<=len` guard eventually fails). No infinite loop.
- Malformed / non-RIFF / too-short → false (1499-1502); any ambiguity → false. Matches the documented SAFE lossy default, and GPS is stripped by the re-encode regardless of this boolean — zero privacy/correctness impact even on misclassification.
- Test fixture (`process-image-webp-lossless-detect.test.ts`) is non-vacuous: the planted-`VP8L`-in-XMP case asserts `includes()` WOULD have matched (line 63) while the chunk-aware check returns false (line 65) — proves the exact regression closed.

---

## VERIFIED-BOUNDS-CORRECT walkers (re-read in full this cycle, not trusted from cycle-7)

### `gps-exif-strip.ts` — all four scrubbers + shared TIFF core
- **`stripGpsFromTiffRegion` (103-189):** `tiffEnd > buf.length || tiffEnd-tiffStart < 8 → null` (104) also catches `tiffStart > tiffEnd`. `inBounds(abs,size) = abs >= tiffStart && abs+size <= tiffEnd` (112). `valueSize = typeSize*valueCount` (129) ≤ ~3.4e10, exact in JS Number, `inBounds`-guarded (132). IFD chain capped `MAX_IFD_CHAIN=8` + `visited` cycle-break (149-151); entries capped `MAX_IFD_ENTRIES=1024` (119,154). Inline-value path `valueAbs=entry+8` correct for `valueSize<=4` (174). `zeroGpsIfd` zeroes entries + next-IFD pointer + collapses count to 0 (133-141).
- **`stripGpsFromJpegBuffer` (212-350):** APP1 walk bounded (`segLength<2 || markerPos+2+segLength > buf.length → null`, 251); fill-byte skip bounded (241-242). Post-EOI trailer fails CLOSED (274-279). **ExtendedXMP re-verified arithmetically:** signature 35B, GUID 32B, full_length@`+36`=71, offset read@`sig.length+36`=71 (305), `headerEnd=sig.length+40`=75, data@75 (302-307); `data.length > headerEnd` guard (303) makes the u32 read in-bounds. Cross-chunk joined token test (316-320) only when per-chunk missed + ≥2 chunks. Drop-and-rebuild cursor math correct (332-349).
- **`stripGpsFromIsobmffBuffer` (369-545):** `walkChildren` depth-5; size=1 BigUInt64 `> MAX_SAFE_INTEGER → return` (385); `size<headerSize || pos+size>end → return` (391). iinf version-gated entries (414); infe v2/v3 idSize + `typeOffset+4 > infe.dataEnd` guard (425). iloc: offset/length/baseOffset sizes validated to {0,4,8} (466-468); `readSized` 8-byte MAX_SAFE_INTEGER-guarded (462); itemCount cap 4096 (480), extentCount cap 64 (501); every `pos+N > ilocBox.dataEnd` checked before read (485,490,494,504). **Extent math:** `start=baseOffset+extentOffset`, both non-negative from `readSized`; `start<0 || length<0 || start+length > buf.length → null` (521). HEIF Exif `headerOffset > length-8 → null` (527); `tiffEnd = start+4+(length-4) = start+length` — verbose but correct; the Exif-signature peek (529) reads against `buf.length` not `tiffEnd`, but it's a read-only compare and `stripGpsFromTiffRegion` re-validates `tiffEnd-tiffStart < 8 → null`, so no OOB write. constructionMethod≠0 → null (513). Fails CLOSED throughout.

### `color-detection.ts` — NCLX `parseCicpFromHeif` (217-283)
Depth-5, 1 MB scan cap (225). size=1 BigUInt64 has no explicit MAX_SAFE_INTEGER guard (236) but `size<headerSize || pos+size>buffer.length → break` (243) catches any value ≥ ~1 MB (all imprecise ones). `colr`/nclx 4 field reads gated on `dataSize>=11` (251-260); `meta` FullBox +4 gated on `dataSize>=4` (269-271). `pos=boxEnd` with `size>=headerSize>=8` → no zero-progress. Fails CLOSED.

### `icc-extractor.ts` — `extractIccProfileName` (45-127)
`icc.length<=132 → null` (49); tagCount capped 100 (61); `tagOffset+12 > iccLen → break` (64). **`desc`:** `dataOffset+12>iccLen || dataSize<12 || dataOffset+dataSize>iccLen → break` (70); `strLen=min(declaredLength,dataSize-12,1024)`, `strEnd=strStart+max(0,strLen-1)` (76-78) double-bounded (79). **`mluc`:** numRecords capped 100 (86); recordSize<12 → break (88); per-record `recOffset+12>iccLen || recOffset+12>dataOffset+dataSize → break` (93); `strStart=dataOffset+recTextOffset` (mluc offsets are tag-data-relative — correct), `strEnd>iccLen || strEnd>dataOffset+dataSize || strStart>=strEnd → continue` (103) catches a huge `recTextOffset`. `clampUtf8Bytes` iterates code points and breaks — terminates. Whole body in try/catch.

### `icc-chromaticity.ts` — `detectGamutFromIccChromaticity` (105-322)
`readS15Fixed16` returns NaN on OOB (107). `xyzToXy` `!isFinite(sum) || abs(sum)<1e-9 → null` (172). `invert3x3` `!isFinite(det) || abs(det)<1e-12 → null` (152). `readChadMatrix` size<44 + finite per-element (131-138); `readXyzTag` size<20 + sig + finite (192-198). Tag-table loop `i+12 <= tagTableEnd` where `tagTableEnd = min(132+tagCount*12, 132+MAX_TAG_TABLE_BYTES, icc.length)` (234,243); `offset+size > icc.length || size > MAX_TAG_TABLE_BYTES → continue` (247) — `offset`+`size` ≤ ~8.6e9, exact in JS Number. chad-inverse path null-safe at every hop (278-289), all four `xyzToXy` results null-checked (295). No div-by-zero / NaN escape.

### `gain-map-detection.ts` — `hasGainMap` (57-291)
`readBoxHeader` size=1 BigUInt64 (72) no MAX_SAFE_INTEGER guard but `size<headerSize || pos+size>buffer.length → null` (79) catches oversized. `parseInfe` every read bounds-checked vs `dataEnd` (103,108,119,122); item_name + URI scans bounded by `dataEnd` (127,140). `parseIinf` `parsed<entryCount && parsed<1024` (165). `parseIref` outer `parsed<1024` (191); inner-entry guard `inner+idSize+2 > innerEnd` (196) bounds `fromItemId`+`refCount`; per-ref `inner+idSize > innerEnd → break` (207); refCount loop `i<refCount && i<1024` (206). `walk` depth-5 + 1 MB; `pos=boxEnd` with `size>=8` → no zero-progress. Whole walk in try/catch → false on throw (242-248). Fails CLOSED. **DBG-C6-NC-01 dead-code note persists** (line 87 `if (p > limit) return ''` unreachable — `while (p < limit ...)` guarantees `p<=limit` on exit). Record-only, no functional impact.

---

## VERIFIED-CLEAN lifecycle / concurrency flows (re-traced this cycle)

### `image-queue.ts` — claim / cleanup / retry FSM (re-read in full)
- **Claim:** `acquireImageProcessingClaim` (193-210) `GET_LOCK(name,0)`; releases the connection on non-acquire and on throw; returns the held connection only on `acquired===1`. `releaseImageProcessingClaim` (212-220) releases in `finally`. Lock held across the whole job, released in the job's `finally` (528-530). Correct.
- **Delete-while-processing:** conditional `UPDATE … WHERE processed=false` (368-370); `affectedRows===0 → deleteImageVariants(dir, name, [])` full-dir-scan cleanup on all 3 dirs (383-387). Matches the backfill runner contract.
- **Output verification:** all 3 formats `stat().size>0` before marking processed (353-364); throws → retry. Correct fail-closed.
- **Retry / permanent-fail:** `MAX_RETRIES=3` (251,469); `MAX_CLAIM_RETRIES=10` (262); `permanentlyFailedIds` capped `MAX_PERMANENTLY_FAILED_IDS=1000` FIFO (485-497) with associated `claimRetryCounts`/`retryCounts`/`lastErrors` cleanup on eviction. `pruneRetryMaps` caps the three maps at `MAX_RETRY_MAP_SIZE=10000` FIFO (96-109). All retry timers `.unref?.()`. Bootstrap excludes `permanentlyFailedIds` via `notInArray` (609-611) + cursor-advance (606-607) so failing low-id rows can't starve later rows. The single residual: a permanently-failed id evicted from the 1000-cap set can be re-discovered by bootstrap and re-fail — bounded by retry counts, documented personal-gallery-scale design, not a tight loop. No leak, no unhandled rejection (every fire-and-forget `.then` has `.catch`; the `void (async …)()` embedding IIFE at 432 has an inner try/catch).
- **Restore quiesce:** `pause(); clear(); await onIdle()` order (724-726) — the documented deadlock-free order; clears all state maps + `permanentlyFailedIds` (727-733). Correct.

### `auth-rate-limit.ts` + `bounded-map.ts`
`BoundedMap.prune` collect-then-delete for both expiry and hard-cap eviction (98-129) — terminates, FIFO insertion-order eviction. `createWindowBoundedMap` expiry `now-lastAttempt > windowMs` (141). Account/login/password maps all bounded (`LOGIN_RATE_LIMIT_MAX_KEYS`, `PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS=5000`); rollback decrements-not-deletes to survive concurrent rollback (66-89,122-130). No unbounded growth.

### `sw-cache.ts` — `recordAndEvict` LRU (1-167)
Sort-by-timestamp ascending, evict oldest until `total<=maxBytes` (115-137). The documented best-effort property persists: when `cache.delete` returns false (browser quota evicted independently), `entries.delete` runs unconditionally (135) but `total` is NOT decremented (131-134), so a phantom-sized entry can over-evict live entries on that path. This is the recorded SW lost-update/best-effort design (AGG-C7-R7 / RC-1) and matches the shipped `sw.template.js` — NOT a new defect. Bounded, terminates, no leak.

### `migrate.js` — reconcile / baseline / post-condition (re-read 144-160, 642-719)
`getAllJournalMigrations` hashes each `.sql` file content (157). `prepareLegacyDatabaseIfNeeded` routes BOTH a fresh DB (no gallery tables) and a legacy/incomplete-log DB through the same `reconcileLegacySchema` + `baselineAllJournalMigrations` path (659-696); the `journalCovered = migrations.every(hash present)` early-return (683-687) skips reconcile when the log is complete. `baselineAllJournalMigrations` inserts ONLY missing hashes, `created_at = folderMillis` (642-657). `runMigrations` post-condition throws loud on ANY un-recorded journal hash after drizzle's `migrate()` (708-718). The non-monotonic-journal silent-skip class is caught at the moment it happens. Sound — no fail-open.

### Other FSMs (re-confirmed unchanged & clean)
- **View-count flush FSM** (`data.ts:63-202`): timer nulled on entry first (COR-R4C11-01), `isFlushing` resets in `finally`, buffer re-armed in both re-entrancy + finally paths, all DB ops `.catch`-wrapped (110-131), retry cap `VIEW_COUNT_MAX_RETRIES=3`, buffer cap 1000, retry-count map cap 500. No strand/stuck/leak.
- **Histogram worker / AbortController** (`histogram.tsx`): per-request id discrimination, both listeners removed on cleanup, `{once:true}` abort listener, `img.src=''` cancels in-flight. No leak.
- **`use-display-capability.ts`**: value-memoized snapshot (stable ref) → no React #185; `getServerSnapshot` stable constant; subscribe cleanup removes all MQ + visibility + focus listeners.
- **`blur-data-url.ts`**: 3-prefix allowlist + `MAX_BLUR_DATA_URL_LENGTH=4096` cap; rejection LRU capped 256; redacted preview (first 8 chars). Bounded.
- **`settings-hash.ts` `getColorSettingsHash`** (120-143): inflight-promise dedup; the returned promise is awaited by every caller (each wrapped in try/catch), so a `fetchHashFromDb` rejection fails through cleanly — no orphan unhandled rejection; `.finally` nulls `inflight`. Sound.

---

## Below-the-reporting-bar notes (recorded for completeness, NO fix warranted)

- **DBG8-NC-01 (record-only, == DBG-C6-NC-01):** `gain-map-detection.ts:87` `if (p > limit) return ''` in `readNullTerminatedAscii` is unreachable dead code (`while (p < limit …)` guarantees `p<=limit` on exit). Harmless.
- **DBG8-NC-02 (record-only, quality):** `isLosslessWebpByChunk` (and the inline comment at `process-image.ts:1511`) does NOT descend into `ANMF`, so an *animated lossless* WebP that also failed Tier-1 byte-scrub and hit Tier-2 would re-encode as lossy. The comment is mildly aspirational vs. the implementation, but this is the explicit SAFE default and GPS is stripped either way — zero privacy/correctness impact on a doubly-rare path. Below the bar (same disposition as the prior cycle's substring-scan note).

---

## Conclusion

No new latent bug, no regression, no fail-open, no unbounded growth, no resource leak introduced or surviving at `9c40d261`. The AGG-C7-05 WebP lossless-detection fix is correct and well-tested; the cycle's other deltas are test/doc/a11y only. Every binary parser (`gps-exif-strip` ×4 scrubbers + TIFF core, `color-detection` NCLX, `icc-extractor`, `icc-chromaticity`, `gain-map-detection`) was re-read in full this cycle and proven bounds-correct + fail-closed. The lifecycle FSMs (`image-queue` claim/cleanup/retry, view-count flush, histogram worker, sw-cache LRU, bounded-map eviction) and `migrate.js` reconcile/baseline/post-condition are sound. This surface is converged.

## References (re-traced this cycle, all correct)
- `apps/web/src/lib/process-image.ts:1498-1518` — new `isLosslessWebpByChunk`, bounds-safe + terminates + safe default
- `apps/web/src/lib/process-image.ts:1602-1608` — caller wiring; `null` byte-scrub → Tier-2 re-encode fails CLOSED (GPS dropped via keepIccProfile, not withMetadata)
- `apps/web/src/lib/gps-exif-strip.ts:103-189` — shared TIFF region scrubber, bounds-correct
- `apps/web/src/lib/gps-exif-strip.ts:212-350` — JPEG scrubber + ExtendedXMP arithmetic + post-EOI fail-closed
- `apps/web/src/lib/gps-exif-strip.ts:369-546` — ISOBMFF/HEIF/AVIF scrubber + iloc extent math, bounds-correct
- `apps/web/src/lib/gps-exif-strip.ts:554-595` — WebP RIFF scrub (prior fix), still correct
- `apps/web/src/lib/color-detection.ts:217-283` — NCLX walker, fails closed
- `apps/web/src/lib/icc-extractor.ts:45-127` — ICC name parser, bounds-correct
- `apps/web/src/lib/icc-chromaticity.ts:105-322` — chromaticity math, div-by-zero + NaN guarded
- `apps/web/src/lib/gain-map-detection.ts:57-291` — gain-map walker, fails closed; line 87 dead-code note persists
- `apps/web/src/lib/image-queue.ts:96-542,591-741` — claim/cleanup/retry/bootstrap/quiesce FSM, no strand/leak
- `apps/web/src/lib/bounded-map.ts:98-129` / `apps/web/src/lib/auth-rate-limit.ts` — bounded eviction, no unbounded growth
- `apps/web/src/lib/sw-cache.ts:95-141` — LRU evict, best-effort (documented), bounded
- `apps/web/scripts/migrate.js:144-160,642-719` — reconcile/baseline/post-condition, no fail-open
- `apps/web/src/lib/data.ts:63-202` — view-count flush FSM, no strand/stuck/leak
- `apps/web/src/lib/settings-hash.ts:120-143` — inflight dedup, no orphan unhandled rejection
