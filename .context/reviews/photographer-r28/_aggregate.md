# Photographer R28 — Aggregate Review
**Date:** 2026-05-20
**Lens:** Working professional photographer + bilingual KO/EN end-user; cross-device color & HDR delivery accuracy.
**Pass type:** Three parallel sub-reviews fanned out by scope, each instructed to explicitly avoid re-raising R27.
**Predecessor:** R27 (2026-05-19) — 12 findings (2 HIGH, 7 MED, 3 LOW), **all still open** (no commits since R27).

## Scope reminder

In-scope: color accuracy, ICC profile management, NCLX / H.273 signaling, P3/Adobe RGB/ProPhoto/Rec.2020/DCI-P3 → Display P3 conversion math, HDR ingest gating + delivery honesty, browser × OS × display detection, gallery/lightbox/viewer/audit UX, copy-to-clipboard JSON, error toasts, Korean i18n tone, touch targets, view analytics, share-link delivery.

**Hard out-of-scope (rejected on sight):** any edit / culling / scoring / star-rating / pick-flag / retouch / develop / adjustment / preset / curve / tone-map-authoring feature. Photos arrive AFTER editing is complete. Faithful delivery — never image authorship.

## Result

**Total NEW_FINDINGS: 11**

| Severity | Count |
|----------|-------|
| CRIT | 0 |
| HIGH | 1 |
| MED  | 7 |
| LOW  | 3 |

| Sub-review | New findings | File |
|---|---|---|
| Color pipeline + ICC accuracy | 3 (0 H, 2 M, 1 L) | `color-pipeline.md` |
| HDR workflow + display delivery | 2 (0 H, 1 M, 1 L) | `hdr-and-display.md` |
| UI/UX from photographer + client lens | 6 (1 H, 3 M, 2 L) | `ui-ux.md` |

R27's 12 findings + R28's 11 new findings = **23 open items** in total. R28 surfaced one HIGH that R27 missed (Escape key in lightbox) and two MEDs (NCLX matrix verification, D50 chromaticity preset drift) that required deeper math than R27 was scoped to do.

## Findings index (by severity, build order)

### HIGH (must ship)

1. **R28-UX-HIGH-1** — Lightbox Escape key always closes the lightbox even when the color pip is open; modal-over-modal Escape semantics broken; disrupts the photographer's primary keyboard color-review workflow.

### MED

2. **R28-CP-MED-1** — `verifyAvifNclxInBuffer` reads primaries + transfer but never matrix coefficients; a Sharp/libheif version drift writing the wrong matrix value would not be caught by the post-encode verifier.
3. **R28-CP-MED-2** — ICC chromaticity PRESETS use native-illuminant xy values, but real-world ICC profiles store D50-adapted `rXYZ`/`gXYZ`/`bXYZ`. AdobeRGB-calibrated monitor profiles (Eizo CG2700X, BenQ SW-series) with opaque names fall to `srgb-from-unknown` instead of `p3-from-adobergb`. The `chad` tag is never read.
4. **R28-HD-MED-1** — `forceSrgbDerivatives` is not propagated to `<PhotoViewer>` on `/s/[key]` and `/g/[key]` share routes; ColorDetailsSection + LightboxColorPip show "Display P3" labels on share links when bytes are actually sRGB.
5. **R28-UX-MED-1** — Korean `lrToken.revokeButton` renders as "취소" which means Cancel; collides with the adjacent Cancel button in the same dialog → admin cannot tell safe from destructive action.
6. **R28-UX-MED-2** — Korean `lrToken.plaintextDone` is past-tense status text ("토큰을 복사했습니다") used as a button action label; should be imperative "확인".
7. **R28-UX-MED-3** — `imageManager.noImages` Korean reads "이미지" while the rest of the user-facing copy uses "사진"; inconsistency at the admin's most-used empty state.

### LOW

