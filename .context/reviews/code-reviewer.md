# Code Review — Cycle 20 | 2026-06-27

**Agent:** code-reviewer
**HEAD at review time:** 9af705f4 (branch: master)
**Total findings:** 8 (0 CRITICAL, 0 HIGH, 2 MEDIUM, 6 LOW)

---

## Stage 1 — Cycle-19 Fix Verification

All 11 scheduled fixes verified as correctly implemented:

| ID | File | Status |
|----|------|--------|
| F1 | `lib/view-retention.ts` | PASS — `Number()` replaces `parseInt`, guarded `> 0 && isFinite` |
| F2 | `lib/gps-exif-strip.ts` | PASS — `walkAborted` flag set; null returned when both sets empty + aborted |
| A2 | `lib/search-enrichment-fields.ts` | PASS — shared const with compile-time `Extract<…,PrivacySensitiveKeys>` guard |
| CQ19-01 | `lib/og-photo-fetch.ts` | PASS — `OG_PHOTO_TOTAL_BUDGET_MS=10000`, `deadline` checked before each attempt |
| CQ19-02 | `lib/bounded-map.ts` | PASS — `entries()` and `[Symbol.iterator]` both yield `copyValue()` shallow copies |
| CQ19-03 | `components/lightbox-color-pip.tsx` | PASS — `copyColorMetadata` is a plain async function (not useCallback) per rules-of-hooks |
| CQ19-04 | `lib/color-label.ts` | PASS — pure helpers extracted; `color-details-section.tsx` re-exports for compat |
| FINDING-1 | `lib/rate-limit.ts` | PASS — `rollbackOgAttempt` implemented; rollback on syntactic-reject paths |
| MINOR-1 | `api/search/semantic/route.ts`, `api/search/similar/[id]/route.ts` | PASS — `console.error` on enrichment failure |
| D19-01 | `components/lightbox.tsx` | PASS — nav buttons use `group`/`group-focus-visible:ring-*`; action buttons use `focus-visible:ring-*` |
| D19-08 | `components/image-zoom.tsx` | PASS — `focus-visible:ring-ring` token present |

---

## Stage 2 — New Issues (Cycle 20)

### Issues

---

**[MEDIUM] CQ20-01 — `audit.ts:111`: `Number.parseInt` for `AUDIT_LOG_RETENTION_DAYS` (same class as F1)**

File: `apps/web/src/lib/audit.ts:111`
Confidence: HIGH

Issue: `Number.parseInt(process.env.AUDIT_LOG_RETENTION_DAYS ?? '', 10)` — the same pattern fixed for `VIEW_RETENTION_DAYS` in R19C19 (F1) is still present here. `parseInt('1e3', 10)` returns `1`, not `1000`. An operator setting `AUDIT_LOG_RETENTION_DAYS=1e3` (intending 1000 days) gets a 1-day retention window; every hourly GC sweep (`image-queue.ts:811,830`) would delete all audit log rows older than 24 hours, silently destroying the audit trail. The `> 0` guard cannot save it — `1` is positive.

Fix:
```typescript
// Line 111 — replace:
const retentionDays = Number.parseInt(process.env.AUDIT_LOG_RETENTION_DAYS ?? '', 10);
// with:
const retentionDays = Number(process.env.AUDIT_LOG_RETENTION_DAYS ?? '');
```
The `Number.isFinite(retentionDays) && retentionDays > 0` guard below already handles `NaN`/`Infinity`/`0`, so no other change is needed.

---

**[MEDIUM] CQ20-02 — `process-image.ts:330`: `Number.parseInt` for `IMAGE_MAX_INPUT_PIXELS`**

File: `apps/web/src/lib/process-image.ts:330`
Confidence: HIGH

Issue: `Number.parseInt(process.env.IMAGE_MAX_INPUT_PIXELS ?? '', 10)` — same pattern. `parseInt('2e8', 10)` returns `2`. If an operator sets `IMAGE_MAX_INPUT_PIXELS=2e8` (attempting 200 million pixels), `maxInputPixels` becomes `2`. Every Sharp constructor call uses `limitInputPixels: maxInputPixels`, so Sharp would reject ALL images as exceeding the 2-pixel decompression bomb cap, breaking every upload. The module-level constant is evaluated once at startup; no recovery without restart.

Fix:
```typescript
// Line 330 — replace:
const envMaxInputPixels = Number.parseInt(process.env.IMAGE_MAX_INPUT_PIXELS ?? '', 10);
// with:
const envMaxInputPixels = Number(process.env.IMAGE_MAX_INPUT_PIXELS ?? '');
```

