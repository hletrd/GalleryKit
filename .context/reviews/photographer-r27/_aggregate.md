# Photographer R27 — Aggregate Review
**Date:** 2026-05-19
**Lens:** Working professional photographer + bilingual KO/EN end-user; cross-device color & HDR delivery accuracy.
**Pass type:** Three parallel sub-reviews fanned out by scope, then synthesized.
**Predecessor:** R26 (2026-05-17) converged with `NEW_FINDINGS: 0`. R27 is a fresh pass after the user re-set the plan stack ("I fixed all plans").

## Scope reminder (hard line)

In-scope: color accuracy, ICC profile management, NCLX / H.273 signaling, P3/Adobe RGB/ProPhoto/Rec.2020/DCI-P3 → Display P3 conversion math, HDR ingest gating + delivery honesty, browser × OS × display detection, gallery/lightbox/viewer/audit UX, copy-to-clipboard JSON, error toasts, i18n tone (en + ko), touch targets, view analytics for client deliveries.

**Hard out-of-scope (rejected on sight):** any edit / culling / scoring / star-rating / pick-flag / retouch / develop / adjustment / preset / curve / tone-map-authoring feature. Photos arrive AFTER the photographer's editing is complete. The product's job is faithful delivery — never image authorship.

## Result

**Total NEW_FINDINGS: 12**

| Severity | Count |
|----------|-------|
| CRIT | 0 |
| HIGH | 2 |
| MED  | 7 |
| LOW  | 3 |

| Sub-review | New findings | File |
|---|---|---|
| Color pipeline + ICC accuracy | 4 (1 HIGH, 2 MED, 1 LOW) | `color-pipeline.md` |
| HDR workflow + display delivery | 2 (1 MED, 1 LOW) | `hdr-and-display.md` |
| UI/UX from photographer + client lens | 6 (1 HIGH, 4 MED, 1 LOW) | `ui-ux.md` |

R26 declared convergence but the convergence was tested against an out-of-date plan stack; once the plan stack was cleared and the audit lens was widened to the bilingual end-user surface + the privacy contract, four new gaps surfaced (two of them HIGH).

## Findings index (by severity, build order)

### HIGH (must ship)

1. **R27-CP-HIGH-1** — `color_space` and `icc_profile_name` are publicly exposed contrary to the CLAUDE.md admin-only contract; custom monitor calibration names ("Eizo CG2700X 2026-05-01") leak to unauthenticated API readers; the compile-time `_PrivacySensitiveKeys` guard does not name them and the runtime fixture does not assert them.
2. **R27-UX-HIGH-1** — Backfill required after color-impacting setting flips: the UI surfaces a warning banner but ships no in-app trigger; the photographer working from an iPad cannot resolve the warning without SSH access.

### MED (next)

3. **R27-CP-MED-1** — DCI-P3 (D63 white) ICC profiles with opaque custom names on TIFF/JPEG fall to `srgb-from-unknown` because the chromaticity matcher has no `dci-p3` preset; the white-point tolerance threshold excludes D63 from the `p3-d65` match.
4. **R27-CP-MED-2** — `pipeline_version` is in the schema and written by the backfill, but absent from both `adminSelectFields` and `publicSelectFields`; admin audit panel cannot surface it; R5-M6 copy-JSON enrichment was blocked on this.
5. **R27-HD-MED-1** — Histogram source label reports "AVIF" when an AVIF 404 forces a JPEG fallback on a P3 display; the photographer reads sRGB-clipped data as P3 distribution. Companion gap: the "(sRGB clipped)" hint is also suppressed.
6. **R27-UX-MED-1** — `ColorDetailsSection` accordion default-open state is captured at mount; navigating P3 → sRGB (or sRGB → P3) in the sidebar without remount leaves the accordion stale.
7. **R27-UX-MED-2** — Analytics view counts shown with `tabular-nums` precision but no approximate / buffered disclosure; photographers quoting numbers to clients risk confident misrepresentation.
8. **R27-UX-MED-3** — Mobile bottom sheet renders the histogram after a 14+ row EXIF grid; primary exposure-QC tool is buried.
9. **R27-UX-MED-4** — `shared_group_views` data is accumulated but never surfaced in the admin analytics page; share-link engagement is the photographer's primary client-delivery metric.

### LOW (polish)

10. **R27-CP-LOW-1** — `verifyAvifNclxInBuffer` `size > 64` gate makes the `colr(prof)` branch unreachable; every sRGB AVIF upload produces a false `[verify-avif]` log warning that drowns out real signaling failures.
11. **R27-HD-LOW-1** — HDR ingest accepted-warning toast says "may not display correctly on all devices" — frames a deterministic SDR downgrade as a probabilistic device compatibility issue. Mismatch with the `viewer.hdrDeliveredAsSdr` audit row.
12. **R27-UX-LOW-1** — Touch-target audit `SCAN_ROOTS` excludes the `(public)` route group; latent structural gap for any future page-level interactive element.

## Build order rationale

**Phase A — Privacy & honesty contracts.** R27-CP-HIGH-1 is the only finding that affects unauthenticated readers TODAY; it ships first regardless of other priorities. R27-CP-MED-2 (pipeline_version select) lands alongside because they touch the same privacy-keys surface.

**Phase B — Color correctness gaps.** R27-CP-MED-1 (DCI-P3 chromaticity) is a real-but-uncommon photographer scenario (DaVinci Resolve / Sony reference monitor TIFFs); ships next. R27-CP-LOW-1 (verify-avif scanner) is a low-risk log-hygiene fix bundled here because it touches `process-image.ts`.

**Phase C — Delivery / display honesty.** R27-HD-MED-1 (histogram source label + clipped hint) is a single-file fix in `histogram.tsx`. R27-HD-LOW-1 (HDR toast copy) is an i18n-only fix in both locales.

**Phase D — Photographer workflow ergonomics.** R27-UX-HIGH-1 (backfill trigger) is a meaningful UI build — the option chosen (button vs. copyable command) determines scope. R27-UX-MED-1/2/3/4 (accordion reset, analytics disclosure, histogram reorder, shared-group analytics) are independent improvements that can ship in any order.

**Phase E — Hardening.** R27-UX-LOW-1 (touch-target audit scope) closes a latent gap; no user-visible change today.

## Acceptance for the whole pass

After all 12 findings ship:

- No admin-only color field reaches an unauthenticated reader. Compile-time + runtime tests assert the contract.
- DCI-P3 TIFF / JPEG with calibration-named ICC processes as `p3-from-dcip3` with correct Bradford D63→D65 chromatic adaptation.
- Histogram on a P3 display always reflects the bytes the visitor is actually seeing; the "(sRGB clipped)" hint fires when the fallback path serves a JPEG.
- HDR ingest toast text is consistent with the audit-row framing on the photo detail surface — both in English and Korean.
- A photographer on an iPad can trigger a backfill (or at minimum read the exact command needed) without SSH access.
- `color_pipeline_decision` / `pipeline_version` and the JPEG / AVIF / WebP delivered chips are reachable from a single copy-to-clipboard JSON payload.
- The analytics page tells the truth about counter precision and exposes share-link views for client deliveries.
- The 44 px touch-target audit cannot be bypassed by inlining interactive markup at page level.

## Sub-review files

- `color-pipeline.md` — 4 findings + closed-items audit
- `hdr-and-display.md` — 2 findings + checklist convergence rationale
- `ui-ux.md` — 6 findings + closed-items audit

## Plans

Implementation plans, one per finding, live under `.context/plans/photographer-r27/`. No code has been changed in this pass — review only.
