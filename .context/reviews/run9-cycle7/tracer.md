# Tracer Report — Run-9 Cycle-7 (HEAD feb63faa)

## Trace Report

---

### FLOW 1 (SPECIAL FOCUS #3): LR publish enqueue vs. 6-settings gate

#### Observation

The LR publish route (`apps/web/src/app/api/admin/lr/upload/route.ts`) calls
`enqueueImageProcessing` at line 420. The queue handler reads 6 admin-tunable
settings from optional job fields (lines 326–335) and falls through to a
config-load gate at line 336 only when `!quality && !imageSizes`. The browser
upload path (images.ts:440) was fixed by CR-R9C6-01 to include all 6 fields.
The question is whether the LR path does the same, or whether it supplies
`quality`+`imageSizes` but omits the 6, causing the gate to be skipped and the
6 to silently fall to their `?? false` / `undefined` defaults.

#### Framing

Does the LR enqueue at route.ts:420 supply the 6 settings
(`forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`,
`wideGamutMaxSourcePixels`, `autoAltTextEnabled`)? If not, and it also supplies
`quality`, the gate at image-queue.ts:336 is never entered, so the 6 fall to
process-image defaults regardless of admin config — the same defect as
CR-R9C6-01 on the browser path, now on the LR path.

#### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|-----------|------------|-------------------|--------------------------|
| 1 | LR enqueue omits the 6 fields; since it always supplies `quality`, the gate is never entered, so 6 settings silently use defaults | High | Strong (direct artifact) | Direct read of route.ts:420-444 shows the 6 are absent |
| 2 | LR enqueue was already fixed (6 fields present but not visible in the excerpt) | Low | Weak | Contradicted by the complete enqueue call text at lines 420-444 |

#### Evidence For (Hypothesis 1 — DEFECT)

- **route.ts:420-444** (direct read): the `enqueueImageProcessing` call in the LR
  route passes exactly these fields: `id`, `filenameOriginal`, `filenameWebp`,
  `filenameAvif`, `filenameJpeg`, `width`, `topic`, `quality` (built from
  `config.imageQualityWebp/Avif/Jpeg`), `imageSizes`, `camera_model`,
  `capture_date`, `iccProfileName`, `colorSignals`. The 6 settings
  (`forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`,
  `sdrJpegChroma`, `wideGamutMaxSourcePixels`, `autoAltTextEnabled`) are
  entirely absent from the call.

- **`config` is fetched from `getGalleryConfig()` at route.ts:170**: the LR
  route resolves a full `GalleryConfig` and accesses `config.imageQualityWebp`,
  `config.imageQualityAvif`, `config.imageQualityJpeg`, and `config.imageSizes`
  to build `quality` and `imageSizes`. The same config object carries all 6
  missing fields (`config.forceSrgbDerivatives`, etc.) but they are simply never
  read or forwarded.

- **image-queue.ts:318-336**: the handler unconditionally seeds the 6 locals
  from `job.*` fields (lines 326-335). Because the LR job carries no values for
  any of the 6, they fall to:
  - `autoAltTextEnabled = job.autoAltTextEnabled ?? false` → `false`
  - `forceSrgbDerivatives = job.forceSrgbDerivatives ?? false` → `false`
  - `wideGamutJpegChroma = job.wideGamutJpegChroma` → `undefined`
  - `avifEffort = job.avifEffort` → `undefined`
  - `sdrJpegChroma = job.sdrJpegChroma` → `undefined`
  - `wideGamutMaxSourcePixels = job.wideGamutMaxSourcePixels` → `undefined`
  The gate at line 336 (`if (!quality && !imageSizes)`) is then evaluated;
  since `quality` IS present (from `config.imageQuality*`), the gate is NOT
  entered, and the 6 process-image defaults are used permanently.

- **image-queue.ts:113-148** (type definition): `ImageProcessingJob` declares
  all 6 as optional fields (`forceSrgbDerivatives?: boolean`, etc.) — the type
  system does not enforce they are supplied, so the LR call compiles cleanly
  with no type error despite omitting them.

- **Contrast with browser path (images.ts:440-466)**: the post-CR-R9C6-01
  browser upload explicitly passes all 6:
  ```
  forceSrgbDerivatives: uploadConfig.forceSrgbDerivatives,
  wideGamutJpegChroma: uploadConfig.wideGamutJpegChroma,
  avifEffort: uploadConfig.avifEffort,
  sdrJpegChroma: uploadConfig.sdrJpegChroma,
  wideGamutMaxSourcePixels: uploadConfig.wideGamutMaxSourcePixels,
  autoAltTextEnabled: uploadConfig.autoAltTextEnabled,
  ```
  The LR call at lines 420-444 has no corresponding block.

