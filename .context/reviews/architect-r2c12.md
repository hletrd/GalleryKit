# Architect — Cycle 12 (Run 2)

**Date**: 2026-05-05
**Scope**: Design risks, coupling, layering, and maintainability of recent changes
**Method**: Structural analysis of module boundaries and abstraction leaks

## Finding C12-ARCH-01: High-bitdepth AVIF probe lacks encapsulation — global mutable state

- **File**: `apps/web/src/lib/process-image.ts`, lines 49-66
- **Problem**: The probe state (`_highBitdepthAvifProbed`, `_highBitdepthAvifAvailable`) is module-level mutable state with no encapsulation. This creates implicit coupling between concurrent `processImageFormats` calls. The state is also invisible to tests — there is no reset function, so tests cannot deterministically exercise both probe outcomes.
- **Design risk**: As the image processing pipeline grows (e.g., adding HEIC output, WebP-2, AVIF-AV1), more format-specific probes will accumulate. Each one will replicate the same pattern of global mutable state, leading to a "globals trap" in the processing module.
- **Fix**: Extract the probe into a small `FormatCapability` class or factory with a `probe()` method that returns a cached Promise. This encapsulates the state, makes it testable, and provides a reusable pattern for future format probes.
- **Severity**: Low | **Confidence**: Medium

## Finding C12-ARCH-02: Semantic search rate-limit helpers are now in `rate-limit.ts` but the route still imports them separately

- **File**: `apps/web/src/app/api/search/semantic/route.ts`, lines 28-31
- **Observation**: The semantic search rate-limit helpers (`preIncrementSemanticAttempt`, `rollbackSemanticAttempt`) were moved to `lib/rate-limit.ts` in R2C11 (addressing R2C11-LOW-09). However, the route imports them in a separate block from the `getClientIp` import. This is purely stylistic — not a bug — but the separation is unnecessary.
- **Note**: Not actionable; included for completeness only.

## No Structural Regressions

- The rate-limit module continues to cleanly separate Pattern 1/2/3 conventions.
- Data layer privacy guards (adminSelectFields / publicSelectFields) are correctly maintained.
- The lint gate infrastructure (`scripts/check-*.ts`) is well-factored and testable.
