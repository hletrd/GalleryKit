# Run-4 Cycle 7 — test-engineer angle

## Gate baseline (clean tree, before any cycle-7 change)
- vitest: **1675/1675 PASS** (174 files)
- typecheck: PASS · eslint: 0 errors / 0 warnings
- lint:api-auth / lint:action-origin / lint:public-route-rate-limit: PASS
- build / e2e: run during PROMPT 3 after fixes (per established cycle
  convention).

## Coverage-gap findings (TEST-R4C7-05 — each folds into its parent fix)

### Download route method contract — zero coverage
- No test exercises `apps/web/src/app/api/download/[imageId]/route.ts`
  at the module level (existing suites cover `download-tokens` utils,
  `download-filename`, refund-clears-token action, and the ADMIN backup
  download route). Nothing pins:
  (a) the route exports an explicit `HEAD` that cannot claim,
  (b) GET performs NO claim (no `downloadedAt` write) after the fix,
  (c) POST is the only method containing the atomic claim UPDATE,
  (d) the interstitial HTML escapes the title and token attribute.
- Required with the fix: a **source-contract suite** (read the route
  file as text — same pattern as `sw-template-contract.test.ts` and
  `backup-download-route.test.ts`) pinning (a)-(c), plus **unit tests**
  for the extracted interstitial-HTML builder (escaping, no-claim
  purity) and for any extracted validation helper. Full route-module
  tests would need a mocked db/fs harness this repo deliberately avoids
  for route files — contract + unit split chosen, consistent with prior
  cycles.

### Smart-collection per-column operator enforcement — untested because unimplemented
- `smart-collections.test.ts` (196 lines) covers allowlist, depth,
  structural, scalar-enforcement, and IN-cap cases but has NO case for
  tag-column operator narrowing (the validator currently passes what the
  compiler throws on — COR-R4C7-03). Add validateNode rejection cases
  (`tag` × `gt/gte/lt/lte/between/in`) and acceptance cases
  (`tag` × `eq/contains`), plus a compile/validate AGREEMENT property:
  every AST accepted by validateNode must compile without throwing
  (regression-proofs the asymmetry class, not just the instance).

### upload-dropzone topic liveness — untested
- `createPendingUploadItems` is exported and unit-tested today; the
  topic-vs-tags liveness asymmetry (COR-R4C7-04) is closure behavior.
  After the topicRef fix, pin it with a source-contract assertion
  (route file text: `topicRef.current` consumed in `uploadFile`, ref
  synced from state) — jsdom-driving the full dropzone+sonner+router
  stack is brittle; contract test matches the repo's established pattern
  for hook-wiring pins (e.g. `images-action-blur-wiring.test.ts`).

## Flake & hygiene sweep
- e2e specs (public/admin/origin-guard/test-fixes/nav-visual-check):
  selectors are role/name-based; `expect.poll` used where focus settles
  asynchronously; no fixed sleeps found. No flake-suspect patterns.
- `ime-composition-guard.test.ts`, `lightbox-controls-contract.test.ts`,
  `sw-template-contract.test.ts` (cycle-6 additions) re-read: assertions
  are source-anchored and not over-fitted to incidental formatting
  (regexes tolerate whitespace). Good.
- No `xfail`-equivalent, no skipped tests in the suite (grep: 0 `.skip`).