#### Evidence Against / Gaps (Hypothesis 1)

- The LR route does call `getGalleryConfig()` at line 170 and has the full
  config object in scope. There is no structural obstacle to forwarding the 6
  fields — the omission is not architectural, it is a gap in the fix applied by
  CR-R9C6-01 which only extended the browser path.

- No secondary config load occurs between line 170 and the enqueue at line 420
  that could apply the 6 settings through a side channel.

#### Evidence Against (Hypothesis 2 — already fixed)

- The complete enqueue call from line 420 to 444 contains no reference to
  `forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`,
  `wideGamutMaxSourcePixels`, or `autoAltTextEnabled`. The call ends at line 444
  with `colorSignals: data.colorSignals,` followed by the closing `});`. There
  is no hidden continuation.

#### Rebuttal Round

Best challenge to Hypothesis 1: "The LR path always re-encodes through
a backfill pass after upload; the 6 settings are therefore applied at
backfill time and the upload-time omission does not matter."

Why the leader still stands: this assumes the operator always runs a
backfill after every LR publish. The product does NOT guarantee this. An
admin who uses Lightroom to publish photos after changing, for example,
`forceSrgbDerivatives=true` will see those LR-published photos encoded with
`forceSrgbDerivatives=false` (the default) until a manual backfill re-encode is
triggered. The browser upload path (the one CR-R9C6-01 fixed) already closed
this gap for browser uploads on the grounds that the backfill requirement should
not be an implicit dependency of a correct upload. The same correctness
argument applies equally to LR uploads.

#### Decisive Line

`apps/web/src/app/api/admin/lr/upload/route.ts:420-444` — the
`enqueueImageProcessing` call supplies `quality` and `imageSizes` but omits all
6 of `forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`,
`sdrJpegChroma`, `wideGamutMaxSourcePixels`, and `autoAltTextEnabled`. Because
`quality` is present the gate at `image-queue.ts:336` is never entered.

#### Verdict

**DEFECT.** Confidence: **High**.

Failure scenario: an admin sets `forceSrgbDerivatives=true` (or any non-default
value for the 5 remaining settings) and then publishes photos via Lightroom
Classic. Every LR-published photo is encoded with the process-image defaults for
all 6 settings, ignoring the admin configuration, until a manual backfill
re-encode is run. The browser upload path does not have this defect.

Fix: mirror the browser fix from CR-R9C6-01. In the `enqueueImageProcessing`
call at route.ts:420, add the 6 fields from the already-fetched `config`:

```ts
forceSrgbDerivatives: config.forceSrgbDerivatives,
wideGamutJpegChroma: config.wideGamutJpegChroma,
avifEffort: config.avifEffort,
sdrJpegChroma: config.sdrJpegChroma,
wideGamutMaxSourcePixels: config.wideGamutMaxSourcePixels,
autoAltTextEnabled: config.autoAltTextEnabled,
```

The `config` object is already in scope from the `getGalleryConfig()` call at
line 170 and carries all 6 fields. No additional DB query is needed.

---

### FLOW 2 (CONTRAST): browser upload path (images.ts:440)

#### Observation

Post-CR-R9C6-01, the browser upload path at images.ts:440 passes all 6
settings to `enqueueImageProcessing`.

#### Evidence

- `images.ts:440-466`: the call includes all 6 fields from `uploadConfig`
  (confirmed by direct read). This path is CLEAN.

---

### FLOW 3 (CONTRAST): retryFailedImage (images.ts:1139)

#### Observation

`retryFailedImage` re-enqueues a failed image job at images.ts:1139. It does
NOT supply `quality`, `imageSizes`, or any of the 6 settings.

#### Evidence

- `images.ts:1139-1157`: the call passes only `id`, `filenameOriginal`,
  `filenameWebp`, `filenameAvif`, `filenameJpeg`, `width`, `topic`,
  `iccProfileName`, `colorSignals`, `camera_model`, `capture_date`. No
  `quality`, no `imageSizes`, none of the 6.

- Because `quality` is absent (undefined) AND `imageSizes` is absent,
  the gate at image-queue.ts:336 (`if (!quality && !imageSizes)`) IS entered,
  and the full config is loaded from DB at that point. All 6 settings are
  thus correctly loaded from current config.

- **This path is intentionally correct for the retry scenario**: the admin
  may have changed settings between the original failure and the retry, and
  loading current config at retry time is the right behavior.

Verdict: **CLEAN**.

---

### FLOW 4 (CONTRAST): bootstrap path (image-queue.ts:674)

#### Observation