Same fix needed at line 339 for `IMAGE_MAX_INPUT_PIXELS_TOPIC` (see CQ20-03).

---

**[LOW] CQ20-03 — `process-image.ts:339`: `Number.parseInt` for `IMAGE_MAX_INPUT_PIXELS_TOPIC`**

File: `apps/web/src/lib/process-image.ts:339`
Confidence: HIGH

Issue: Same class as CQ20-02. `parseInt('6.4e7', 10)` → `6`, not `64000000`. An operator writing `IMAGE_MAX_INPUT_PIXELS_TOPIC=6.4e7` would see all topic image uploads fail.

Fix: Replace `Number.parseInt(…, 10)` with `Number(…)` at line 339.

---

**[LOW] CQ20-04 — `process-image.ts:45`: `Number.parseInt` for `SHARP_CONCURRENCY`**

File: `apps/web/src/lib/process-image.ts:45`
Confidence: HIGH

Issue: `parseInt('1e2', 10)` → `1`. An operator setting `SHARP_CONCURRENCY=1e2` (intending 100 threads) would silently run with 1 libvips thread instead. Performance-only impact; no correctness or security issue.

Fix: Replace `Number.parseInt(…, 10)` with `Number(…)` at line 45.

---

**[LOW] CQ20-05 — `images.ts:796`: `Number.parseInt` for `IMAGE_CLEANUP_CONCURRENCY`**

File: `apps/web/src/app/actions/images.ts:796`
Confidence: HIGH

Issue: `Math.max(1, Number.parseInt(env, 10) || 5)`. If `IMAGE_CLEANUP_CONCURRENCY=1e3`, `parseInt` returns `1` (truthy), so the `|| 5` fallback is skipped and cleanup runs at concurrency 1 instead of 1000. Silent performance degradation; `IMAGE_CLEANUP_CONCURRENCY` is not documented in CLAUDE.md but is referenced in code comments.

Fix: Replace `Number.parseInt(…, 10)` with `Number(…)` at line 796.

---

**[LOW] CQ20-06 — `gps-exif-strip.ts:461-466`: `walkAborted` only checked when BOTH item sets are empty**

File: `apps/web/src/lib/gps-exif-strip.ts:461-466`
Confidence: MEDIUM

Issue: The R19C19 F2 fix correctly handles the case where `walkAborted=true` AND both `exifItemIds` and `xmpItemIds` are empty (the walk ended before finding any items). However, if the inner `walkChildren` at depth 2 (iinf/infe processing) aborts AFTER registering some non-GPS Exif item IDs but before reaching a GPS-bearing Exif item, the code skips the `walkAborted` null check (because `exifItemIds.size > 0`) and proceeds to iloc parsing with an incomplete item set. In the crafted-file scenario: (1) a non-GPS Exif item is in the first valid `infe` entries, (2) a malformed `infe` box truncates the walk, (3) the GPS Exif item was after the malformed box — the GPS-bearing item is never discovered, the iloc-level strip finds nothing to strip for the GPS item, and the function returns `{ stripped: false }` (GPS survives).

This requires a specially crafted HEIF with multiple Exif items in a specific order. Standard camera-produced HEIFs have a single Exif item (all EXIF data, including GPS, in one TIFF blob), so this is an adversarial-input scenario, not a real-world one.

Fix: Move the `walkAborted` check before the per-set size check so ANY aborted walk returns null:
```typescript
// Lines 461-469 — replace:
if (exifItemIds.size === 0 && xmpItemIds.size === 0) {
    if (walkAborted) return null;
    return { buffer: input, stripped: false };
}
if (!ilocBox) return null;

// with:
if (walkAborted) return null;   // partial discovery may have missed GPS items
if (exifItemIds.size === 0 && xmpItemIds.size === 0) {
    return { buffer: input, stripped: false };
}
if (!ilocBox) return null;
```

This trades a false positive (re-encoding a malformed-but-GPS-free file unnecessarily) for a false negative (keeping GPS on a malformed file). The re-encode is conservative and correct.

---

**[LOW] CQ20-07 — `bounded-map.ts:50-52`: `.data` getter returns live `Map` reference inconsistent with `entries()`/`get()` copy semantics**

File: `apps/web/src/lib/bounded-map.ts:50-52`
Confidence: HIGH

