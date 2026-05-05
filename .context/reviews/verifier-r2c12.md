# Verifier — Cycle 12 (Run 2)

**Date**: 2026-05-05
**Scope**: Evidence-based correctness check of stated behavior against implementation
**Method**: Cross-referenced docstrings, comments, and CLAUDE.md claims with actual code

## Finding C12-VERIFY-01: `check-public-route-rate-limit.ts` docstring claims gate prevents silent unmetered routes, but comment bypass is possible

- **File**: `apps/web/scripts/check-public-route-rate-limit.ts`, lines 1-18
- **Claim**: "A future PR that adds a fourth public-mutating route must consciously opt out of rate limiting (with a documented reason) or wire in the Pattern 2 rollback helpers, instead of silently shipping an unmetered public mutation surface."
- **Evidence**: The prefix check (lines 136-139) does not strip comments. A commented-out helper call satisfies the regex. Therefore the gate does NOT enforce the stated claim — a route CAN silently ship unmetered if the developer leaves a commented-out helper in the file.
- **Fix**: Harden the prefix check to strip comments, matching the import-check pattern.
- **Severity**: Low | **Confidence**: High

## Finding C12-VERIFY-02: `bounded-map.ts` docstring over-promises automatic cap enforcement

- **File**: `apps/web/src/lib/bounded-map.ts`, lines 27-29
- **Claim**: "automatically prunes expired entries and evicts oldest entries when the hard cap is exceeded."
- **Evidence**: The `set()` method (lines 64-67) only adds entries. Eviction only happens inside `prune()`. The class does not "automatically" enforce the cap on write.
- **Fix**: Update the docstring to clarify that consumers must call `prune()` before operations, or enforce the cap in `set()`.
- **Severity**: Low | **Confidence**: High

## Verified Correct Behaviors

- Semantic search rate-limit reordering (R2C11-MED-01): verified that rate-limit increment is after all cheap validation gates and rollback is called on every early-return path. Correct.
- Lightbox focus restoration guard (R2C11-LOW-04): verified `document.body.contains()` guard is present. Correct.
- ImageZoom touch-action (R2C11-LOW-02): verified `touchAction: isZoomed ? 'none' : 'auto'` is present. Correct.
- viewCountRetryCount prune mutual exclusivity (R2C11-LOW-05): verified `else if` at line 146. Correct.
