# Verifier — Cycle 1 (RPF, end-only deploy mode)

## Evidence-Based Correctness Verification

### Gates exercised this cycle
| Gate | Status | Evidence |
|---|---|---|
| `npm run lint` | PASS | exit 0 |
| `npm run typecheck` | PASS | typecheck:app and typecheck:scripts both green |
| `npm run lint:api-auth` | PASS | exit 0 |
| `npm run lint:action-origin` | PASS | exit 0 |
| `npm test` | PASS | 104 files, 900 tests, 0 failures |
| `npm run build` | PASS | Next.js production build succeeded |
| `npm run test:e2e` | NOT RUN | requires DB + dev server, not available in cycle env |

### C46-01 verification (cycle 46 finding)
**Claim:** `tagsString` length check now operates on a sanitized value.
**Method:** Read `apps/web/src/app/actions/images.ts:136-149`.
**Result:** `requireCleanInput(formData.get('tags')?.toString())` returns
`{ value, rejected }`. Code rejects on `rejected === true` and uses the
sanitized `value` for the `countCodePoints(...) > 1000` length check.
**Verdict:** FIXED.

### C46-02 verification (cycle 46 finding)
**Claim:** `searchImagesAction` length check now operates on a sanitized
query.
**Method:** Read `apps/web/src/app/actions/public.ts:154-160`.
**Result:** `const sanitizedQuery = stripControlChars(query.trim()) ?? '';`
runs first; the `countCodePoints(sanitizedQuery) > 200` length check uses
the sanitized value. Comment on line 158 explicitly cites C46-02.
**Verdict:** FIXED.

### Hooks vs claim parity
- The hook reported "exit 0" for typecheck but the actual exit was non-zero
  before deps were installed (TS2307 module-not-found because node_modules
  was missing). After `npm install`, typecheck passed cleanly. Both states
  are now consistent: typecheck green at HEAD with deps installed.

## Conclusion
All claimed fixes verified by code-reading and gate execution. No drift
between code, plan, and gate output detected.
