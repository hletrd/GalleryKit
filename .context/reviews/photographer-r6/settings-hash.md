# R6 Settings Hash Review

**Angle:** Cache invalidation correctness for color-impacting admin settings
**Files reviewed:** `apps/web/src/lib/settings-hash.ts`, `apps/web/src/__tests__/settings-hash.test.ts`

---

## R6-M1 [MED] — Missing test coverage for two COLOR_IMPACTING_KEYS

### Evidence

`COLOR_IMPACTING_KEYS` in `settings-hash.ts` (lines 29–35):

```ts
const COLOR_IMPACTING_KEYS = [
    'wide_gamut_jpeg_chroma',
    'sdr_jpeg_chroma',
    'avif_effort',
    'force_srgb_derivatives',
    'wide_gamut_max_source_pixels',
] as const;
```

`settings-hash.test.ts` covers:
- `wide_gamut_jpeg_chroma` (key-specific diff test)
- `avif_effort` (key-specific diff test)
- `force_srgb_derivatives` (key-specific diff test)
- Hash stability (same inputs → same hash)
- Ordering independence (key order doesn't matter)

But there are NO tests for:
- `sdr_jpeg_chroma`
- `wide_gamut_max_source_pixels`

If a developer accidentally removes either key from `COLOR_IMPACTING_KEYS`, the existing tests still pass. This means a production deploy could change `sdr_jpeg_chroma` from `'4:2:0'` to `'4:2:2'` and cached sRGB JPEG derivatives would NOT be invalidated. Returning visitors would see stale chroma-subsampled images.

### Impact

Admin flips `sdr_jpeg_chroma` → cached sRGB JPEGs don't invalidate → visitors see old chroma until cache expires naturally (or never, if the ETag doesn't change). The photographer notices color bleeding in fine reds/greens on sRGB JPEGs that should have been re-encoded.

### Fix

Add two minimal test cases to `settings-hash.test.ts`:

```ts
it('differs when sdr_jpeg_chroma changes', () => {
    const h1 = computeSettingsHash({ sdr_jpeg_chroma: '4:2:0' });
    const h2 = computeSettingsHash({ sdr_jpeg_chroma: '4:2:2' });
    expect(h1).not.toBe(h2);
});

it('differs when wide_gamut_max_source_pixels changes', () => {
    const h1 = computeSettingsHash({ wide_gamut_max_source_pixels: 50_000_000 });
    const h2 = computeSettingsHash({ wide_gamut_max_source_pixels: 25_000_000 });
    expect(h1).not.toBe(h2);
});
```

---

## Photographer Impact Summary

| Scenario | Before fix | After fix |
|----------|-----------|-----------|
| Admin changes `sdr_jpeg_chroma` | Cache MAY miss invalidation (untested) | Test guarantees ETag drift |
| Admin changes `wide_gamut_max_source_pixels` | Cache MAY miss invalidation (untested) | Test guarantees ETag drift |
| Normal setting change (covered keys) | Correct | Unchanged |
