# Debugger Review — Run-2 Cycle 1 (HEAD eaee58dc)

Angle: latent bugs, failure modes, async pitfalls, race/shared-state, resource leaks. Faithful-delivery surface.

## DBG-01 — Backfill: transient detection failure permanently strands stale color metadata (MED, High confidence)

**File:** `apps/web/src/lib/admin-backfill-runner.ts:217-263`.

Trace: `reprocessOne` re-encodes (succeeds), then `detectColorSignals` throws (transient: corrupt-but-readable original, ICC parse hiccup, OOM during a parallel detection, restore flips DB mid-detect). The catch at line 234 sets `signals = null`. The `else` branch (253-263) then UPDATEs `pipeline_version = 7` anyway.

**Failure mode:** because backfill candidate selection is `WHERE pipeline_version < 7` (line 152/164), bumping the version means this row is NEVER re-picked by any future backfill — its color columns (`icc_profile_name`, `color_primaries`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, `color_pipeline_decision`) keep their pre-backfill values forever, even though the whole point of the backfill was to refresh them with current detection logic. A one-off transient error = permanent stale metadata, with no surfaced signal (only a `console.warn`).

**Cross-check vs the script:** `backfill-color-pipeline.ts` does the OPPOSITE on detection failure — `reprocessRow` returns `{ outcome: 'processed' }` with `signals: undefined`; `flushBatch` only pushes rows that have `signals`, so the version is NOT bumped and the row is re-picked next run. So the two backfill paths have OPPOSITE recovery semantics for the same failure. Confirmed divergence (also CR-03 / ARCH-01).

**Fix:** in the runner, do NOT advance `pipeline_version` when `signals === null` — re-encode is idempotent, so leaving the row at its old version lets a later run retry detection. Optionally record the row id in `state.lastError` summary for visibility.

## DBG-02 — Non-atomic `processed++` / `errors++` under ADMIN_BACKFILL_CONCURRENCY > 1 (LOW, High confidence)

**File:** `admin-backfill-runner.ts:301-318`.

`processed` and `errors` are plain closure variables incremented inside PQueue tasks. JS is single-threaded so the increments themselves are atomic, but the `if (processed % 25 === 0)` progress log (line 316) can be hit zero or multiple times under interleaving, and the final `processed=X errors=Y` log can momentarily reflect a value that doesn't equal `candidates.length` if a task is still settling. These are log-only artifacts (no DB/state correctness impact). Default concurrency is 1, so this only manifests if an operator raises `ADMIN_BACKFILL_CONCURRENCY`. Cosmetic; no fix needed but worth a note.

## DBG-03 — Restore-maintenance abort mid-backfill silently advances nothing but leaves the lock held until queue drains (LOW, Medium confidence)

**File:** `admin-backfill-runner.ts:303-322`.

When `isRestoreMaintenanceActive()` flips true mid-run, each remaining queued task returns early (line 305-308) WITHOUT processing. Good — no DB writes race the restore. But the advisory lock + lock connection are held until `queue.onIdle()` resolves (all queued no-op tasks drain). For a large candidate list this is a fast drain (each task just checks the flag and returns), so the lock is released promptly via the `finally` (line 329-332). No leak — the R29-CRIT-1 fix correctly guarantees release. Confirmed NOT a leak; recorded because the interaction is non-obvious. The aborted rows correctly stay at `pipeline_version < 7` so the next post-restore backfill re-picks them.

## DBG-04 — `wide-gamut-hint` localStorage stores a SINGLE dismissed gamut; dismissing a second family overwrites the first (LOW, Medium confidence)

**File:** `apps/web/src/components/wide-gamut-hint.tsx:36-66, 118-147`.

`PersistedDismiss` is a single `{ gamut, expiresAt }` record. On a share route (`persistDismissal=true`), if a recipient dismisses the hint for a `p3` photo then navigates to a `rec2020` photo in the same gallery and dismisses that, `writeLocalDismiss('rec2020')` overwrites the `p3` dismissal. Returning to a `p3` photo re-shows the hint. This matches the sessionStorage behavior (also a single value) so it's internally consistent, and the re-nag is mild (one extra dismiss). LOW. Optional fix: store a `Record<gamutFamily, expiresAt>` map.

## Confirmed-safe (traced, no bug)
- `triggerAdminBackfill` lock handoff (`admin-backfill-runner.ts:350-385`): `lockConn = null` after handoff prevents double-release in the catch; the fire-and-forget `.catch()` swallows synchronous rejection; `acquireBackfillLock` releases on its own throw. R29-CRIT-1 fix is complete and correct.
- `lightbox.tsx` keydown effect: cleanup removes the listener; deps array complete.
- `icc-chromaticity.ts`: `invert3x3` guards `|det| < 1e-12`; `xyzToXy` guards sum≈0; `readChadMatrix`/`readXyzTag` bounds-check offsets. Malformed ICC → null → caller falls through to ICC-name heuristic. Solid.
