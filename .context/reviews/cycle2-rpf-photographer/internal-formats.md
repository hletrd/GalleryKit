# Cycle 2 RPF — Internal-formats review (photographer perspective)

**Date:** 2026-05-08
**Cycle:** 2/100
**Reviewer angle:** AVIF / WebP / JPEG encoder fidelity, ICC tagging, bit depth, chroma subsampling, error handling on encode failure.
**Predecessor reviews:** `.context/reviews/photographer-r3/internal-formats.md`, `.context/reviews/cycle1-rpf-photographer/_aggregate.md`.

---

## C2-INT-MED-1 — `WIDE_GAMUT_MAX_SOURCE_PIXELS = 50_000_000` is hardcoded; no admin tunable

**Severity:** MED.
**Confidence:** HIGH.
**Photographer-axis:** wide-gamut fidelity for very high-resolution sources (Hasselblad H6D 100c, Phase One IQ4 150 MP).

**File:** `apps/web/src/lib/process-image.ts:693`.

**Code:**
```ts
const WIDE_GAMUT_MAX_SOURCE_PIXELS = 50_000_000;
```

**Why it's a problem:** the cap is a fixed constant. A photographer with a Phase One IQ4 (150 MP, ~14304x10704) uploading wide-gamut TIFF triggers the WI-15 downscale path at line 699-708 because 153 MP > 50 MP. The downscale ratio is `sqrt(50/153) ≈ 0.572`, so the working size becomes ~8175x6122 (50 MP). Subsequent resize-to-derivative-sizes then runs from that smaller tmp.

For a self-hosted gallery on a 64 GB / 32 core machine, this cap is conservative; the photographer might want to push it to 80 MP or 100 MP for better large-print fidelity (the gallery's largest configured size is 4096 px wide, so the immediate visual impact is small, but the rgb16 resize starts from a smaller buffer than necessary). For an 8 GB Raspberry Pi, the cap might need to be lower.

**Failure scenario:** photographer self-hosts on a 64 GB / 32 core machine. They upload Phase One files; they want max fidelity. They have no way to raise the cap without forking the codebase.

**Fix:** add `wide_gamut_max_source_pixels` admin setting (default 50_000_000, range 10_000_000 – 200_000_000):

```diff
@@ apps/web/src/lib/gallery-config-shared.ts
 export const SETTING_KEYS = [
   …
+  'wide_gamut_max_source_pixels',
 ] as const;
 export const DEFAULTS = {
   …
+  wide_gamut_max_source_pixels: '50000000',
 } as const;
 export const VALIDATORS = {
   …
+  wide_gamut_max_source_pixels: (v: string) => {
+    const n = Number.parseInt(v, 10);
+    return Number.isFinite(n) && n >= 10_000_000 && n <= 200_000_000;
+  },
 };
```

```diff
@@ apps/web/src/lib/process-image.ts (around line 693)
-    const WIDE_GAMUT_MAX_SOURCE_PIXELS = 50_000_000;
+    const WIDE_GAMUT_MAX_SOURCE_PIXELS = wideGamutMaxSourcePixels ?? 50_000_000;
```

The admin settings UI gets a number input + help text describing memory implications.

**Risk:** raising the cap on a memory-starved host could OOM the libvips rgb16 pipeline. Mitigated by validator range and admin help text.

**Recommendation:** ship as part of plan-39.

---

## C2-INT-LOW-1 — WI-15 tmp file cleanup race window if process is SIGKILL-ed mid-upload

**Severity:** LOW.
**Confidence:** HIGH.
**Photographer-axis:** filesystem hygiene; not user-visible.

**File:** `apps/web/src/lib/process-image.ts:702, 895-900`.

**Code:**
```ts
const tmpPath = inputPath + '.wi15.tmp';
…
} finally {
    if (processingInputPath !== inputPath) {
        await fs.unlink(processingInputPath).catch(() => {});
    }
}
```

**Why it's a problem:** the `.wi15.tmp` file is only cleaned up by the `finally` block. If the process receives `SIGKILL` (Docker OOM-kill, host crash, manual `kill -9`) between the rename inside the WI-15 downscale and the finally cleanup, the `.wi15.tmp` file leaks. There's no startup sweeper that purges orphan `.wi15.tmp` files in `data/uploads/original/`.

**Failure scenario:** Docker sets a memory limit on the web container; a particularly large Phase One upload triggers OOM-kill mid-WI-15-resize; the next container start has a stale `.wi15.tmp` in `data/uploads/original/`; eventually filesystem fills with such files (rare but possible). Docker liveness probe `/api/live` doesn't sweep them.

**Fix:** add a startup sweeper in `apps/web/src/lib/upload-sweep.ts` (new) or hook into the existing maintenance task that runs on container start. Pattern: scan `data/uploads/original/` for `.wi15.tmp` extension, unlink any older than the most recent boot timestamp.

**Recommendation:** **defer.** The leak is bounded and slow. Could ship in plan-39 if time allows.

---

## C2-INT-LOW-2 — 10-bit AVIF probe runs only once per process; never re-evaluated after worker thread errors

**Severity:** LOW.
**Confidence:** MEDIUM.
**Photographer-axis:** wide-gamut fidelity if Sharp build degrades mid-process.

**File:** `apps/web/src/lib/process-image.ts:53-79`.

**Why it's a problem:** the probe (line 55-73) is a Promise singleton. The result is cached for the process lifetime. If Sharp's libheif support is partially loaded (e.g. due to an in-process patch reload, an encoded shim, or Sharp's native worker thread crash), and 10-bit encoding starts failing later, the probe never re-checks. The retry-on-error path at line 806-821 catches this **per encode** by trying 8-bit when the 10-bit try throws "bitdepth"-matching errors.

The retry catches the issue. But since the probe verdict is cached as `true`, every wide-gamut encode goes 10-bit-first → fail → 8-bit-fallback. That's wasted CPU.

**Failure scenario:** rare. Sharp's libheif crashes after the probe, all subsequent wide-gamut encodes pay the failed-10-bit-then-8-bit cost.

**Fix:** if the per-encode retry catches a `/bitdepth/i` error, optionally invalidate the probe (`_highBitdepthAvifProbePromise = null`) so the next image's probe re-runs and observes the degraded state.

**Recommendation:** **defer.** Edge case.

---

## Summary

| Severity | Count |
|---|---|
| MED | 1 |
| LOW | 2 |