The bootstrap path re-enqueues unprocessed images on startup at
image-queue.ts:674. It passes no `quality`, no `imageSizes`, and none of
the 6 settings.

#### Evidence

- `image-queue.ts:674-692`: the call passes `id`, `filenameOriginal`,
  `filenameWebp`, `filenameAvif`, `filenameJpeg`, `width`, `topic`,
  `capture_date`, `camera_model`, `iccProfileName`, `colorSignals`. No
  `quality`, no `imageSizes`, none of the 6.

- Both `quality` and `imageSizes` are absent, so the gate at line 336 IS
  entered, and all settings are loaded from current config.

- This is the documented behavior: the gate comment at image-queue.ts:337
  explicitly calls this the "Bootstrap / legacy re-enqueue path" and states
  the gate is responsible for loading all settings when the job carries none.

Verdict: **CLEAN** (by design).

---

### FLOW 5 (CONTRAST): internal retry re-enqueue (image-queue.ts:510)

#### Observation

When processing fails and `retries < MAX_RETRIES`, the queue handler re-enqueues
the SAME job object via `enqueueImageProcessing(job)` at line 510.

#### Evidence

- `image-queue.ts:510`: `enqueueImageProcessing(job)` re-passes the original
  job reference. If the original job was a browser upload (6 fields present),
  those fields are preserved. If it was an LR upload (6 fields absent), the
  same absence is preserved — which means the internal retry of an LR job still
  silently uses defaults for the 6 settings on all retries as well. This is a
  secondary consequence of the LR defect above, not an independent defect.

Verdict: **CONSEQUENTIAL TO DEFECT 1** (not a separate root cause).

---

### FLOW 6 (CONTRAST): admin backfill runner (admin-backfill-runner.ts:499)

#### Observation

The in-app backfill runner calls `processImageFormats` directly (not via
`enqueueImageProcessing`) at admin-backfill-runner.ts:499. It receives settings
through a `settings` object.

#### Evidence

- `admin-backfill-runner.ts:499-513`: calls `processImageFormats` with
  `settings.quality`, `settings.sizes`, `settings.forceSrgbDerivatives`,
  `settings.wideGamutJpegChroma`, `settings.avifEffort`, `settings.sdrJpegChroma`,
  `settings.wideGamutMaxSourcePixels` — all 6 (plus quality and sizes) flow
  from the backfill runner's own resolved config. Does not go through the
  `ImageProcessingJob` / gate path at all.

Verdict: **CLEAN**.

---

### FLOW 7 (CONTRAST): sidecar backfill (backfill-color-pipeline.ts:203)

#### Observation

The sidecar backfill script calls `processImageFormats` directly at line 203.

#### Evidence

- `backfill-color-pipeline.ts:203-218`: passes `settings?.quality`,
  `settings?.sizes`, `settings?.forceSrgbDerivatives`, `settings?.wideGamutJpegChroma`,
  `settings?.avifEffort`, `settings?.sdrJpegChroma`, `settings?.wideGamutMaxSourcePixels`.
  Does not go through the queue job path.

Verdict: **CLEAN**.

---

### FLOW 8: settings-hash → ETag invalidation

#### Observation

Does flipping a `COLOR_IMPACTING_KEY` cause the serve-upload ETag to change?

#### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|-----------|------------|-------------------|--------------------------|
| 1 | Flipping any COLOR_IMPACTING_KEY changes the hash and therefore the ETag | High | Strong | Direct code trace through settings-hash.ts and serve-upload.ts |
| 2 | The 5-second cache causes a brief window where the old ETag is served | Low | Moderate | Acknowledged in code comments; bounded and acceptable |

#### Evidence For (Hypothesis 1 — CLEAN)

- `settings-hash.ts:42-54`: `COLOR_IMPACTING_KEYS` is an exhaustive 9-key
  const array covering all byte-impacting admin settings.

- `settings-hash.ts:79-82` (`buildHash`): deterministically serializes all 9
  keys as `k=v` joined by `|` and takes the first 8 hex chars of SHA-256.
  Any value change produces a different hash (SHA-256 collision probability
  negligible for this use case).

- `settings-hash.ts:89-102` (`buildHashFromConfig`): the R8-H1 validated-values
  form builds the hash from resolved `GalleryConfig` values, not raw DB strings,
  so an invalid DB value that gets clamped by the resolver still produces a hash
  matching the actual encoded output.

- `serve-upload.ts:214-215`: `const settingsHash = await getServingColorSettingsHash();`
  followed by `const etag = \`W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"\``.
  The settings hash is folded into the ETag. A changed hash → different ETag →
  client receives 200 instead of 304 on next revalidation.

