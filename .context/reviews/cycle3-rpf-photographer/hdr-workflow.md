# Cycle 3 RPF — HDR Workflow Review

**Date:** 2026-05-08
**Reviewer perspective:** professional photographer + end-user-workflow.
**Scope:** HDR ingest, detection, delivery, badges, downloads, CICP signaling.
**Predecessor reviews:** `.context/reviews/photographer-r3/hdr-workflow.md`, `.context/reviews/cycle2-rpf-photographer/hdr-workflow.md`.

---

## State of the codebase entering cycle 3

The HDR workflow is now **honest by design**:

- Ingest: rejected by default; admin opt-in `allow_hdr_ingest=true` allows ingest with a console warning + UI warning toast (P3-14). Tested in `upload-rejects-hdr.test.ts` and `__tests__/hdr-filenames.test.ts`.
- Detection: NCLX `colr` ISOBMFF parser, NCLX maps per ITU-T H.273 (`9` = BT.2020, `11` = DCI-P3, `12` = P3-D65; transfer `13` = sRGB, `16` = PQ, `18` = HLG; matrix `0` = identity, `1` = BT.709, `9` = BT.2020-NCL). NCLX wins over ICC name on conflict (cycle 2 C2-A7).
- Delivery: no HDR derivative emitted; the `_hdr.avif` download dropdown was deleted in P3-1. The `viewer.downloadHdrAvif` translation key was removed in cycle 2 C2-A3.
- Badge: `is_hdr` is admin-only (C2-A1). Public consumers do not see the HDR badge. Admin still sees the badge with a high-contrast amber gradient (P3-15).
- Future state: WI-09 (HDR encoder via `avifenc`) is deferred. When it ships, the badge can re-enable on public surface, the `_hdr.avif` download menu item re-adds, and the translation key re-adds.

**Cycle-3 baseline gates:** all green. No HDR-axis regression observed.

---

## Findings (cycle 3)

### MED (1)

#### C3-HDR-MED-1 — `is_hdr` field still consumed by `ColorDetailsSection` even though it's admin-only

**File:** `apps/web/src/components/color-details-section.tsx:64-71, 80, 197`.
**Severity:** MED.
**Confidence:** HIGH.

`ColorDetailsSection` reads `image.is_hdr` to (a) determine `isNonTrivialColor` (default-open accordion) and (b) render the HDR badge. After P3-3 / cycle-2 C2-A1, `is_hdr` is undefined for public consumers (omitted from `publicSelectFields`). For public render path:

- `isHdr` derived from `transfer_function === 'pq' || 'hlg'`: but `transfer_function` is also admin-only (omitted from `publicSelectFields`).
- `isNonTrivialColor` reads `(isAdmin && isHdr)` — guarded.
- HDR badge gated on `if (isHdr)` (line 197) where `isHdr = transfer_function === 'pq' || 'hlg'`. **For public consumers, `transfer_function` is undefined → `isHdr = false` → badge does not render.** ✓ Correct.

But examine the `hasColorDetails` short-circuit at line 80:

```ts
const hasColorDetails = Boolean(
    image.color_primaries || image.transfer_function || image.is_hdr || (isAdmin && image.color_pipeline_decision),
);
```

For public consumers, `image.transfer_function` and `image.is_hdr` are undefined. Component returns `null` if `color_primaries` is also null/undefined (which would be the case for sRGB sources). So sRGB-sourced public photos correctly don't render the section. ✓ Correct.

The actual finding: `image.is_hdr` reference at line 80 is dead-code on the public path (always undefined). It's a defense-in-depth check that costs nothing, but a TypeScript-strict reader would flag it as a smell. The defense-in-depth value is real (if a future regression re-adds `is_hdr` to `publicSelectFields`, this line still does the right thing).

**Photographer impact:** none. The HDR badge correctly does NOT render on public surface today.

**Fix shape:** comment-document the defense-in-depth posture, OR remove the dead-on-public reference and rely on the privacy guard test (`map-privacy.test.ts`) to enforce the invariant. Recommendation: **document inline** — defense-in-depth is the right posture for privacy-critical fields.

#### C3-HDR-MED-2 — Legacy `is_hdr=true` rows pre-P3-2 carry malformed SDR pixels; no admin diagnostic

**File:** carry-forward from cycle 2 `C2-HDR-LOW-1` (deferred to plan 41 / WI-09).
**Severity:** MED (escalated from LOW because the cycle-3 review re-examines from photographer-intent angle).
**Confidence:** HIGH.

Before P3-2 landed, any PQ/HLG HEIF that was uploaded (auto-detected as HDR via NCLX) processed through `processImageFormats` which decoded the PQ-encoded values as raw RGB without inverse OETF. The bytes on disk for those legacy rows are SDR-tonemapped-by-accident — the AVIF says P3 but the pixel values are PQ-as-gamma2.2 (silent miscolor).

Today: those rows still exist in any production database that was running pre-P3-2. They:

- Have `is_hdr=true` in the DB.
- Render the admin HDR badge (since admin sees the field).
- Deliver bytes with malformed tonality.
- Are NOT detectable from public surface (admin-only field), but the photographer-admin sees the badge and the file delivers wrong colors.

No admin UI surface flags these rows as "this row was uploaded pre-P3-2 and the pixels are malformed; re-process recommended."

**Fix shape:** add an admin-only column or computed field that flags rows as "legacy PQ/HLG decode" if `pipeline_version < 6 AND is_hdr=true`. Surface in the image manager admin grid as a warning icon. Provide a "re-process this image" admin action that re-runs the pipeline (which will now reject HDR ingest, OR encode tonemapped if WI-09 ships).

