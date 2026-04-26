# tracer — Cycle 3 (HEAD `839d98c`, 2026-04-26)

## Causal trace: touch-target audit blind spot

1. Cycle 1 RPF loop introduced the per-file scanner walking SCAN_ROOTS.
2. Cycle 2 RPF loop added per-file `KNOWN_VIOLATIONS` and extended
   FORBIDDEN regex (AGG2-M02/M03).
3. The regex extensions assume `<Button>` openings are single-line: e.g.
   `(?![^>]*\b(?:h-1[12]|size-1[12])\b)[^>]*\bsize=["']icon["']` requires
   `[^>]*` to span the entire opening tag. With a line-by-line walker,
   `[^>]*` cannot match `\n`, so multi-line tags are never matched.
4. The fixture meta-test only feeds single-line synthetic snippets, so
   the gap is invisible to the test surface.
5. The codebase uses Prettier-default JSX formatting which writes
   multi-line `<Button>` for any tag with 3+ props. Result: most real
   Buttons are invisible to the audit.

## Hypothesis ranking

- **A (most likely):** Multi-line normalization missing. CONFIRMED by
  grep + manual reading of `upload-dropzone.tsx`, `admin-user-manager.tsx`.
- B: regex shape wrong. Rejected — patterns correct for single-line input.
- C: KNOWN_VIOLATIONS numbers wrong but scanner correct. Rejected —
  numbers match scanner output; scanner is the variable undercounting.

## Verdict

CR3-MED-01 root cause is the line-bounded scanner. Fix the scanner; the
regex set and KNOWN_VIOLATIONS map both work as intended afterwards.
