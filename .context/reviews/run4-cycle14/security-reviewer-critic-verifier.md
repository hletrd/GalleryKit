# Run-4 Cycle 14 — security-reviewer + critic + verifier angles

Same single-subagent constraint as previous run-4 cycles; this angle was
executed as a distinct full-inventory in-context pass.

## Inventory

Cycle-13 fix commit regression check from the security direction
(map_visible carry — privacy-relevant because `map_visible` gates the
public GPS `/map` surface); rotation surfaces from the security lens:
`actions/auth.ts` `updatePassword` (full), `password-form.tsx`,
`lib/seo-og-url.ts`, `i18n/request.ts`, the two binary parsers
(`icc-chromaticity.ts`, `gain-map-detection.ts`) as untrusted-input
attack surface, the public-field exposure of `color_primaries` /
`avif_10bit`, clipboard JSON copy paths in `color-details-section.tsx` /
`lightbox-color-pip.tsx`, localStorage/sessionStorage handling in
`wide-gamut-hint.tsx`.

## Security verification results

### Cycle-13 fix — privacy direction VERIFIED
Carrying `map_visible` through the rename preserves an explicit admin
opt-IN to GPS exposure. Direction check: the value carried is the
authoritative in-transaction row's value — an attacker cannot use a
rename to *escalate* a topic into map visibility (the carry is
identity-preserving, no form-controlled input feeds `map_visible` on
this path; the dedicated `updateTopicMapVisibility` action remains the
only writer). VERIFIED sound.

### updatePassword — hardening re-verified (clean)
- Same-origin check before any work (`hasTrustedSameOrigin`).
- Field-shape validation BEFORE the rate-limit pre-increment (C9R-RPL-01
  ordering intact) — typos don't consume attempts.
- Pre-increment before Argon2 verify (burst TOCTOU closed), DB-backed
  bucket with in-memory fallback, rollback on DB-detected exceedance.
- Code-point length counting (C20-AGG-01) — client `minLength={12}`
  counts UTF-16 units so a 6-emoji password passes the CLIENT and is
  rejected by the SERVER (safe direction; cosmetic-only mismatch).
- Full session rotation in one transaction (stolen-cookie invalidation).
No findings.

### Untrusted-input parsers (attack-surface pass) — clean
- `icc-chromaticity.ts`: attacker-controlled ICC buffer cannot OOB-read
  (every read pre-checked), cannot loop unboundedly (tag count capped at
  100, table capped at 4 KB), cannot NaN-poison the result (finite
  checks at every decode + det guard in `invert3x3`). Worst case:
  wrong-but-bounded gamut classification, which only feeds the encoder
  decision matrix toward P3 — never code execution or memory unsafety.
- `gain-map-detection.ts`: walk strictly advances (`size >= headerSize`
  enforced), depth ≤ 5, scan ≤ 1 MB, entry caps (1024) on iinf/iref
  loops, outer try/catch fail-closed to `false`. The COR-R4C14-02 dead
  branch (see code angle) has NO security consequence — it can only
  under-detect, and `has_gain_map` is admin-only metadata.

### COR-R4C14-01 — security/privacy framing
The `'unknown'`-primaries leak is a UI honesty defect, not an
information-disclosure one: `'unknown'` reveals only that the upload had
no recognizable profile, which the inner "Color primaries: Unknown" row
already (correctly) discloses. No PII, no fingerprinting value beyond
what the public field intentionally exposes. CONFIRMED as MED severity
on the photographer-intent surface (the product's core promise — the
gallery must not editorialize "unknown" into a gamut claim), not a
security finding. Fix direction (canonical helper) cannot widen any
public field.

### Clipboard JSON copy paths — verified intentional
Both copy buttons serialize fields already present in the client-side
`image` object (public viewers receive only public fields by
construction of `publicSelectFields`; admin-only fields are absent from
the serialized object rather than redacted at copy time).
`pipeline_version` remains excluded (R10-L16). No new exposure.

### Storage handling (`wide-gamut-hint.tsx`) — clean
`readLocalDismiss` shape-validates parsed JSON (typeof checks +
Number.isFinite + TTL expiry with removal), all storage ops wrapped in
try/catch for privacy-restricted modes. No injection sink (values are
compared, never rendered).

## Critic angle (whole-surface critique)

1. The cycle's headline finding (COR-R4C14-01) is the THIRD instance of
   the same structural failure mode found by this loop: a canonical
   helper/value-set exists, one surface bypasses it, and the bypass
   mis-handles a value added or specified later (lineage: tagNamesAgg
   raw-SQL alias drift → topics-recreate column omission → wide-gamut
   predicate drift). The fix must therefore include the
   drift-prevention test (source-fixture lock on `isWideGamutPrimary(`
   usage), not just the two-line gate change — matching how cycle 13
   pinned the rename VALUES.
2. The delivered-bit-depth row's local `!== 'bt709' && !== 'unknown'`
   derivation (color-details-section:454, lightbox-color-pip:207) is
   correct today but is the same predicate-triplication risk; the
   minimal fix should route it through `isWideGamutPrimary` too, since
   the expression is semantically identical.
3. RISK-R4C14-03 must NOT be "fixed" speculatively: widening heuristic 2
   to dimg without a real fixture risks false-positive gain-map labels
   (`tmap`-as-target dimg chains exist in non-HDR derived-image files),
   violating the audit-surface honesty rule in the opposite direction.
   Defer with a fixture-acquisition exit criterion is the right call.

## Verifier angle (evidence-based checks run)

- Verified `'unknown'` persistence end-to-end by code path (not
  assumption): `inferColorPrimaries(null) === 'unknown'` →
  `detectColorSignals` return (no null-out) → `images.ts:352` write →
  publicSelectFields inclusion → `ImageDetail` → component prop.
- Verified `humanizeColorPrimaries('unknown') === null` (switch has no
  'unknown' arm → default null) → `??` fallback selects the raw string.
- Verified EN/KO message catalogs: `viewer.colorDetailsWithGamut` =
  "Color: {gamut}" / "색상: {gamut}" — interpolation does not localize
  the injected value.
- Verified all 8 sibling call sites use `isWideGamutPrimary` (grep
  evidence in code-angle file).
- Verified vitest baseline green on the clean tree before any change
  (183 files / 1748 tests — run this cycle).

## Findings carried to aggregate
- COR-R4C14-01 (MED/High CONFIRMED — concur, with critic's scope note)
- COR-R4C14-02 (LOW/High CONFIRMED — concur)
- RISK-R4C14-03 (Low confidence — concur with defer-not-fix)
- No new security findings this cycle.
