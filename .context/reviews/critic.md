# Critic — Cycle 3 Deep Review (2026-04-27)

**HEAD:** `9958152 docs(reviews): record cycle-2 fresh review findings and plan`

## Multi-Perspective Critique

### Overall Assessment

The GalleryKit codebase demonstrates strong engineering across multiple dimensions. This cycle's deep review found no critical or high-severity issues. The codebase shows consistent patterns:

- **Defense-in-depth**: Auth checks are layered (middleware + action + origin guard)
- **Consistent validation**: Sanitize-before-validate pattern is applied uniformly
- **Rate limiting**: All public and admin surfaces are covered with pre-increment patterns
- **Privacy**: Compile-time guards prevent accidental PII leakage

### Areas for Improvement

| ID | Finding | Severity | Confidence |
|---|---|---|---|
| C3-C01 | Rate-limit eviction boilerplate is duplicated across 7 Maps with near-identical FIFO eviction logic. A shared `BoundedMap` abstraction would reduce ~200 lines of copy-paste code and prevent drift when new rate-limited endpoints are added. | Low | High |
| C3-C02 | `exportImagesCsv` memory profile peaks at ~15-25MB for 50K rows. The incremental builder is better than naive concatenation, but a streaming response would be more robust for large galleries. | Low | Medium |
| C3-C03 | The `UNICODE_FORMAT_CHARS` regex literal in `validation.ts` and `csv-escape.ts` is duplicated. The regex uses literal Unicode codepoints that display differently across editors. Both files should import from a single source, and the regex should have a U+XXXX notation comment. | Info | High |
| C3-C04 | `getImage` prev/next navigation queries are complex NULL-safe OR chains. The `sql\`FALSE\`` literal for undated-photo next-image queries is correct but fragile — a future contributor could replace it with an incorrect NULL-safe comparison. The comment should be more prominent. | Info | Medium |

### Cross-Cutting Observations

1. **Consistency is excellent**: Every mutating server action follows the same pattern (auth check, origin check, maintenance check, validation, operation, audit log, revalidation). This is a major strength.

2. **Test surface is broad**: 35+ test files cover core logic, auth, data layer, and lint-based architectural invariants. The AST-based scanning tests (touch-target-audit, check-action-origin, check-api-auth) are particularly strong.

3. **Documentation-code alignment**: CLAUDE.md accurately reflects the codebase. The advisory-lock scope note, single-writer topology assumption, and view-count approximation caveat are all correctly documented.

4. **No security regressions**: All prior-cycle security controls remain intact. No new attack surfaces were identified.
