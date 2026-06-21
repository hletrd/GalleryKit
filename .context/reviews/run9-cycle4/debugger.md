# Debugger Report — Run-9 Cycle-4 (HEAD `094842a4`)

**Date:** 2026-06-21
**Scope:** Latent-bug hunt in stateful/parsing/boundary code NOT exhaustively examined in prior cycles.
**Modules examined (9):** `icc-extractor.ts`, `icc-chromaticity.ts`, `gain-map-detection.ts`, `settings-hash.ts`, `view-retention.ts`, `auth-rate-limit.ts`, `sw-cache.ts`, `csv-escape.ts`, `og-sanitize.ts`

## Verdict: ZERO new defects — convergence

All nine modules examined are BENIGN. Detailed findings below.

---

## Module-by-module analysis

### 1. `icc-extractor.ts` — `desc` (ICC v2) string length

**Candidate concern (`:76-80`):**
```ts
const strLen = Math.min(declaredLength, dataSize - 12, 1024);
const strStart = dataOffset + 12;
const strEnd = strStart + Math.max(0, strLen - 1);
if (strEnd > iccLen || strStart >= strEnd) break;
return cleanString(icc.subarray(strStart, strEnd).toString('ascii'));
```
The `- 1` trims one byte to avoid reading the ICC `desc` v2 null terminator (which is included in `declaredLength`). `cleanString` then calls `.replace(/\0/g, '')` to strip any residual nulls. The `strStart >= strEnd` guard prevents a zero-length slice. Not a bug.

**Verdict: BENIGN.**

---

### 2. `icc-extractor.ts` — `mluc` record offset field (`:99-101`)

**Candidate concern:** ICC `mluc` record header is `language(2) + country(2) + length(4) + offset(4)`. Reading `recOffset + 4` for the length field and `recOffset + 8` for the offset field is exactly correct per ICC.1:2010 §10.13. The text-offset stored in the record is relative to the start of the tag data element (`dataOffset` in absolute terms) — `strStart = dataOffset + recTextOffset` is the correct base.

**Candidate concern — `recordSize` × `recordIndex` overflow:** `recordSize` is a raw `UInt32BE` read (max `0xFFFFFFFF = 4294967295`), multiplied by `recordIndex` (0..99). At `recordIndex = 2`, the product is `8589934610`, still well within JS safe-integer range (`2^53`). Even at `recordIndex = 99` and `recordSize = 4294967295`, the product is `~4.25e11`, still a safe integer. The bounds check `recOffset + 12 > iccLen` fires on the second (or first) record with any inflated `recordSize` since `iccLen` is a real Node.js `Buffer` length (well under `2^31` in practice). Verified by simulation: at `recordSize = 4294967295`, `recordIndex = 1` yields `recOffset = 4294967315`, which exceeds any real `iccLen` immediately.

**Verdict: BENIGN.**

---

### 3. `gain-map-detection.ts` — `readNullTerminatedAscii` dead branch (`:83-88`)

**Candidate concern:**
```ts
function readNullTerminatedAscii(start: number, end: number): string {
    const limit = Math.min(end, buffer.length);
    let p = start;
    while (p < limit && buffer[p] !== 0) p++;
    if (p > limit) return '';   // <-- dead branch
    return buffer.toString('ascii', start, p);
}
```
After the `while (p < limit && ...)` loop, `p` is at most `limit` — the condition `p < limit` prevents `p` from ever exceeding `limit`. So `if (p > limit)` is unreachable. The function returns the correct slice either way: if no null terminator was found, `p === limit` and `buffer.toString('ascii', start, limit)` returns the full range, which is the correct fallback. The dead branch is cosmetically misleading but causes no crash or data corruption.

**Verdict: BENIGN (dead branch only; behaviour is correct in all reachable paths).**

---

### 4. `gain-map-detection.ts` — `parseIinf` version/entry-count (`:150-163`)

