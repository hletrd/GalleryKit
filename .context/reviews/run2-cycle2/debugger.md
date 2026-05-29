# Debugger — Run-2 Cycle 2 (HEAD 317126cf)

Angle: latent bug surface, failure modes, regressions. Focus: cycle-1 fixes.

## DBG2-01 — Sidecar backfill silently no-ops the public `avif_10bit` write on detection failure (MED, High) ⭐ converges with code-reviewer CR2-01

Same root issue as CR2-01, from a failure-mode lens. The script's
detection-failure branch (`backfill-color-pipeline.ts:163-168`) is reachable
in production: `detectColorSignals` runs the bounded ISOBMFF walker + ICC tag
parse + sharp metadata on the ORIGINAL. Real-world originals that throw here:
- truncated/corrupt HEIF where the box walker hits a malformed length,
- an ICC tag table whose offsets exceed the profile length,
- sharp `metadata()` rejecting a damaged file that nonetheless re-encoded from a
  cached decode.

When that fires, the runner updates `avif_10bit`/`was_downscaled`; the script
updates nothing. The bug is *latent* because detection rarely throws — it will
not surface in the green test suite (no detection-failure fixture for the
script) and only manifests as a stale public chip on specific damaged-original
images after a sidecar run. Exactly the kind of low-frequency divergence that
the cycle-1 review flagged as the failure mode of "two ~80%-identical
implementations with no shared core" (cycle-1 ARCH-02 / DEF-01).

**Repro (unit):** stage an original, mock `detectColorSignals` to reject,
call `reprocessRow`. Today it returns `{ outcome: 'processed' }` with no signals
→ no UPDATE. Assert it should carry the derivative-only columns.

## Verified clean
- Detection-failure on the RUNNER side does NOT strand the row: `pipeline_version`
  stays behind (`:268-273`), so a later run re-detects. Confirmed correct
  (this is the cycle-1 AGG-01 fix, working as intended).
- No unhandled-rejection path in the fire-and-forget runner: `.catch` at
  `triggerAdminBackfill :386-388` + inner try/finally cover both sync and async
  throws.
- `isRestoreMaintenanceActive()` guard inside each queue task (`:316`) means an
  in-flight restore aborts remaining work gracefully without stranding the lock
  (finally still releases).