- `settings-hash.ts:63-69`: `getServingColorSettingsHash` (referenced in
  serve-upload.ts:13) uses the config-arg form when a config is available,
  falling back to the DB-fetch form. The DB-fetch path has a 5 s TTL cache
  (lines 144-158) — not a correctness issue, a latency trade-off documented
  in the code and CLAUDE.md.

- `settings-hash.ts:63-66` compile-time guard: `_ColorKeysAreSettingKeys`
  ensures every member of `COLOR_IMPACTING_KEYS` is a real `GallerySettingKey`
  at `tsc` time.

#### Evidence Against / Gaps

- The 5 s cache means there is up to a 5 s window after a setting change where
  the old hash is returned. This is bounded and acknowledged. Not a defect.

- The static Next.js path (files served from `public/uploads/` via the
  filesystem) uses a mtime+size ETag, not the settings hash. The settings hash
  only affects the `serve-upload.ts` route handler path. The CLAUDE.md
  "Operational gotcha (CRT-D1)" section documents this correctly.

#### Verdict

**CLEAN.** Flipping any `COLOR_IMPACTING_KEY` changes the settings hash
within ≤ 5 s and therefore the serve-upload ETag on the next request.
The static-path limitation (requiring a backfill re-encode to change file
mtimes) is a documented architectural trade-off, not a defect.

---

## Summary Table

| Flow | Path | Verdict | Confidence | Decisive Location |
|------|------|---------|-----------|-------------------|
| 1 | LR publish enqueue (route.ts:420) | **DEFECT** | High | route.ts:420-444 (6 fields absent) + image-queue.ts:336 (gate skipped) |
| 2 | Browser upload (images.ts:440) | CLEAN | High | images.ts:461-466 (6 fields present) |
| 3 | retryFailedImage (images.ts:1139) | CLEAN | High | No quality/imageSizes → gate entered → config loaded |
| 4 | Bootstrap (image-queue.ts:674) | CLEAN | High | No quality/imageSizes → gate entered → config loaded |
| 5 | Internal retry re-enqueue (image-queue.ts:510) | Consequential to Flow 1 | High | Inherits original job; same defect for LR-origin jobs |
| 6 | Admin backfill runner (admin-backfill-runner.ts:499) | CLEAN | High | Calls processImageFormats directly with full settings |
| 7 | Sidecar backfill (backfill-color-pipeline.ts:203) | CLEAN | High | Calls processImageFormats directly with full settings |
| 8 | settings-hash → ETag | CLEAN | High | serve-upload.ts:214-215 + settings-hash.ts:79-102 |

---

## Finding: CR-R9C7-01

**Label:** DEFECT
**Confidence:** High
**Severity:** Same as CR-R9C6-01 (which this mirrors on the LR path)

**File:line:** `apps/web/src/app/api/admin/lr/upload/route.ts:420-444`

**Failure scenario:** An admin sets any non-default value for
`forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`,
`wideGamutMaxSourcePixels`, or `autoAltTextEnabled`, then publishes photos via
Lightroom Classic PAT. The LR upload route fetches the full `GalleryConfig` at
line 170 (capturing the admin's settings) but forwards only `quality` and
`imageSizes` to the queue job. The handler at image-queue.ts:326-335 seeds the
6 settings from the (absent) job fields, yielding their `?? false` / `undefined`
defaults. Because `quality` is present the gate at line 336 is never entered.
`processImageFormats` is called with the wrong settings for the 6 admin tunables.
The same defect also applies to all internal retries of an LR-origin job
(image-queue.ts:510) since those re-pass the original job object.

**Fix:** In the `enqueueImageProcessing` call at route.ts:420, add the 6 fields
from the already-fetched `config` object (no additional DB query needed):

```ts
forceSrgbDerivatives: config.forceSrgbDerivatives,
wideGamutJpegChroma: config.wideGamutJpegChroma,
avifEffort: config.avifEffort,
sdrJpegChroma: config.sdrJpegChroma,
wideGamutMaxSourcePixels: config.wideGamutMaxSourcePixels,
autoAltTextEnabled: config.autoAltTextEnabled,
```

This mirrors the browser upload fix from CR-R9C6-01 exactly.

---

## Uncertainty Notes

- The internal retry path (image-queue.ts:510) re-passes the original job
  object unchanged. For LR-origin jobs this inherits the 6-field omission.
  Fixing the LR enqueue (above) automatically fixes the retry path as well —
  no separate change is needed there.

- No other enqueue sites were found beyond the 7 traced above. A grep for
  `enqueueImageProcessing(` in the codebase would confirm completeness if
  needed.
