# Architect — Run-2 Cycle 2 (HEAD 317126cf)

Angle: architectural / design risk, coupling, layering.

## ARCH2-01 — Confirms cycle-1 DEF-01: a THIRD drift has appeared (the re-open trigger fired)

Cycle-1 DEF-01 ("unify the two backfill implementations") deferred the
extraction with this explicit exit criterion:

> re-open when a THIRD drift appears between the two paths, or when either
> backfill path needs a non-trivial logic change.

CR2-01 / DBG2-01 is that third drift: after AGG-01 (version-bump) and AGG-02
(avif_10bit success path), the detection-FAILURE branch is now the third place
the two implementations disagree on the persisted column set. Per the recorded
exit criterion, DEF-01 is now eligible to re-open.

**Assessment for THIS cycle:** the immediate, low-risk fix is to align the
script's detection-failure branch with the runner (CR2-01 fix). The full
shared-core extraction (DEF-01) remains a larger refactor touching the
production sidecar path; doing the targeted column-set alignment now plus a
contract test that locks BOTH branches' column sets is the proportionate move
and keeps the interim guard the cycle-1 plan promised. Recommend: schedule the
targeted fix this cycle; keep DEF-01 deferred but note the trigger has fired and
the NEXT structural change to either file should do the unification rather than
patch a fourth time.

## Verified clean
- Layering of `admin-backfill.ts` (server action) → `admin-backfill-runner.ts`
  (lib) → `process-image` / `color-detection`: clean, no upward dependency.
- The runner correctly does not touch the upload→processed PQueue claim
  invariant (it only selects `pipeline_version < CURRENT` processed rows).
