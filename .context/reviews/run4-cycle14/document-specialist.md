# Run-4 Cycle 14 — document-specialist angle

Same single-subagent constraint as previous run-4 cycles; executed as a
distinct full-inventory in-context pass against CLAUDE.md, AGENTS.md,
module docstrings, and inline contract comments on the rotation
surfaces.

## Findings

### DOC-R4C14-01 — CLAUDE.md `isNonTrivialColor` definition vs code — mismatch CLOSED BY the COR-R4C14-01 fix — INFO / High

CLAUDE.md (Audit surface UI section) defines: "Default-open for
non-trivial color (`isNonTrivialColor` = wide-gamut OR HDR OR
non-`srgb` decision)". The code's primaries arm
(`color-details-section.tsx:170`, `info-bottom-sheet.tsx:184`) treats
`'unknown'` as wide-gamut, which contradicts the doc's term
("wide-gamut" is defined by `WIDE_GAMUT_PRIMARIES`, which excludes
`'unknown'`). The scheduled fix makes the code match the existing doc —
no CLAUDE.md edit needed. Direction note for the fix-commit body: cite
the doc sentence as the authoritative contract.

### DOC-R4C14-02 — `gain-map-detection.ts` R5-M3 comment overstates heuristic 1 — LOW / High (= COR-R4C14-02)

Lines 248-250 claim "Only flag `tmap` immediately when it carries the
Apple HDR gain-map URN" — but `parseInfe` never populates `itemUri`
for `tmap` entries, so the documented immediate-flag path cannot
execute. The scheduled one-line parser change makes the comment true
(preferred over rewording the comment, since the documented intent is
the better behavior). Module header ("including the auxl-iref-only
shape") stays accurate.

### DOC-R4C14-03 — touch-target audit comments describe pre-lift Button defaults — INFO / High (= OBS-R4C14-A)

`touch-target-audit.test.ts` narrates `size="sm"` as "default 32 px"
and `size="icon"` as "default 36 px", while `ui/button.tsx` now ships
`min-h-11` / `size-11` (44 px) for those variants. The audit's
behavior is unaffected (patterns still catch explicit small-class
overrides and the counts match), but the prose misleads a reader into
believing the exempted admin buttons are sub-44px when they are not.
Not scheduled (test-file prose churn alone); recorded in the deferred
ledger with the exit criterion "next edit to touch-target-audit.test.ts
refreshes the FORBIDDEN/exemption narration to the post-lift Button
defaults and re-evaluates whether the KNOWN_VIOLATIONS entries for
pure `size=\"icon\"` usages should be retired".

## Verified-accurate docs on rotation surfaces (no action)

- `use-display-capability.ts` header: layered detection order, SSR
  default, React #185 memoization note — all match code; CLAUDE.md's
  "Snapshot-memoized" warning matches implementation.
- `icc-chromaticity.ts` header (P4-A2, bounds, tolerance docs) and
  R28-CP-MED-2 chad narration — match implementation.
- `wide-gamut-hint.tsx` R28-HD-LOW-1 localStorage/sessionStorage split
  narration — matches code and CLAUDE.md's WideGamutHint description.
- CLAUDE.md browser-matrix table and Firefox consequences — consistent
  with `useDisplayCapability` behavior as read.
- `color-primaries.ts` single-source-of-truth docstring — accurate as a
  contract; the violation is in consumers (COR-R4C14-01), not the doc.
- `lightbox-color-pip.tsx` C5 dedup comment (HDR pill single-render) —
  matches the locked test.

## Cross-check with c13 deferred ledger
DOC-R4C13-01/02 exit criteria remain un-triggered (no CLAUDE.md edit
this cycle's review phase; the fix-commit body convention was honored
by 414a8e18).
