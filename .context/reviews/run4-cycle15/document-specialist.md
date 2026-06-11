# Run-4 Cycle 15 — document-specialist angle

Single-subagent in-context execution (documented run-wide constraint).
Doc-vs-code verification over the cycle-15 rotation set against
CLAUDE.md, module headers, and inline contract comments.

## Findings

### DOC-R4C15-01 — `global-error.tsx` theme handling contradicts the product's own theme contract — INFO/High (folds into COR-R4C15-01)

`lib/theme.ts` documents the canonical 4-value theme system
(`THEME_VALUES = ['system','light','dark','oled']`) and `globals.css`
documents `.oled` as a first-class theme ("OLED true-black theme …
WCAG AAA"). `global-error.tsx`'s `detectDarkMode` models a 2-theme
world. The COR-R4C15-01 fix makes the code match the documented theme
contract; no doc edit needed — cite `lib/theme.ts` THEME_VALUES in the
commit body.

### DOC-R4C15-02 — map-client thumbnail comment/code vs the R21-M1/R22-M1/R23-M1 documented idiom — INFO/High (folds into PERF-R4C15-02)

`components/search.tsx:39-48` documents the repo-wide sized-derivative
fallback contract ("Mirrors the R21-M1 (lightbox) and R22-M1
(per-photo viewer) fallback pattern"). The map popup predates/ignores
that contract. The fix brings the fourth thumbnail surface under the
documented idiom; the new `MarkerThumb` should cite R23-M1 in its
header comment.

## Verified consistent (no action)

- **CLAUDE.md "Storage Backend (Not Yet Integrated)"** ↔
  `lib/storage/types.ts` header ("Not all gallery storage currently
  goes through this interface … Do not assume every upload/serve path
  uses this abstraction yet"). Aligned.
- **CLAUDE.md upload-flow paths** ↔ `lib/upload-paths.ts` constants
  (`data/uploads/original` private root, `public/uploads/{avif,webp,jpeg}`
  public derivatives, legacy-dir guard). Aligned.
- **CLAUDE.md `lib/hdr-filenames.ts` "reserved for WI-09"** ↔ module
  header ("Currently unused in UI after P3-1"). Aligned.
- **CLAUDE.md touch-target policy section** ↔ audit implementation:
  the prose accurately describes pattern coverage and the
  KNOWN_VIOLATIONS mechanism. NOTE: after the DES-R4C15-03 audit
  extension lands, the CLAUDE.md "Pattern coverage" bullet list should
  gain one line for the new sub-44 arbitrary `min-h-[NNpx]` +
  `<Badge asChild>` patterns — scheduled as part of the fix plan
  (doc update in the same commit as the audit extension).
- **`bounded-map.ts` eviction semantics** ↔ CLAUDE.md ("bounded Maps
  with oldest-entry eviction when caps are exceeded"). Aligned.
- **`password-hashing.ts`** ↔ CLAUDE.md Argon2 claims. Aligned.
- **`sql-restore-scan.ts` pattern comments** (C5R-RPL-01, C3RPF-02,
  C4R-RPL2-05, C6-AGG6R-04, C1RPF-03 lineage) ↔ actual pattern list.
  Each cited pattern exists; no orphaned claims.
- **`download-interstitial.ts`** header (GET-interstitial / POST-claim
  rationale, form-without-action semantics) ↔ implementation. Aligned.
- **OBS-R4C14-A / DOC-R4C14-03 standing deferral** (audit prose
  narrates pre-lift Button defaults) — the DES-R4C15-03 audit edit
  touches the FORBIDDEN region of that file, which is the recorded
  exit criterion ("refresh on next audit edit"). The fix plan must
  refresh those two prose lines in the same commit, closing the
  deferred item.

## Doc sweep of remaining rotation files

`clip-inference.ts` stub disclaimers accurate (US-P51 deferral notes
match CLAUDE.md's "image_embeddings — CLIP embeddings (US-P51, stub)");
`color-pipeline-decisions.ts` enum/test cross-references resolve;
`image-types.ts` admin-only field comments match `_PrivacySensitiveKeys`
documentation; `not-found.tsx` / `(public)/layout.tsx` F-4/F-7/F-22
comments match shipped behavior.
