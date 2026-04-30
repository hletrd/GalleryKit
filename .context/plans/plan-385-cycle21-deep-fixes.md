# Plan 385 — Cycle 21 Deep Fixes

**Created:** 2026-04-30 (Cycle 21 Deep Review)
**Status:** Done

## C21-AGG-01: `clampDisplayText` in OG route uses `.length`/`.slice()` — surrogate-pair unsafe

- **Source**: `apps/web/src/app/api/og/route.tsx:20-24`
- **Severity/Confidence:** LOW / MEDIUM
- **Issue**: `clampDisplayText` uses `value.length` and `value.slice(0, maxLength - 1)` for truncation. Topic labels and tag names may contain CJK/emoji characters. A supplementary character at the truncation boundary would be split by `.slice()`, producing a U+FFFD replacement character in the OG image text rendered by Satori.
- **Implementation**:
  1. Import `countCodePoints` from `@/lib/utils` in `apps/web/src/app/api/og/route.tsx`
  2. Replace `trimmed.length <= maxLength` with `countCodePoints(trimmed) <= maxLength`
  3. Replace `trimmed.slice(0, maxLength - 1).trimEnd()` with a codepoint-safe truncation that uses `Array.from(trimmed).slice(0, maxLength - 1).join('').trimEnd()`
  4. Add a test in `apps/web/src/__tests__/` for `clampDisplayText` with supplementary characters
- **Progress**: [x] implementation

## C21-AGG-02: `exportImagesCsv` GROUP_CONCAT separator uses `', '` — defensive improvement

- **Source**: `apps/web/src/app/[locale]/admin/db-actions.ts:68`
- **Severity/Confidence:** LOW / LOW
- **Issue**: The `GROUP_CONCAT` in `exportImagesCsv` uses `SEPARATOR ', '` which differs from the more robust `\x01` approach in `getImageByShareKey`. Currently safe because `isValidTagName` rejects commas, but inconsistent with the data.ts pattern.
- **Plan**: For consistency and future-proofing, align the CSV export with the data.ts `\x01` separator pattern. Split on `\x01` before CSV-escaping each tag name.
- **Progress**: [x] implementation

## C21-AGG-03: `exportImagesCsv` type-unsafe GC hint (informational)

- **Status**: Informational only — no code change needed.

## Deferred Items (no change from plan 384)

All previously deferred items remain deferred with unchanged status:

- A17-MED-01: data.ts god module — deferred (exit criterion: dedicated refactoring sprint)
- A17-MED-02: CSP style-src 'unsafe-inline' — deferred (exit criterion: nonce-based inline style migration)
- A17-MED-03: getImage parallel DB queries — deferred (exit criterion: UNION query optimization)
- A17-LOW-04: permanentlyFailedIds process-local — deferred (exit criterion: multi-instance coordination layer)
- C14-MED-03: createGroupShareLink BigInt coercion risk — mitigated by safeInsertId (C20-MED-01)
- C14-LOW-02: lightbox.tsx showControls callback identity — deferred (exit criterion: performance profiling shows re-render impact)
- C14-LOW-03: searchImages alias branch over-fetch — deferred (exit criterion: query cost profiling)
- AGG6R-06: Restore lock complexity — deferred (exit criterion: simplification audit)
- AGG6R-07: OG tag clamping — deferred (exit criterion: OG metadata standardization)
- AGG6R-09: Preamble repetition — deferred (exit criterion: documentation consolidation)
