# Photographer Review R14 — Aggregate Findings

**Date:** 2026-05-17
**Run:** review-plan-fix cycle 5/100
**Scope:** Fresh comprehensive pass after cycle-4 R13 work landed
(R13-H1/R13-L3/R10-L13 responsive format-aware prev/next preload,
R13-L2/R10-L21 WideGamutHint dark-mode contrast, R13-L1/R10-L18
dynamic accordion label, R13-M2/R12-M1 canonical gamut-family dismiss
key) plus cycle-5 quick wins (R10-L11, R10-L15, R10-L22, R10-M8,
R10-M14).
**Premise:** Photos arrive AFTER editing. Product is a delivery
surface. No edit/cull/score/pick proposals here.

## Reviewer fan-out — environment constraint (unchanged from R11–R13)

No reviewer-style subagents are registered in
`/Users/hletrd/.claude/agents/` or `./.claude/agents/`. Single-agent
R14 pass conducted across the photographer-delivery surfaces:
encoder/processing, viewer/lightbox, color audit, download UX,
settings admin, masonry grid, share/topic, SEO/i18n, service worker
freshness, and a11y.

## Carry-over R10 backlog — items still active after this cycle

The R10 backlog from `.context/plans/photographer-r10/README.md` shrinks
this cycle by R10-L11, R10-L15, R10-L22, R10-M8, R10-M14. Items NOT
picked up this cycle remain there:

- **R10-C1** synthetic P3 round-trip test (CRITICAL, still open)
- **R10-H2** failed-image admin visibility (HIGH, schema migration)
- **R10-H4** Firefox UI dismissibility — only PARTIAL via R12-M1;
  full admin-settings note + canvas-P3 weak signal still open
- **R10-H5** masonry gamut/HDR chip (HIGH, data layer + UI)
- **R10-M2** histogram P3 luminance coefficients (MED)
- **R10-M4** delivered-bit-depth label refinements (MED)
- **R10-M5** percentile-based key-type (MED)
- **R10-M6/M7** AVIF NCLX / WebP ICC post-encode verification (MED)
- **R10-M11** blur+fade crossfade race (MED)
- **R10-M12** bottom-sheet ordering (MED)
- **R10-M15** histogram key-type tooltip wording (MED)
- **R10-L7** quality tooltips (LOW)
- **R10-L8** 5K/8K size variants (LOW)
- **R10-L19** color chip in bottom-sheet peek (LOW)
- **R10-L20** bit depth + format chips in lightbox color pip (LOW)
- **R10-L23** `object-cover` photographer trade-off doc comment (LOW)

## R11/R12/R13 carry-over (deferred with exit criteria, unchanged)

- **R11-H1** SW HEAD-probe rate-limit (5-min throttle)
- **R11-H2** (full) `sw.js` template-file + `.gitignore` restructure
- **R11-M2** `100dvh` + CSS custom property
- **R11-L2** memoize histogram canvas ctx options
- **R11-L4** WI-15 ICC preservation fixture test
- **R11-L5** closure-guard test
- **R12-M3** structured failure-reason map
- **R12-L1** SW build placeholder format
- **R12-L2** color-details default-open heuristic
- **R12-L3** `useDisplayCapability` `wasFallback` flag
- **R12-L4** `humanizeColorPrimaries` non-null return
- **R13-M1** color-details accordion `isNonTrivialColor` HDR rejected
  photos for non-admin (deferred in r13 plan)

---

## NEW R14 Findings (fresh pass)

### Severity Summary

| Severity | Count | IDs |
|----------|-------|-----|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 2 | R14-M1, R14-M2 |
| LOW | 3 | R14-L1, R14-L2, R14-L3 |

---

### MEDIUM

#### R14-M1 — Wide-gamut hint named SOURCE gamut instead of DELIVERED ceiling

