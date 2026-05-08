# Cycle 2 RPF — HDR-workflow review (photographer perspective)

**Date:** 2026-05-08
**Cycle:** 2/100
**Reviewer angle:** PQ / HLG ingestion, detection, delivery promise, badge honesty, download paths.
**Predecessor reviews:** `.context/reviews/photographer-r3/hdr-workflow.md`, `.context/reviews/cycle1-rpf-photographer/_aggregate.md`.
**Master plan in flight:** `.context/plans/38-photographer-r3-followup.md`.

---

## Status of the HDR honesty front

After cycle-1's Phase A:

| Plan ID | Description | Status (master HEAD) |
|---|---|---|
| P3-1 | Delete `_hdr.avif` desktop download menu item | **Shipped** (`d02bdb14`) |
| P3-2 | Reject HDR ingest unless `allow_hdr_ingest=true` | **Shipped** (`bcf341c7`) |
| P3-3 | Move `is_hdr` / `transfer_function` / `matrix_coefficients` to admin-only | **Shipped** (`cc0f0d07`) |
| P3-14 | HDR warning toast when ingest is enabled | **Shipped** (`b1512771`) |
| P3-15 | HDR badge contrast bump | **Shipped** (`e444f30e`) |
| P3-18 | Render badge from `transfer_function` not `is_hdr` | **Shipped** (`caefaf37`) |
| P3-19 | HDR AVIF filename helper | **Shipped** (`caefaf37`) |
| P3-13 | ICC TRC-based HDR detection | **Open** |

Phase A's CRIT block has shipped. The remaining open HDR work is P3-13 (large), P3-12 (test fixtures), and the small residue below.

---

## C2-HDR-MED-1 — `viewer.downloadHdrAvif` translation key still in `messages/{en,ko}.json` after P3-1 removed the consumer

**Severity:** MED.
**Confidence:** HIGH.
**Photographer-axis:** maintenance hygiene — orphan translation keys mislead future contributors.

**Files:**
- `apps/web/messages/en.json:319` — `"downloadHdrAvif": "Download (HDR AVIF)"`
- `apps/web/messages/ko.json:319` — `"downloadHdrAvif": "다운로드 (HDR AVIF)"`

**Why it's a problem:** P3-1 (`d02bdb14`) deleted the desktop dropdown HDR download item. The translation keys remain. Plan-38 P3-1 spec said: *"Translation key viewer.downloadHdrAvif may stay (will be reused when WI-09 ships)"* — which is **OK** but should have a `// TODO(WI-09)` marker to remind the next contributor.

**Failure scenario:** a translator (en/ko maintainer) sees an unused key and either deletes it (forcing P3-1 to re-add it post WI-09) or rewrites it with a different copy. Either way, the WI-09 future ship is harder.

**Fix:** add a comment in both JSON files near the key — JSON does not allow inline comments, so the alternative is:
1. Delete the keys (per minimum-shipping principle); plan-WI-09 will re-add them when the encoder ships.
2. OR add a `// TODO` in `image-types.ts` or the photo-viewer file referencing both keys.

**Recommendation:** **delete the keys.** When WI-09 ships and re-adds the menu item, it can re-add the translation. Cleaner.

---

## C2-HDR-LOW-1 — `allow_hdr_ingest=true` still produces SDR-tagged AVIF/WebP/JPEG with potentially malformed pixels (P3-2 risk surface)

**Severity:** LOW (already documented in plan-38; this is a re-confirmation note).
**Confidence:** HIGH.
**Photographer-axis:** HDR honesty.

**File:** `apps/web/src/app/actions/images.ts:282-310`.

**Why it's a problem:** when the admin opts into `allow_hdr_ingest=true`, the upload action still runs the same `processImageFormats` SDR pipeline. The PQ / HLG source is decoded by libheif as raw RGB (no inverse OETF), then the encoder writes sRGB / P3 ICC tags on the result. The `transfer_function` is recorded as PQ / HLG (correct), and the upload-time toast warns the photographer (P3-14). **However**, if the photographer ignores the warning, the bytes on disk are still SDR-encoded with malformed (or at least mistuned) pixels, and the public no longer sees the HDR badge (P3-3).

The cycle-1 plan acknowledged this: P3-2 §"Risk" — *"Existing is_hdr=true rows stay (uploaded before this change ships). They continue to render the badge. P3-3 below addresses the visibility."*

**Failure scenario:** legacy `is_hdr=true` rows from before P3-2 shipped still exist in the DB. The current code does NOT have a `legacy_hdr_treatment` admin setting that controls how to render those rows. The HDR badge does not show (P3-3 hides it from public), but the pixel bytes on disk are still SDR-encoded, so admin views with `is_hdr=true` see the badge promising HDR while the AVIF / WebP / JPEG bytes are SDR.

**Fix:** add an explicit "Legacy HDR rows" admin diagnostic (read-only): a count + filename list of `is_hdr=true` rows, with a hint that they should be re-uploaded when WI-09 lands. **Not gate-blocking; defer.**

**Recommendation:** **defer to plan-39 / WI-09.**

---

## C2-HDR-LOW-2 — `INSERT IGNORE`-style on `transferFunction` decisioning when ICC name and NCLX disagree

**Severity:** LOW.
**Confidence:** MEDIUM.
**Photographer-axis:** edge-case HDR detection accuracy.

**File:** `apps/web/src/lib/color-detection.ts:62-91, 234-282`.

**Why it's a problem:** when the ICC name says PQ but the NCLX CICP transfer characteristic says BT.709 (rare but possible — a misauthored HEIF), the current code uses the ICC name's PQ verdict (line 66-69). When NCLX says PQ but the ICC name says sRGB (also rare — Apple's iPhone 14+ Pro RAW workflow), the ICC name wins and we miss the HDR signal.

The cycle-1 review C1-MED-4 noted that NCLX maps are not exhaustive against H.273; this cycle adds the symmetric concern: when the two disagree, **NCLX should win** (it is the deeper, container-level signal). The ICC name is a *human-readable* label.

**Failure scenario:** Photographer exports HDR HEIF from iPhone 14 Pro with NCLX 9/16/9 (Rec.2020 / PQ / BT.2020-NCL) but with an Apple-overwritten ICC name "Display P3" (Apple sometimes does this in HEIF containers). Current detection: `iccProfileName = "Display P3"` → primaries `p3-d65`, transfer `srgb`. Misses the HDR. Goes through SDR pipeline unflagged — admin doesn't even get a chance to opt-in via `allow_hdr_ingest`.

**Fix:** prefer NCLX when both are present and they disagree on the transfer or primaries. Add a unit test for this conflict case.

```ts
// in detectColorSignals (around the merge of ICC and CICP results)
if (cicp && cicpTransfer && cicpTransfer !== iccTransfer) {
    // CICP/NCLX is the authoritative container-level signal; ICC name may
    // be a human label that doesn't reflect the actual transfer.
    transferFunction = cicpTransfer;
}
```

**Recommendation:** small, targeted fix. Address in plan-39 or P3-13's expansion.

---

## Carry-forward

| ID | From | Status |
|---|---|---|
| P3-13 | plan-38 | Open — defer |
| P3-12 | plan-38 | Open — fixture files needed for HDR test surface |
| P3-2 risk surface | plan-38 / cycle-1 | Re-confirmed; defer (`C2-HDR-LOW-1`) |

---

## Summary

| Severity | Count |
|---|---|
| MED | 1 |
| LOW | 2 |

HDR honesty is in good shape after cycle-1 Phase A. Residual cleanup is small.
