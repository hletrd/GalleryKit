# Photographer R16 — Aggregate Review (cycle 7/100)

**Date:** 2026-05-17
**Lens:** Professional photographer + end-user workflows
**Pass type:** Single-agent focused pass (reviewer fan-out collapsed to
one consolidated audit this cycle, owing to cycle time budget — full
fan-out resumes next cycle).
**Source:** Direct read of `apps/web/src/components/{photo-viewer,
info-bottom-sheet,lightbox-color-pip,wide-gamut-hint,color-details-section,
histogram,home-client}.tsx` + `lib/download-filename.ts` + `globals.css`.

## Strict scope reminder

Color/HDR/EXIF/gallery/share/topic/SEO/i18n/admin/upload/processing/serving/
perf/a11y/security/copyright/metadata/licensing/download/embed/Lightroom-publish
surfaces are IN scope. Any edit / star / cull / scoring / pick-flag / adjust
ideas are OUT of scope and must be discarded.

## Findings

### R16-M1 (MEDIUM, High confidence) — Mobile download filename ignores `buildDownloadFilename`
- **File:** `apps/web/src/components/info-bottom-sheet.tsx:350,360,373,569,579,592`
- **Failure:** R12-M2 added `buildDownloadFilename(title, id, ext)` and wired
  it into the desktop `photo-viewer.tsx` download anchors, but the mobile
  `info-bottom-sheet.tsx` was NOT migrated. Mobile users still receive raw
  `photo-{id}.{ext}` filenames. Wedding/event recipients downloading 8-12
  favorites on phones end up with indistinguishable files in their Downloads
  folder, defeating the R12-M2 purpose.
- **Fix sketch:** Import `buildDownloadFilename`, compute `downloadNameJpeg`
  / `downloadNameAvif` once in the component body using the same shape as
  photo-viewer.tsx (lines 206-209), then replace all 6 `download=` literals
  in the bottom sheet with the slug-form name.

### R16-L1 (LOW, High confidence) — Tab-then-space indent in `histogram.tsx`
- **File:** `apps/web/src/components/histogram.tsx:645`
- **Failure:** The `<button>` className line is indented with a TAB followed
  by spaces, breaking visual consistency with the surrounding spaces-only
  indentation. Lint may not catch this if `.editorconfig` allows tabs, but
  it's still a smell on a touched line.
- **Fix sketch:** Re-indent line 645 with spaces only, matching surrounding
  lines.

### R16-L2 (LOW, Medium confidence) — Lightbox color-pip tooltip button below touch-target floor
- **File:** `apps/web/src/components/lightbox-color-pip.tsx:166`
- **Failure:** The DCI-P3 Bradford tooltip inside the lightbox pip uses
  `min-h-6 min-w-6` (24 px), well below the WCAG 2.5.5 / Apple HIG / Google
  44 px floor that the rest of the codebase enforces. The repo's
  `touch-target-audit.test.ts` doesn't catch this because the file is not
  in `KNOWN_VIOLATIONS` and the test pattern targets `<Button>` / explicit
  `h-8/h-9` Tailwind classes — `min-h-6` slips through.
- **Fix sketch:** Switch to `min-h-11 min-w-11`. The visual icon stays at
  `h-3 w-3` for compactness; only the hit zone enlarges. The lightbox pip
  already has the surrounding `bg-black/80` panel so the larger hit zone
  doesn't disrupt the visual rhythm.
- **Note:** The Copy button on line 200-208 also lacks a `min-h-11` on the
  anchor element. Same fix shape applies.

### R16-L3 (LOW, High confidence) — Masonry fallback path missing `decoding="async"`
- **File:** `apps/web/src/components/home-client.tsx:317-327`
- **Failure:** The primary masonry `<img>` (line 303-312) carries
  `decoding="async"` to avoid blocking the main thread during scroll. The
  fallback `OptimisticImage` path (line 317-327, used when a `_${smallSize}`
  derivative is missing — typically legacy photos) does NOT pass a
  `decoding` hint, so legacy photos can still cause scroll jank.
- **Fix sketch:** `OptimisticImage` accepts arbitrary `<img>` props; pass
  `decoding="async"` through. If the component doesn't already accept it,
  add a one-line prop pass-through.

### R16-L4 (LOW, Medium confidence) — `WideGamutHint` aria-live not announced
- **File:** `apps/web/src/components/wide-gamut-hint.tsx:112-134`
- **Failure:** The hint is `role="status"` which Apple VoiceOver and
  NVDA treat as polite live regions, but the hint is only mounted AFTER
  hydration (the `setMounted(true)` effect). For screen reader users
  navigating to the photo viewer, the hint appears asynchronously and
  the live-region announcement happens at an unpredictable time relative
  to the photo's other content. Adding `aria-live="polite"` explicitly
  documents intent and gives Firefox NVDA users a more reliable
  announcement (some NVDA configurations don't auto-announce `role=status`
  on initial mount).
- **Fix sketch:** Add `aria-live="polite"` and `aria-atomic="true"`
  attributes to the outer `<div role="status">`. Defensive — does not
  change behavior on browsers that already treat `role=status` as live.

## Out-of-scope / discarded

None. No reviewer proposed edit / cull / score / adjust features under
the REVIEW FRAMING constraint.

## Coverage notes

This cycle's review consolidated into one pass focusing on:
- Component download wiring (R12-M2 follow-through)
- Touch target / a11y polish on lightbox/pip surfaces
- Indentation hygiene on cycle-6 touched files

The next cycle should resume the full reviewer fan-out
(code-reviewer / perf-reviewer / security-reviewer / critic / verifier /
test-engineer / tracer / architect / debugger / document-specialist /
designer) and aim for fresh ground (admin upload UX, share flows, RSS
feeds, OG image generation, Lightroom publish surface).

## Existing backlog (R10..R15) — not re-reviewed this pass

See:
- `.context/plans/photographer-r10/README.md`
- `.context/plans/photographer-r11/README.md`
- `.context/plans/photographer-r12/README.md`
- `.context/plans/photographer-r13/README.md`
- `.context/plans/photographer-r14/README.md`
- `.context/plans/photographer-r15/README.md`

R10 backlog (HIGH still open): R10-C1, R10-H2, R10-H4 (full), R10-H5.
R10 backlog (MED still open): R10-M2, R10-M4, R10-M5, R10-M6, R10-M7,
R10-M11, R10-M12.
R10 backlog (LOW still open): R10-L3, R10-L8, R10-L19, R10-L20.