**Source:** Photographer-honesty lens (CLOSED this cycle as R10-M8)
**Files:** `apps/web/src/components/wide-gamut-hint.tsx:90-103`
**Confidence:** HIGH
**Status:** CLOSED — this cycle re-frames the hint to name the
DELIVERED gamut (Display P3 — always) with the source gamut as a
parenthetical context when source is wider than P3 (Adobe RGB,
ProPhoto, Rec.2020). The visitor now correctly understands "the full
gamut my display can show is Display P3, and the photographer mastered
in {Rec.2020}." See commit pending.

---

#### R14-M2 — Settings-page backfill warning fires on every save, including unrelated edits (e.g. slideshow interval)

**Source:** Admin-UX lens (CLOSED this cycle as R10-M14)
**Files:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:108-114`
**Confidence:** HIGH
**Status:** CLOSED — the amber banner now fires only when at least
one of `force_srgb_derivatives` / `allow_hdr_ingest` /
`wide_gamut_jpeg_chroma` / `sdr_jpeg_chroma` / `avif_effort` /
`wide_gamut_max_source_pixels` / `image_quality_*` differs from the
last-committed baseline. Slideshow / SEO / privacy edits no longer
trip a backfill warning the admin will learn to ignore.

---

### LOW

#### R14-L1 — Partial encode failure left orphaned sized variants on disk for retry

**Source:** Encoder/reliability lens (CLOSED this cycle as R10-L11)
**Files:** `apps/web/src/lib/process-image.ts:854-1057`
**Confidence:** HIGH
**Status:** CLOSED — `processImageFormats` now tracks every sized
variant path it wrote (`writtenSizedPaths` Set per format) and unlinks
all of them on rejection via the new `catch` block before re-throwing.
The next retry / backfill pass sees a clean variant directory rather
than half-written `_640.avif`/`_1536.avif` files that look valid.

---

#### R14-L2 — Color-details accordion clickable area was the chevron+label cluster, not the full row

**Source:** Touch-target / a11y lens (CLOSED this cycle as R10-L15)
**Files:** `apps/web/src/components/color-details-section.tsx:238-247`
**Confidence:** HIGH
**Status:** CLOSED — accordion toggle button now uses `flex-1
text-left` so the entire row width is a tappable target. Sibling
tooltip + copy buttons on the right edge remain independently
clickable. Touch-target audit still passes (44 px floor preserved).

---

#### R14-L3 — Download dropdown labeled "Display P3 JPEG" implies 10-bit P3, but the JPEG is 8-bit

**Source:** Download-UX honesty lens (CLOSED this cycle as R10-L22)
**Files:** `apps/web/messages/en.json:323`, `apps/web/messages/ko.json:323`
**Confidence:** HIGH
**Status:** CLOSED — i18n key `viewer.downloadP3Jpeg` updated to
"Download (8-bit Display P3 JPEG)" / "다운로드 (8비트 Display P3 JPEG)".
The AVIF dropdown sibling correctly omits a bit depth (AVIF varies
based on the 10-bit probe) — the JPEG line was the one that needed
honest framing.

---

## Cross-cycle agreement / consolidation

- **R14-M1** closes R10-M8 (wide-gamut hint names delivery gamut).
- **R14-M2** closes R10-M14 (conditional backfill warning).
- **R14-L1** closes R10-L11 (partial encode cleanup).
- **R14-L2** closes R10-L15 (full accordion row tappable).
- **R14-L3** closes R10-L22 (download label clarification).

## Verdict

- 0 CRITICAL new; 0 HIGH new; 2 MED new; 3 LOW new.
- All 5 new findings are CLOSED this cycle by rolling up against the
  pre-existing R10 backlog (5 R10 backlog items resolved).
- R10-C1 (synthetic P3 round-trip test) and R10-H2 (failed image
  admin visibility) remain the outstanding HIGH-priority items. Both
  require a dedicated cycle: R10-C1 needs careful fixture authoring
  with a known out-of-sRGB-gamut color patch and a P3-aware decoder;
  R10-H2 needs a schema migration plus admin dashboard work.

*Aggregate compiled by single-agent R14 pass (no fan-out agents available).*