**Candidate concern:** version 0 reads `entry_count` as `UInt16BE` (2 bytes); version ≥ 1 reads it as `UInt32BE` (4 bytes). ISO 14496-12 specifies exactly this — `iinf` FullBox v0 uses a 16-bit count, v1 uses a 32-bit count. The `parsed < 1024` hard cap prevents unbounded iteration regardless of the declared count.

**Verdict: BENIGN.**

---

### 5. `icc-chromaticity.ts` — `invert3x3` near-singular guard (`:152`)

**Candidate concern:** threshold `Math.abs(det) < 1e-12`. ICC `chad` (Bradford) matrices have entries near 1.0 and determinants near 1.0; a degenerate matrix would have to be near-zero, which is physically impossible for a valid chromatic adaptation transform. The `1e-12` threshold is conservative and correct.

**Candidate concern — `readS15Fixed16` at offset 0 (`:107`):** `if (offset + 4 > buf.length) return NaN;` correctly handles the boundary when offset is 0 and `buf.length` is exactly 4 (condition is `4 > 4 = false`; read proceeds).

**Candidate concern — `bestDistance` starting at `Infinity` (`:297-309`):** If all six presets produce a `worst` that is `Infinity` (which would require NaN from chromaticity, caught by `xyzToXy` returning `null` on line 295), the early `null` return prevents the loop. So `bestDistance` can remain `Infinity` only if the loop runs zero iterations (impossible — `PRESETS` has six entries) or if `chromaDistance` returns `NaN`/`Infinity`. `chromaDistance` uses subtraction and `Math.sqrt` on finite numbers (guaranteed by the `xyzToXy` non-null guard) so it always returns a finite non-negative number. `bestMatch` will be set on the first iteration.

**Verdict: BENIGN.**

---

### 6. `settings-hash.ts` — inflight promise deduplication (`:148-159`)

**Candidate concern:** multiple concurrent callers during the 5-second TTL gap all return the same `inflight` promise. When the promise resolves, `cache.fetchedAt` is set to `Date.now()` at resolution time — not the individual callers' arrival times. This is intentional and correct: all callers get the same hash value and the cache is populated for the next 5 seconds.

**Candidate concern — stale cache across module reloads:** `cache` and `inflight` are module-level variables. In the single-process Docker topology this is expected; in a future multi-process deployment the comment documents acceptable per-process skew.

**Verdict: BENIGN.**

---

### 7. `view-retention.ts` — `Number.parseInt` on float env var (`:43-44`)

**Candidate concern:**
```ts
const retentionDays = Number.parseInt(process.env.VIEW_RETENTION_DAYS ?? '', 10);
return Number.isFinite(retentionDays) && retentionDays > 0
    ? retentionDays * 24 * 60 * 60 * 1000
    : DEFAULT_VIEW_RETENTION_MS;
```
`parseInt('30.5', 10)` = 30 (truncation). The guard `retentionDays > 0` is satisfied; the result is a valid positive integer of days. Non-numeric inputs (`parseInt('abc', 10)` = `NaN`) fall through to `DEFAULT_VIEW_RETENTION_MS` correctly. The non-finite guard covers `Infinity` and `NaN`. The negative/zero guard prevents a future-cutoff sweep. Mirrors the documented R4C6 COR-R4C6-10 pattern.

**Verdict: BENIGN.**

---

### 8. `auth-rate-limit.ts` — `getLoginRateLimitEntry` in-place mutation (`:21-29`)