**Defer to plan 41 if WI-09 dependency is too tight.** Cycle 2 deferred this; the deferral exit criterion is "When WI-09 ships or a photographer reports legacy-row delivery oddity." Cycle 3 doesn't change the exit criterion but escalates severity to MED because the malformed pixels are silent miscolor on the photographer's audit surface.

**Photographer impact:** legacy rows on a long-running install deliver wrong-tonality photos labeled as HDR (admin sees the badge). The photographer cannot distinguish "this row's bytes are good" from "this row's bytes are pre-P3-2 malformed" without checking `pipeline_version`.

#### C3-HDR-MED-3 — `inferTransferFunction` still falls through to `'srgb'` for unknown profiles

**File:** `apps/web/src/lib/color-detection.ts:78-90`.
**Severity:** MED.
**Confidence:** HIGH.

When the ICC name is unrecognized (no `'srgb'`, no `'iec61966'`, no `'adobe'`, no `'prophoto'`, etc.) AND bit depth < 10, `inferTransferFunction` defaults to `'srgb'`. This is a guess — for an unknown ICC profile, we can't know the transfer.

For 10-bit+ unknown profiles, the function returns `'unknown'` (line 88). Good.

For 8-bit unknown profiles, the function returns `'srgb'` — which sets `isHdr = false` correctly but also lies about the transfer in the audit panel. Photographer-admin reads `Color Space: ScRGB-Studio (or whatever)` paired with `Transfer function: sRGB` — the latter is a guess, not a measurement.

**Fix shape:** return `'unknown'` for the fall-through case at line 90 instead of `'srgb'`. Document that "sRGB" is the photographer's responsibility to confirm via the source. Update tests that depend on the `'srgb'` default.

**Photographer impact:** rare ICC profiles (custom calibration profiles, off-brand RGB working spaces) get a `'srgb'` label that's a guess. Mostly invisible because the admin audit panel renders empty for `humanizeTransferFunction('unknown')`.

**Verification:** the conflict-resolution path at lines 273-277 only kicks in when NCLX is present. ICC-only profiles with unrecognized names still hit the heuristic.

---

### LOW (2)

#### C3-HDR-LOW-1 — `parseCicpFromHeif` does not parse the `full_range` flag

**File:** `apps/web/src/lib/color-detection.ts:192-200`.
**Severity:** LOW.
**Confidence:** HIGH.

The NCLX colr box has a 5th byte after `matrix`: `full_range_flag` (1 bit at MSB, padding 7 bits). The parser reads only the first 11 bytes (primaries, transfer, matrix at offsets 4/6/8). The `full_range` flag at offset 10 is silently ignored.

For HDR delivery this matters: PQ / HLG NCLX sources can be either limited-range (16..235 / 16..240) or full-range (0..255). When WI-09 ships, the encoder must respect the source range. Today the field is unread.

**Fix shape:** when the parser is touched again, return the `full_range` boolean too (1-bit MSB of byte 10):

```ts
return {
    colourPrimaries: buffer.readUInt16BE(dataStart + 4),
    transferCharacteristics: buffer.readUInt16BE(dataStart + 6),
    matrixCoefficients: buffer.readUInt16BE(dataStart + 8),
    fullRange: (buffer.readUInt8(dataStart + 10) & 0x80) !== 0,
};
```

Add a `full_range` column to `images` (admin-only). Lock via test in `__tests__/cicp-vs-icc-conflict.test.ts` or new fixture.

**Photographer impact:** none today (HDR encoder not yet implemented). Will matter when WI-09 ships. Defer to WI-09.

#### C3-HDR-LOW-2 — Admin HDR-warning toast count is per-batch but not deduped across navigation

**File:** `apps/web/src/app/actions/images.ts:271, 299-300`.
**Severity:** LOW.
**Confidence:** MEDIUM.

`hdrWarningCount++` increments per HDR-detected upload in the batch. Returned to the client as a single warning toast. If an admin uploads 3 HDR-flagged HEIFs in one batch, the toast says "3 HDR images accepted." If the admin uploads them one-at-a-time, they get 3 separate "1 HDR image accepted" toasts. Photographer expects identical UX regardless of batch size.

**Fix shape:** the toast text is correct; the multi-batch case is a UX consideration. No code change needed; documentation polish.

**Photographer impact:** trivial.

---

### Photographer-axis re-confirmation

| Question | Answer |
|---|---|
| Does the upload pipeline reject PQ/HLG by default? | YES (`P3-2`, gated on `allow_hdr_ingest=false`). |
| Is there a clear error message on rejection? | YES (`imageManager.hdrNotSupported` localized en+ko). |
| Is there an admin opt-in to ingest HDR with a clear warning? | YES (`allow_hdr_ingest` setting + UI toast warning). |
| Does the public viewer render an HDR badge on a fake-HDR row? | NO (admin-only field; cycle-2 C2-A1 lock test). |
| Does the desktop dropdown expose a 404'd `_hdr.avif` link? | NO (deleted in P3-1; locked by `photo-viewer-no-hdr-download.test.ts`). |
| Is `transfer_function` / `matrix_coefficients` / `is_hdr` admin-only? | YES (tests `map-privacy.test.ts` line 49). |
| Does NCLX win over ICC name on conflict? | YES (cycle 2 C2-A7; locked by `__tests__/color-detection.test.ts` and the NCLX precedence test). |

**Net:** the HDR axis is in a defensible state. The 5 cycle-3 findings are residual polish (admin observability for legacy rows, transfer fall-through, full-range flag) rather than user-facing landmines.

---

## Convergent findings (this round)

None.

---

## Provenance

Cycle-3 RPF HDR workflow angle. Single-orchestrator focused pass.
