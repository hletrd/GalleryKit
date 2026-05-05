# Document Specialist — Cycle 12 (Run 2)

**Date**: 2026-05-05
**Scope**: Doc/code mismatches, stale comments, and documentation gaps
**Method**: Compared docstrings, inline comments, and README/CLAUDE.md against current implementation

## Finding C12-DOC-01: `bounded-map.ts` class docstring overstates automatic behavior

- **File**: `apps/web/src/lib/bounded-map.ts`, lines 27-29
- **Cross-reference**: verifier C12-VERIFY-02, code-reviewer C12-LOW-03
- **Mismatch**: The docstring says "automatically prunes expired entries and evicts oldest entries when the hard cap is exceeded," but `set()` does not trigger eviction. Only `prune()` does.
- **Fix**: Change to "Prunes expired entries and evicts oldest entries when `prune()` is called. Consumers should invoke `prune()` before reads and writes."
- **Severity**: Low | **Confidence**: High

## Finding C12-DOC-02: `check-public-route-rate-limit.ts` header comment should document the comment-stripping limitation

- **File**: `apps/web/scripts/check-public-route-rate-limit.ts`, lines 1-20
- **Gap**: The security-critical header comment explains the gate's purpose but does not mention that the prefix check operates on string-stripped content (which does not strip comments). A developer reading the file might assume the gate is robust against all forms of false positives.
- **Fix**: Add a note in the header comment: "NOTE: The prefix check scans string-stripped source and does not strip block/line comments. Do not rely on commented-out helper calls to satisfy this gate."
- **Severity**: Low | **Confidence**: Medium

## No Stale Comments Found

- All R2C11 fix comments are fresh and accurate.
- `process-image.ts` GPS stripping comment (R2C11-LOW-13) correctly says "best-effort only."
- Semantic search route docstring correctly documents Pattern 2 rollback posture.