**Candidate concern:**
```ts
export function getLoginRateLimitEntry(ip: string, now: number): WindowEntry {
    const entry = loginRateLimit.get(ip) ?? { count: 0, lastAttempt: 0 };
    if (now - entry.lastAttempt > LOGIN_WINDOW_MS) {
        entry.count = 0;
    }
    return entry;
}
```
When the key exists in the BoundedMap, `loginRateLimit.get(ip)` returns the STORED object reference. The `entry.count = 0` reset mutates the stored object in place — without calling `.set()`. The Map now holds the reset count implicitly through the shared reference. This is safe in Node.js (single-threaded event loop; no preemptive interleaving) and all callers (`recordFailedLoginAttempt`) immediately call `loginRateLimit.set(ip, entry)` afterward, making the implicit mutation and the explicit write consistent. No caller reads the entry and returns early without writing it back in the rate-limit-relevant path.

**Verdict: BENIGN (single-threaded; all callers follow the read-mutate-write pattern).**

---

### 9. `sw-cache.ts` — LRU eviction deletes newly-added entry (`:126-145`)

**Candidate concern:** the eviction loop walks ALL entries (including the just-inserted one at the tail). If a single entry exceeds `maxBytes`, the new entry itself will eventually be evicted. The comment explicitly documents this: "if we absolutely must... we do so anyway." After eviction, `entries.delete(entry.url)` removes it from the metadata map and `meta.setAll(entries)` persists the cleaned state. Both the cache store and metadata map are consistent. Correct by design.

**Candidate concern — `deleted` guard (`:139`):** `if (deleted)` before adjusting `total` and `evicted` prevents overcounting when browser quota eviction has already removed an entry independently of the metadata map. Correct.

**Verdict: BENIGN.**

---

### 10. `csv-escape.ts` and `og-sanitize.ts` — regex correctness

**`UNICODE_FORMAT_CHARS_G` (csv-escape.ts `:7`):** constructed as `new RegExp(UNICODE_FORMAT_CHARS.source, 'g')` — derived from the canonical constant in `validation.ts`, not hand-copied, so the character set cannot drift. Global flag added safely for `.replace()` (not `.test()`). Correct.

**`OG_C0_CONTROL_CHARS` (og-sanitize.ts `:25`):** `[\x00-\x08\x0B\x0C\x0E-\x1F]` correctly excludes `\x09` (tab), `\x0A` (LF), `\x0D` (CR) which Satori may need for basic text layout. Global flag present. Correct.

**`sanitizeForOg` (og-sanitize.ts `:28-30`):** `stripUnicodeFormatting(value) ?? ''` guards against a null return from `stripUnicodeFormatting` before the C0 `.replace()`. Correct.

**Verdict: BENIGN.**

---

## Summary

| Module | Candidate concern(s) | Verdict |
|---|---|---|
| `icc-extractor.ts` | `desc` `-1` trim; `mluc` record offset base; `recordSize`×`recordIndex` overflow | BENIGN |
| `icc-chromaticity.ts` | `invert3x3` threshold; `readS15Fixed16` offset 0; `bestDistance` init | BENIGN |
| `gain-map-detection.ts` | `readNullTerminatedAscii` dead `p > limit` branch; `parseIinf` version/count | BENIGN |
| `settings-hash.ts` | inflight deduplication; stale cache | BENIGN |
| `view-retention.ts` | `parseInt` float truncation; non-finite guard | BENIGN |
| `auth-rate-limit.ts` | `getLoginRateLimitEntry` in-place mutation | BENIGN |
| `sw-cache.ts` | new-entry self-eviction; `deleted` guard | BENIGN |
| `csv-escape.ts` | `UNICODE_FORMAT_CHARS_G` derivation | BENIGN |
| `og-sanitize.ts` | `OG_C0_CONTROL_CHARS` range; null guard | BENIGN |

**New actionable defects: 0. Convergence confirmed.**

The prior 14-module benign table from cycles 1-3 (color-detection, gps-exif-strip, validation, upload-tracker-state, image-queue pruneRetryMaps, and the cross-agent consensus findings) continues to hold. No new finding meets the HIGH BAR threshold (genuine crash, infinite loop, data corruption, regex catastrophic backtracking, integer/boundary error, or unhandled rejection that actually fires).
