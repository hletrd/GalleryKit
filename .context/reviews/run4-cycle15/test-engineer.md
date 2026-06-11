# Run-4 Cycle 15 — test-engineer angle

Single-subagent in-context execution (documented run-wide constraint).
Pass over the cycle-15 rotation set's test coverage plus the gate
fixtures the scheduled fixes must extend.

## TEST-R4C15-01 — no lock on global-error theme-class detection — gap/High

`__tests__/error-shell.test.ts` covers `resolveErrorShellBrand`
exhaustively but the theme detection in `app/global-error.tsx` is
inline and untestable — which is exactly how COR-R4C15-01 (OLED class
missed) shipped and survived. Folds into the COR-R4C15-01 fix: extract
`resolveErrorShellThemeClass` and add cases — `oled` class → `'oled'`,
`dark` class → `'dark'`, both (defensive) → `'oled'` wins, neither →
`null`, no document → `null`.

## TEST-R4C15-02 — touch-target audit is structurally blind to two violation shapes — gap/High (CONFIRMED via tag-filter)

`__tests__/touch-target-audit.test.ts`:
1. `normalizeMultilineButtonTags` only collapses `<Button|button>`
   openings (`:388`), so multi-line `<Badge asChild …>` wrappers — whose
   className lands on the interactive child at runtime via Radix Slot —
   are never normalized into scannable single lines.
2. The FORBIDDEN set (`:231-285`) catches only `h-8`/`h-9`/`h-10`/
   `size-10` literals; arbitrary-value classes (`min-h-[32px]`,
   `min-h-[40px]`) match nothing.

`components/tag-filter.tsx:62,79` (`min-h-[32px]` chips) prove the gap
in production code. Fix-shape (folds into DES-R4C15-03): extend the
normalizer tag set to `Button|button|Badge`, add FORBIDDEN patterns for
sub-44 arbitrary `min-h-[NNpx]` (NN ≤ 43) on `<Button`, `<button`, and
`asChild` `<Badge` openings (mirroring the existing negative-lookahead
for `h-11|min-h-11|size-11` overrides), and add failing-fixture cases
to BOTH the violation-fixtures block (`:527`) and the compliant block
(`:621` — e.g. `min-h-11` chip, `min-h-[44px]`, non-asChild decorative
Badge with small min-h must NOT trip). Prove the new patterns fail
against the pre-fix `tag-filter.tsx` source before fixing the chips.

## TEST-R4C15-03 — map thumbnail URL derivation has no unit lock — gap/Medium

`map-client.tsx` is client-leaflet (jsdom-hostile), but the PERF-R4C15-02
fix introduces URL-derivation logic that can be locked the way the repo
locks other component contracts: a source-inspection fixture asserting
map-client imports `sizedImageUrl`/`imageUrl` from `@/lib/image-url`,
contains no raw `'/uploads/jpeg/' + …` interpolation, and that
MapLoader/MapClient props carry `imageSizes`. Lightweight, consistent
with `wide-gamut-predicate-wiring.test.ts` precedent (cycle 14).

## Coverage verified adequate (no action)

- `theme-resolve.test.ts` — covers `resolveTheme` × all stored values ×
  system signal and `nextTheme` cycling (including unknown input).
- `map-privacy.test.ts` — locks the GPS gating contract of
  `getMapImages` (JOIN condition + runtime guard).
- `error-shell.test.ts` — brand resolution branches (dataset, title
  segments, fallbacks).
- `sql-restore-scan` / `db-restore` / `bounded-map` /
  `upload-filenames` / `clip-embeddings` — existing suites confirmed
  present and meaningful (spot-validated assertions against current
  behavior; none assert stale behavior).
- Gain-map fixtures (cycle 14) — tmap+URN-positive case present;
  standalone-tmap-negative and tmap+auxl-positive locks intact.

## Flakiness sweep

No timers/network in the new-rotation unit surfaces; e2e specs
unchanged this cycle. Vitest baseline 184 files / 1759 tests green
(cycle-14 record); will re-run full gates in PROMPT 3.
