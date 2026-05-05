# Tracer — Cycle 12 (Run 2)

**Date**: 2026-05-05
**Scope**: Causal tracing of suspicious flows and competing hypotheses
**Method**: Traced execution paths through semantic search, rate-limit gates, and image processing

## Flow 1: Lint Gate Bypass

**Hypothesis**: A developer could accidentally satisfy `check-public-route-rate-limit.ts` without wiring active rate limiting.
**Trace**:
1. Developer creates new public route with `POST` handler.
2. Developer copies a rate-limit helper call from another file, comments it out during debugging.
3. `findRouteFiles` discovers the file.
4. `mutatingHandlers` detects `POST`.
5. `withoutStrings` strips string literals but leaves the comment: `// preIncrementFoo(`.
6. `usesPrefixHelper` regex matches `\bpreIncrementFoo\s*\(` → true.
7. Gate passes. CI is green.
8. Route ships unmetered.
**Conclusion**: Hypothesis confirmed. The bypass is real and trivial.
**Finding**: code-reviewer C12-LOW-01 / security-reviewer C12-SEC-01.

## Flow 2: Semantic Search Body Guard Bypass

**Hypothesis**: A malformed Content-Length header bypasses the body-size guard.
**Trace**:
1. Attacker sends `POST /api/search/semantic` with `Content-Length: NaN`.
2. `request.headers.get('content-length')` returns `"NaN"`.
3. `Number.parseInt("NaN", 10)` returns `NaN`.
4. `NaN > 8192` evaluates to `false`.
5. Guard skipped. `request.json()` executes.
6. Rate limit fires afterward (if over budget), but the body has already been parsed.
**Conclusion**: Hypothesis confirmed.
**Finding**: code-reviewer C12-LOW-02 / security-reviewer C12-SEC-02.

## Flow 3: High-Bitdepth AVIF Probe Race

**Hypothesis**: Two concurrent image-processing jobs can produce different probe outcomes.
**Trace**:
1. Process restarts. `_highBitdepthAvifProbed = false`.
2. Job A (wide-gamut image) enters `processImageFormats`.
3. Job B (wide-gamut image) enters `processImageFormats` concurrently.
4. Both call `canUseHighBitdepthAvif()` → returns `!!sharp.versions.heif` (true).
5. Job A tries `bitdepth:10` → succeeds → calls `markHighBitdepthAvifAvailable()`.
6. Job B tries `bitdepth:10` → fails (transient Sharp error) → calls `markHighBitdepthAvifUnavailable()`.
7. Final state: `_highBitdepthAvifAvailable = false`.
8. All subsequent images use 8-bit AVIF despite 10-bit being viable.
**Conclusion**: Hypothesis confirmed. Non-deterministic first-batch quality.
**Finding**: code-reviewer C12-LOW-04 / debugger C12-DEBUG-01 / architect C12-ARCH-01.

## No Other Suspicious Flows

- The semantic search rate-limit rollback paths (Pattern 2) are correctly wired after R2C11.
- The lightbox focus restoration path is now guarded and safe.