8. **R28-CP-LOW-1** — `avif_effort` validator range 4–9 under-states Sharp's 0–9; default 6 diverges from Sharp's default 4; CLAUDE.md mirrors the under-stated range.
9. **R28-HD-LOW-1** — `WideGamutHint` dismissal is `sessionStorage`-only; a wedding client browsing a 200-photo P3 album across multiple sessions sees the hint repeatedly.
10. **R28-UX-LOW-1** — First-run admin dashboard (zero photos, zero categories) shows an upload-blocked message with no link to the categories page; onboarding dead end.
11. **R28-UX-LOW-2** — Color metadata copy button is icon-only with no visual success feedback; non-power users can't discover it on mobile.

## Build order rationale

**Phase A — Delivery honesty across share routes (HIGH).** R28-HD-MED-1 (forceSrgbDerivatives propagation) is a one-prop wiring fix in two files; ship first as a delivery-honesty contract. R28-UX-HIGH-1 (lightbox Escape) is a one-handler fix in `lightbox.tsx`; ship in the same phase because both affect the photographer's primary client-delivery workflow.

**Phase B — Color audit + verification correctness.** R28-CP-MED-1 (NCLX matrix check) is a self-contained verifier extension. R28-CP-MED-2 (D50 chromaticity preset / `chad` tag) is the larger color-pipeline math fix — pick Option A (read `chad`) or Option B (re-derive D50-adapted preset values) per cost-vs-completeness trade-off.

**Phase C — Korean i18n safety + consistency.** R28-UX-MED-1 (revoke = 취소 collision) is a destructive-action UX safety defect, ships first. R28-UX-MED-2 and R28-UX-MED-3 are tone consistency improvements bundled with it.

**Phase D — Polish.** R28-CP-LOW-1 (avif_effort range), R28-HD-LOW-1 (WideGamutHint persistence), R28-UX-LOW-1 (onboarding link), R28-UX-LOW-2 (copy button feedback). Each is small and independent.

## Acceptance for the whole pass

After all 11 findings ship:

- `force_srgb_derivatives=true` produces consistent delivery labels on `/p/[id]`, `/s/[key]`, and `/g/[key]`.
- Escape in lightbox closes the color pip first, lightbox second.
- Post-encode AVIF verification catches a matrix-coefficient regression.
- AdobeRGB-calibrated monitor profile sources with opaque names resolve to `p3-from-adobergb` (not `srgb-from-unknown`).
- Korean revoke / cancel dialog buttons are distinguishable; Korean dialog confirms are "확인" not past-tense status statements; empty-state copy reads "사진" not "이미지".
- `avif_effort` admin range matches Sharp's actual capability.
- Wedding clients on share links don't see the WideGamutHint repeatedly across sessions.
- First-run admin gets a direct link to category creation.
- Copy-color-metadata button shows visual feedback on success.

## R27 open items — status confirmed unchanged

All 12 R27 findings are still open at HEAD `c13ca9d0`. R28 does not duplicate any; R28 plans are additive to R27 plans.

| R27 | Status |
|---|---|
| R27-CP-HIGH-1 — color_space / icc_profile_name publicly exposed | open |
| R27-UX-HIGH-1 — no in-app backfill trigger | open |
| R27-CP-MED-1 — DCI-P3 chromaticity preset missing | open |
| R27-CP-MED-2 — pipeline_version not in adminSelectFields | open |
| R27-HD-MED-1 — histogram source label after AVIF 404 | open |
| R27-UX-MED-1 — accordion stale across photo nav | open |
| R27-UX-MED-2 — analytics approximate disclosure | open |
| R27-UX-MED-3 — mobile histogram before EXIF | open |
| R27-UX-MED-4 — top shared albums section | open |
| R27-CP-LOW-1 — verify-prof scanner gate | open |
| R27-HD-LOW-1 — HDR toast copy | open |
| R27-UX-LOW-1 — touch-target SCAN_ROOTS | open |

## Sub-review files

- `color-pipeline.md` — 3 R28-CP findings + verified-clean audit of all 14 R28 lens items
- `hdr-and-display.md` — 2 R28-HD findings + verified-clean audit of all 14 R28 lens items
- `ui-ux.md` — 6 R28-UX findings + verified-clean audit of all 14 R28 lens items

## Plans

Implementation plans live under `.context/plans/photographer-r28/`. R27 plans remain in `.context/plans/photographer-r27/`. No code has been changed.
