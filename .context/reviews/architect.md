# Architect — Cycle 9

## C9-AR-01 (Low): Advisory lock name strings not centralized

**File+line**: Multiple files (see C9-SR-01)

Lock names are scattered as string literals. A central constant registry would reduce the risk of accidental name collisions and make it easier to audit lock scope (as noted in C8R-RPL-06 / AGG8R-05).

**Confidence**: Low (maintainability, not correctness)
**Fix**: Extract lock names to a shared constants module.

## C9-AR-02 (Low): `data.ts` trending toward 1500-line threshold

**File+line**: `apps/web/src/lib/data.ts`

Currently ~1240 lines. The deferred D2-MED item notes the 1500-line threshold. No new lines were added this cycle that push it closer significantly, but the trend continues.

**Status**: Already deferred as D2-MED/D3-MED.