Issue: The `.data` getter returns `this.map` (the raw internal `Map`). R19C19 CQ19-02 fixed `entries()` and `get()` to return shallow copies so external callers cannot corrupt internal state. However, `.data` is documented as "Underlying Map reference for direct reads (e.g., `.get()`, `.has()`)" — a future caller following that suggestion and calling `.data.get(key)` would receive a live object reference, not a copy, contradicting the isolation guarantee. Currently no call site in `src/` uses `.data.get()` or `.data.set()`, so this is a latent hazard only.

Fix: Either remove the `.data` getter entirely (breaking change only if tests use it — check `__tests__/bounded-map.test.ts`) or rename it to `dangerousInternalMap` and update its JSDoc to warn explicitly against mutation.

---

**[LOW] CQ20-08 — `rate-limit.ts:144`: `Number.parseInt` for `TRUSTED_PROXY_HOPS`**

File: `apps/web/src/lib/rate-limit.ts:144`
Confidence: HIGH

Issue: `parseInt('1e2', 10)` → `1` hop instead of 100. If the deployment has `TRUSTED_PROXY_HOPS=1e2` (highly unlikely in practice — nobody runs 100 proxy hops), client IP extraction would select the wrong X-Forwarded-For segment, potentially allowing IP spoofing against rate limits.

Fix: Replace `Number.parseInt(value, 10)` with `Number(value)` at line 144. The `Number.isInteger(parsed) && parsed >= 1` guard below correctly handles floats.

---

## Summary by File

All `Number.parseInt(process.env.*, 10)` instances in the codebase after R19C19 fixed `view-retention.ts`:

| File | Line | Env Var | Impact |
|------|------|---------|--------|
| `lib/audit.ts` | 111 | `AUDIT_LOG_RETENTION_DAYS` | Audit trail purged to 1 day — data loss |
| `lib/process-image.ts` | 330 | `IMAGE_MAX_INPUT_PIXELS` | All uploads fail bomb check — service broken |
| `lib/process-image.ts` | 339 | `IMAGE_MAX_INPUT_PIXELS_TOPIC` | All topic uploads fail — service broken |
| `lib/process-image.ts` | 45 | `SHARP_CONCURRENCY` | Under-threaded encoding — performance only |
| `actions/images.ts` | 796 | `IMAGE_CLEANUP_CONCURRENCY` | Slow cleanup — performance only |
| `lib/rate-limit.ts` | 144 | `TRUSTED_PROXY_HOPS` | Wrong IP selection — security (theoretical) |

---

## Open Questions (low-confidence findings — surfaced, not blocking)

None identified. All findings above have HIGH confidence in the mechanism; severity assessments are where uncertainty lives (noted per-finding).

---

## Positive Observations

- **Cycle-19 fix quality is high.** All 11 scheduled fixes are correctly implemented. The `walkAborted` design (F2), the privacy type-guard in `search-enrichment-fields.ts` (A2), and the `OG_PHOTO_TOTAL_BUDGET_MS` deadline logic (CQ19-01) are correct and well-commented.
- **Rate-limit rollback completeness.** The Pattern 2 rollback sites in `og/photo/[id]/route.tsx`, `search/semantic/route.ts`, and `search/similar/[id]/route.ts` are all correctly placed: rollback on pre-work gate failures, charged on post-work paths. The `semanticMode !== 'production'` gate in the similar route correctly rolls back since no expensive embedding scan has occurred yet.
- **`bounded-map.ts` entries/iterator consistency.** CQ19-02 was correctly applied to both `entries()` and `[Symbol.iterator]()` so any `for...of` on a `BoundedMap` gets copied values.
- **`color-label.ts` extraction (CQ19-04).** Pure functions isolated to `lib/` with proper re-export from `color-details-section.tsx` for backward compatibility. Clean separation.
- **CQ19-03 revert rationale documented.** The JSDoc comment in `lightbox-color-pip.tsx:89-91` explains exactly WHY `useCallback` was reverted (conditional early return above violates rules-of-hooks), preventing future well-intentioned "cleanup" from reintroducing the violation.
- **`session.ts:128`** `parseInt(timestamp, 10)` is safe in practice — session token timestamps are server-generated decimal integers, never written in scientific notation, and any tampered token fails HMAC before reaching the parseInt.

---

## Recommendation

**COMMENT** — No CRITICAL or HIGH issues at HIGH confidence. The 2 MEDIUM findings (CQ20-01, CQ20-02) are operational footguns triggered only by scientific-notation env var values; they are the same class as the F1 finding fixed in R19C19 and should be fixed in the next cycle using `Number()` in place of `Number.parseInt(..., 10)` across all 6 affected sites. No blocking defects in the cycle-19 fixes.
