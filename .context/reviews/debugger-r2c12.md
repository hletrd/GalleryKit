# Debugger — Cycle 12 (Run 2)

**Date**: 2026-05-05
**Scope**: Failure modes, error-handling paths, race conditions, and latent bug surfaces
**Method**: Traced error paths through recently changed code and critical infrastructure

## Finding C12-DEBUG-01: High-bitdepth AVIF probe race on first concurrent batch

- **File**: `apps/web/src/lib/process-image.ts`, lines 49-66
- **Cross-reference**: code-reviewer C12-LOW-04, architect C12-ARCH-01
- **Failure mode**: When the queue processes its first batch after restart with `QUEUE_CONCURRENCY > 1`, multiple workers can simultaneously enter the unprobed state. One worker's `try bitdepth:10` may succeed while another's fails. The loser calls `markHighBitdepthAvifUnavailable()`, which permanently downgrades the process to 8-bit AVIF even though 10-bit was viable. This is a silent quality regression — no error is logged, and the output is merely lower bitdepth.
- **Trigger conditions**: (1) Process restart, (2) first batch has 2+ concurrent jobs, (3) at least one source image is wide-gamut (triggers the probe path).
- **Reproduction difficulty**: Medium — requires specific queue concurrency and wide-gamut source images.
- **Fix**: Serialize the probe via a Promise-based singleton.
- **Severity**: Low | **Confidence**: Medium

## Finding C12-DEBUG-02: Semantic search route does not log on Content-Length bypass

- **File**: `apps/web/src/app/api/search/semantic/route.ts`, line 76
- **Failure mode**: When the Content-Length guard is bypassed (see C12-LOW-02), the route proceeds silently. There is no logging of malformed headers, making it hard to detect probing attacks in production logs.
- **Fix**: Log a warning when the Content-Length header is present but non-finite, or fix the validation so malformed headers are rejected with 400 and logged.
- **Severity**: Low | **Confidence**: Medium

## No New Regressions

- R2C11 fixes (rate-limit reorder, touch-action, lightbox focus) are all correct and do not introduce new failure modes.
- The viewCountRetryCount prune path (R2C11-LOW-05) is now correctly mutually exclusive.
