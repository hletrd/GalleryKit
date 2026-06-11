# Run-4 Cycle 14 — test-engineer angle

Same single-subagent constraint as previous run-4 cycles; executed as a
distinct full-inventory in-context pass.

## Inventory

Test-surface map for the rotation cluster: `__tests__/`
`color-details-section-delivered.test.ts`,
`color-details-primaries-match-icc.test.ts`,
`gain-map-detection.test.ts`, `icc-chromaticity.test.ts`,
`use-display-capability.test.ts`, `histogram.test.ts`,
`touch-target-audit.test.ts` (KNOWN_VIOLATIONS region), plus the
cycle-13 `topics-actions.test.ts` VALUES-pinning assertions.

## Findings

### TEST-R4C14-01 — accordion-label wide-gamut gating has NO test lock — gap / High

`color-details-section-delivered.test.ts` locks the Source / Delivered /
DeliveredFormats rows (C4-A5) and
`color-details-primaries-match-icc.test.ts` locks the dedup helper, but
NOTHING locks the R13-L1 dynamic accordion label
(`viewer.colorDetailsWithGamut{,Hdr}` selection) or the
`isNonTrivialColor` default-open heuristic. That is exactly why
COR-R4C14-01 shipped silently: the `'unknown'`-as-wide-gamut behavior
was introduced with the label feature and no fixture asserted the gate
predicate. Folds into the COR-R4C14-01 fix: extend the repo's
source-inspection fixture convention with assertions that
(a) both `color-details-section.tsx` and `info-bottom-sheet.tsx` import
`isWideGamutPrimary` from `@/lib/color-primaries`,
(b) the label gate and isNonTrivialColor primaries-arm call it, and
(c) no ad-hoc `color_primaries !== 'bt709'` comparison survives in
either file.
Note: per repo convention (documented in
`color-details-section-delivered.test.ts` header), component locks are
source-inspection fixtures, NOT React Testing Library renders — follow
it.

### TEST-R4C14-02 — gain-map fixture suite models only the auxl→tmap shape — observation / Medium

`gain-map-detection.test.ts` covers: urim+URN, tmap+auxl,
standalone-tmap-not-detected (R5-M3), auxl→non-urim/tmap negative, and a
v3-infe variant. It does NOT contain a real-device iOS 17/18 fixture,
so RISK-R4C14-03 (dimg-only shape) is untestable today. The synthetic
fixtures encode the DESIGNED contract faithfully — the gap is
fixture-acquisition (a real HEIC), not test authorship. Carried to the
deferred ledger with that exit criterion.

### Touch-target audit — premise drift noted (no action)

`touch-target-audit.test.ts` FORBIDDEN patterns + KNOWN_VIOLATIONS
comments describe `size="icon"` as "default 36 px", but
`components/ui/button.tsx:27` now ships `icon: "size-11"` (44 px) — the
exempted buttons in tag-manager/topic-manager/settings/seo are
real-44px-compliant and the exemption entries are conservative noise.
The audit remains self-consistent (scanner counts match the documented
counts) and fails correctly on NEW violations, so no change is
scheduled; recorded as OBS-R4C14-A in the deferred ledger so the next
touch-target edit refreshes the stale comments.

## Verified green baseline

Clean-tree vitest run executed this cycle (see gate log in plan doc) —
all files/tests green before any cycle-14 change. The cycle-13 VALUES
assertions execute and pass on current source.

## Flakiness sweep
No timer/random/network dependence in the rotation-cluster tests; the
display-capability tests reset the module-level snapshot cache via the
test-only export (`_resetDisplayCapabilityCacheForTesting`) — no
cross-test pollution observed.
