# Run-4 Cycle 12 — designer angle

Distinct in-context pass (single-subagent constraint documented in
`_aggregate.md`). This cycle's designer scope: the admin DB backup/restore
surface (`app/[locale]/admin/(protected)/db/page.tsx`) — the UI adjacency of
the cycle's primary backend finding — plus a re-audit of standing deferred
UI items. Live-browser interaction was not exercised this cycle (the primary
finding is backend-deterministic and unit-provable; no UI change ships, so
no screenshot/a11y-snapshot delta exists to capture). Static analysis was
performed on the rendered component source; findings below are
text-evidence-based with exact selectors/lines.

## FINDINGS

### DES-R4C12-A — restore UI is correct, but the backend hang presents as an unbounded spinner (resolved by COR-R4C12-01; no UI change scheduled)
`db/page.tsx:28,183-201`: the restore form correctly uses
`useTransition` — submit disabled while `isPending`
(`disabled={isPending || !restoreFile}`), label swaps to
`t('restoreButtonProcessing')`. Under COR-R4C12-01 the server action never
settles, so `isPending` stays true forever: the admin sees an infinite
"Restoring…" state with no timeout, no error, and no retry affordance — and
because the wedge also blocks uploads, the admin's next instinct (open
another tab and upload) ALSO fails with a generic-looking error. This is a
textbook "backend hang surfaces as silent UI freeze" — the UI layer is
behaving correctly given its contract (server actions are expected to
settle); adding a client-side timeout would mask the real defect and create
false "failed" reports for legitimately slow large restores. Correct
resolution: the backend fix (scheduled). No UI change needed. Re-open
criterion: any future report of a restore spinner exceeding the documented
250 MB import worst-case with the backend fix in place.

## Standing deferred UI items re-audited (exit criteria un-triggered)
- DEF-R4C11-A (photo-navigation aria-live constant string): no
  `photo-navigation.tsx` change this cycle; remains deferred (plan-294).
- Histogram mode-cycle aria-label (since plan-286): no histogram change;
  remains deferred.
- DEF-R4C8-B (interstitial double-submit plain 410), DEF-R4C8-C (ImageZoom
  passive preventDefault), DEF-R4C8-D (`columns-${n}` safelist): surfaces
  untouched; remain deferred (plan-288).

## Sweep notes
- The restore section renders its result via the page's status region
  (success/error strings from the action result) — consistent with the rest
  of the admin surface; touch-target audit (44 px floor) is enforced
  suite-wide by `__tests__/touch-target-audit.test.ts` and passes on the
  clean tree (no new interactive elements this cycle).
