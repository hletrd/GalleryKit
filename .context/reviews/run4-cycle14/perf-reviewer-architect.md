# Run-4 Cycle 14 — perf-reviewer + architect angles

Same single-subagent constraint as previous run-4 cycles; this angle was
executed as a distinct full-inventory in-context pass.

## Inventory

Color/display client cluster from the perf + layering lens:
`use-display-capability.ts` (subscription fan-in), `histogram.tsx`
(canvas sizing, worker hand-off, P3 context decisions),
`color-details-section.tsx` / `lightbox-color-pip.tsx` render cost,
`wide-gamut-hint.tsx` storage I/O, `icc-chromaticity.ts` /
`gain-map-detection.ts` per-upload CPU cost, admin clients
(tag-manager, seo-client, analytics-client) render structure,
module-layering audit of `lib/color-primaries.ts` vs
`lib/color-detection.ts` client/server split.

## Perf findings

None blocking. Spot verifications:

- `useDisplayCapability` — single module-level snapshot cache shared by
  all subscribers; three MQ listeners + focus/visibilitychange per
  mounted hook instance. Mount counts are small (viewer surfaces), no
  leak (cleanup returns verified symmetrical). The snapshot value-compare
  prevents render storms on focus events that don't change state
  (each focus callback re-runs `detect()`, which returns the SAME
  reference when nothing flipped → `useSyncExternalStore` bails out).
  Sound.
- `histogram.tsx` — 256-px canvas cap honored before `getImageData`;
  `P3_CTX_OPTIONS` module constant reused (R15-L3); the
  `data-force-show-color-chips` DOM read is deliberately non-reactive
  (R29-MED-1 comment documents the remount trade-off). Worker receives
  a transferred buffer (no copy). Sound.
- `icc-chromaticity.ts` / `gain-map-detection.ts` — per-upload cost is
  O(tag table) / O(1 MB scan) respectively, both run once per upload on
  the queue worker, not per request. No churn.
- `color-details-section.tsx` — pure render component; the
  COR-R4C14-01 fix (swap two comparisons for a Set lookup) is
  perf-neutral.
- Admin clients — `analytics-client` renders bounded rows (data layer
  caps), `tag-manager` maps `initialTags` without memo (fine at admin
  scale).

## Architect findings

### ARCH-R4C14-01 (= COR-R4C14-01 root cause) — predicate-ownership erosion around `WIDE_GAMUT_PRIMARIES`

`lib/color-primaries.ts` was created (C3-A1 / C3-ARCH-MED-2) precisely
to own the wide-gamut predicate after an earlier drift incident, and its
docstring states the single-source-of-truth contract. The contract held
at 8 of 10 call sites; the 2 ad-hoc survivors (`color-details-section`
isNonTrivialColor + isWideGamut label gate; `info-bottom-sheet`
isNonTrivialColor) date from R10-L19/R13-L1 — features added AFTER the
helper existed, which re-derived the predicate locally instead of
importing it. Architectural remedy beyond the spot fix: the
source-fixture test should assert the ABSENCE of ad-hoc
`!== 'bt709'` comparisons in the two components (except the
delivered-row derivation if it is intentionally kept local), so the
next surface added to the viewer can't silently re-fork the predicate.
Concur with code angle's fix shape; this is the architecturally
complete version of it.

### Layering audit — clean
- `color-primaries.ts` remains import-clean (no fs/sharp); client
  components import it directly; `color-detection.ts` re-exports for
  server callers. Verified no client component imports
  `color-detection.ts` (which would drag `fs/promises` into the
  bundle): grep shows `actions/images.ts` (server) is the only
  `isWideGamutPrimary`-from-color-detection importer. Holds.
- `lightbox-color-pip.tsx` importing humanizers from
  `color-details-section.tsx` keeps one humanizer source — acceptable
  coupling (pure functions, no hook state crossing).
- `gain-map-detection.ts` / `icc-chromaticity.ts` are leaf modules with
  zero project imports — correct for binary parsers.

## Concurrency / shared-state audit (rotation surfaces)
- `_cachedSnapshot` (use-display-capability) is module-global mutable
  state shared across components — safe because all writers run on the
  main thread and the value is immutable-by-replacement.
- `wide-gamut-hint` storage races (two tabs dismissing concurrently)
  are last-writer-wins on a UX flag — acceptable by design.
- No new shared-state hazards found.

## Findings carried to aggregate
- ARCH-R4C14-01 folds into COR-R4C14-01 (fix + drift-lock test).
- No perf findings scheduled.
