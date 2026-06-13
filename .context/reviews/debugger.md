# Cycle-9 Debugger Review

**HEAD:** `0ce84b1b` (working tree CLEAN of source changes — only `.context/reviews/*.md` are dirty, from concurrent reviewer agents; verified no source perturbation via `git status`). Prior debugger review ran at `9c40d261`.

**NEW confirmed latent bugs: 0. NEW latent risks: 0.**

I did NOT trust the cycle-8 summary. I confirmed the only two commits since the prior debugger HEAD (`71ab0f41`, `aa8a6f8a`) are **test-only + doc-only** (`git show` verified — no production `.ts`/`.js` delta), and that every binary parser and lifecycle FSM the prompt names is **byte-identical** to the prior cycle's full read (`git diff --stat 9c40d261 0ce84b1b` on all 11 named files is empty). Rather than re-paste the cycle-8 parser walkthrough verbatim, I spent this cycle widening to ~15 bug-prone surfaces the prior cycles enumerated *less* deeply — date/time, numeric-parse NaN propagation, pagination cursor decode, the upload-tracker FSM, the DB-backed rate-limit decrement transaction, X-Forwarded-For client-IP selection, token verification, and the newest production fixes. All converged.

---

## Verification of the only deltas since the prior debugger review

| Commit | Change | Verdict |
|---|---|---|
| `71ab0f41` | `base56.test.ts` +43 lines: 500k-sample char-frequency distribution test (max/min ratio < 1.20) for `generateBase56` rejection sampling (AGG-C8-01) | **TEST-ONLY, CORRECT.** Asserts every char appears + ratio bound; commit message documents RED-on-revert (1.3124 > 1.2 when the `while (randomValue >= 224)` loop is removed). No production code touched. Threshold 1.20 sits between correct ~1.04-1.06 and naive ~1.30 → non-flaky. |
| `aa8a6f8a` | `CLAUDE.md:505` adds `app/[locale]/(public)/` to the documented touch-target `SCAN_ROOTS` (AGG-C8-02) | **DOC-ONLY.** Safe-direction; out of my lane. |

`git diff --stat 9c40d261 0ce84b1b` over `gps-exif-strip.ts`, `color-detection.ts`, `icc-extractor.ts`, `icc-chromaticity.ts`, `gain-map-detection.ts`, `image-queue.ts`, `bounded-map.ts`, `auth-rate-limit.ts`, `sw-cache.ts`, `migrate.js`, `process-image.ts` → **empty**. The cycle-8 full bounds/fail-closed verification of these surfaces (debugger.md prior revision) therefore still holds at this HEAD without re-derivation; I re-confirmed it is not stale by diff, not by trust.

---

## Surfaces traced THIS cycle (widened beyond the converged parser/FSM core; all clean)

### Numeric-parse / NaN-propagation surface (`Number()` / `parseInt` without obvious guards)
- **`exif-datetime.ts:33-58` `parseStoredExifDateTime`** — `EXIF_DATETIME_PATTERN` (`\d{4}-\d{2}-…`) guarantees each capture group is parseable digits, so the six `Number()` calls (39-44) **cannot** produce NaN. `isValidExifDateTimeParts` (3-31) range-checks each field AND round-trips through `Date.UTC` + `getUTC*` equality, correctly rejecting Feb-30 / month-13 / overflow normalization. Render path forces `timeZone: 'UTC'` (67,77) so stored local-component values round-trip consistently. **Clean.**
- **`og-photo-fetch.ts:57`** — `parseInt(contentLength, 10) > OG_PHOTO_MAX_BYTES`: a NaN (non-numeric `Content-Length`) yields `NaN > N === false`, which safely falls through to the post-buffer `photoBuffer.length > MAX` reject (59). No bypass. Timeout/throw → `null` (caller tries next size). **Clean.**
- **`gallery-config-shared.ts:233-311`** — `normalizeConfiguredImageSizes` / `parseImageSizes` / `parseSlideshowInterval` all gate with `Number.isInteger` (rejects NaN, fractions) + explicit `>0`/`≤10000` / window bounds + `MAX_IMAGE_SIZE_COUNT`. Empty-segment guard at 237. **Clean.**
- **`image-types.ts:118-132` `formatShutterSpeed`** — `Number.isFinite` guard (121) returns the raw string on NaN; `Math.round(1/val)` divisor is non-zero because `val < 1 && val > 0` (122) excludes `val ≥ 1`; negative `val` falls through to the harmless `${value}s` display branch. No div-by-zero, no NaN escape. **Clean.**
- **`data.ts:1350-1382` `getImagesForSmartCollection`** — the documented `Number(...) → NaN → 0` cursor-coercion bug (R4C5 COR-R4C5-01) is closed: the `Number(offsetOrCursor)` offset path (1374) runs **only** when `normalizedCursor` is null; the keyset path takes the cursor branch and never coerces. `normalizedPageSize = min(max(pageSize,1), LIMIT_PLUS_ONE)` bounded. **Clean.**

### Date/time handling
- **`feed-conditional.ts:15-42` `isFeedNotModified`** — `Date.parse(malformed)` → NaN → `Number.isFinite` guard (26) returns false (visitor gets body, fail-safe); `new Date(invalid).getTime()` → NaN → guarded (34) (the try/catch is belt-and-braces; `new Date()` doesn't throw). Second-precision floor compare (39-41) per RFC 7232. **Clean.**
- **`mysql-datetime.ts:19-23` `toMySqlDateTime`** — server-local-component literal, `pad2` covers all fields. Traced its only caller: `image-queue.ts:512` writes `failed_at` (audit column). **Verified NO cross-contamination** with the UTC `parseStoredExifDateTime` read path — `failed_at` is never read through the EXIF formatter; the two date conventions live on disjoint columns. **Clean.**
- **`analytics-data.ts:13-19` `windowStart`** — `setDate(getDate() - days)` correctly underflows across month/year boundaries in JS; `'all'` → null → unbounded `WHERE bot=false`. `Number(r.viewCount)` over a SQL `COUNT()` is always a finite integer. **Clean.**

### Lifecycle / concurrency FSMs (newly traced this cycle)
- **`upload-tracker-state.ts:24-79`** — `pruneUploadTracker` collect-then-delete for both expiry (2× window grace, intentionally more lenient than the 1× window-reset to protect in-flight large batches) and hard-cap (`UPLOAD_TRACKER_MAX_KEYS=2000`, FIFO by insertion order). `hasActiveUploadClaims` prunes then resets-if-expired before reading `count/bytes`. Bounded, terminates, no leak. (The hard-cap evicts by insertion order, not `windowStart`-LRU, so a long-idle-but-recently-touched key could outlive an older active one — same best-effort FIFO design as every other bounded map in the repo; **not a defect**.)
- **`rate-limit.ts` (whole file)** — all five in-memory buckets (`og`/`share`/`checkout`/`semantic`/`search`) use the identical pre-increment-then-read pattern: `resetAt <= now` re-arms a fresh window, else `count++`, then `(get()?.count ?? 0) > MAX`. Rollback helpers decrement-or-delete (never go negative). DB-backed path: `getRateLimitBucketStart` floors to window boundary (integer-sec math, safe); `incrementRateLimit` is `INSERT … ON DUPLICATE KEY UPDATE count = count+1` (atomic upsert); **`decrementRateLimit` wraps `GREATEST(count-1,0)` + the zero-row DELETE in a single transaction** (469-490) so a concurrent increment between UPDATE and DELETE is not lost — correct. `purgeOldBuckets` deletes `bucketStart < cutoffSec`. No unbounded growth, no lost-update, no negative counter.
- **`rate-limit.ts:161-204` `getClientIp`** — X-Forwarded-For parsing: filters to `validParts` (drops un-parseable tokens uniformly), then `clientIndex = validParts.length - hopCount - 1`; returns the slot only when `clientIndex >= 0` (no untrusted slot ⇒ falls through to X-Real-IP ⇒ `'unknown'`). The reverse-proxy-appended real-peer IP is always a valid IP, so it is always counted in the suffix — the index math is consistent regardless of attacker-injected garbage tokens. Anything beyond the operator-configured `TRUSTED_PROXY_HOPS` suffix being attacker-controllable is the **documented, SEC-reviewed trusted-hop contract**, not a bug. `'unknown'`-bucket lockout warning gated + once-only. **Clean.**

### Token / auth verification
- **`admin-tokens.ts:64-166`** — `tokenHashesEqual` pre-checks type + length + hex-charset before `timingSafeEqual` (try/catch → false). `verifyToken` short-circuits on `isWellFormedToken`, looks up by `presentedHash` (plaintext never reaches a query param → no plaintext in slow-query logs), re-confirms with the constant-time compare (belt-and-braces over the exact DB equality), enforces `expires_at.getTime() <= Date.now()`, fails closed on a missing table (try/catch → null), best-effort `last_used_at` touch is fire-and-forget with `.catch`. `parseScopes` JSON.parse in try/catch → `[]`. No timing leak, no fail-open, no unhandled rejection. **Clean.**

### Newest production fixes (post-date the prior cycle's deep read; re-verified)
- **`actions/images.ts:900-916` `isTriState` guard (commit `652add51`)** — narrows `mode ∈ {leave,clear,set}` and requires a string `value` for `'set'` BEFORE any `.mode` read on `topic`/`titlePrefix`/`description`/`licenseTier`; malformed Server-Action payload → clean `invalidInput` instead of an unhandled TypeError → framework 500. Four malformed-payload regression tests. **Correct.**
- **`serve-upload.ts:50-269`** — re-verified end-to-end: TOCTOU closed (stream from realpath-resolved path, not the validated path); ETag math `W/"v{PIPELINE}-{mtimeMs.toFixed(0)}-{size}-{hash}"` overflow-free; the un-awaited `servingHashInflight` IIFE provably **cannot reject** (both branches return a value) so no orphan unhandled rejection even on a DB-down cold start (falls to FALLBACK_HASH); stale-while-revalidate never blocks once warm; `fileStream.destroy()` in the catch closes the FD on any post-open throw. **Clean.**

---

## Below-the-bar / record-only (UNCHANGED, do NOT re-escalate)

- **DBG8-NC-01 / DBG-C6-NC-01** — `gain-map-detection.ts:87` `if (p > limit) return ''` is unreachable dead code (`while (p < limit …)` guarantees `p <= limit` on exit). Harmless. (Source byte-identical to prior read.)
- **DBG8-NC-02** — `isLosslessWebpByChunk` (`process-image.ts:1498-1518`) does not descend into `ANMF`; an *animated lossless* WebP reaching the doubly-rare Tier-2 GPS re-encode would re-encode lossy. Explicit SAFE default; **GPS is stripped either way** → zero privacy/correctness impact. (Source byte-identical to prior read.)

---

## Conclusion

**Zero new genuine findings.** No new latent bug, no latent risk, no regression, no fail-open, no unbounded growth, no resource leak at `0ce84b1b`. The only source-affecting deltas since the prior debugger review are a test addition and a doc line, both verified correct/safe. The named binary parsers (`gps-exif-strip` ×4 + TIFF core, `color-detection` NCLX, `icc-extractor`, `icc-chromaticity`, `gain-map-detection`) and lifecycle FSMs (`image-queue` claim/cleanup/retry/bootstrap/quiesce, view-count flush, histogram worker, `sw-cache` LRU, bounded-map/auth-rate-limit eviction, `migrate.js` reconcile/baseline/post-condition) are byte-identical to the prior cycle's full verification (confirmed by `git diff --stat`, not trusted), so their proven bounds-correctness + fail-closed behavior carries forward. This cycle additionally cleared ~15 secondary surfaces (date/time, NaN-parse, pagination cursor, upload-tracker, DB-backed rate-limit transaction, client-IP selection, token verification, newest fixes) with no defect. The failure-mode / boundary-arithmetic surface I own is **converged**.

## References (traced this cycle, all correct)
- `apps/web/src/lib/exif-datetime.ts:1-79` — regex-gated EXIF datetime parse, no NaN, UTC round-trip validation
- `apps/web/src/lib/og-photo-fetch.ts:44-86` — `NaN > MAX === false` safe fall-through + post-buffer cap
- `apps/web/src/lib/gallery-config-shared.ts:233-311` — `Number.isInteger`/`isFinite`-gated size + interval parsing
- `apps/web/src/lib/image-types.ts:118-132` — `formatShutterSpeed`, no div-by-zero / NaN escape
- `apps/web/src/lib/data.ts:1350-1382` — smart-collection cursor pagination, NaN→0 path is offset-only
- `apps/web/src/lib/feed-conditional.ts:15-42` — If-Modified-Since, fail-safe to body on malformed/NaN
- `apps/web/src/lib/mysql-datetime.ts:19-23` + `image-queue.ts:512` — local-component DATETIME, no EXIF-read cross-contamination
- `apps/web/src/lib/analytics-data.ts:13-86` — window math + COUNT() always-finite
- `apps/web/src/lib/upload-tracker-state.ts:24-79` — bounded FIFO eviction, 2× prune grace, no leak
- `apps/web/src/lib/rate-limit.ts:124-500` — IP selection, 5 in-memory buckets, transactional DB decrement, no lost-update/negative/unbounded-growth
- `apps/web/src/lib/admin-tokens.ts:64-166` — constant-time token verify, fail-closed, no timing leak
- `apps/web/src/app/actions/images.ts:900-916` — `isTriState` shape guard (652add51), no 500 on malformed payload
- `apps/web/src/lib/serve-upload.ts:50-269` — TOCTOU-safe stream + ETag + non-rejecting inflight hash
- `git diff --stat 9c40d261 0ce84b1b` on the 11 named parser/FSM files → empty (prior full verification not stale)
