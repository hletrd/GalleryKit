# Test-Engineer Review — Run-3 Cycle 1 (HEAD 2508f132)

Date: 2026-06-04
Method: direct orchestrator review (Task-based subagent fan-out unavailable in
this nested execution context — `No such tool available: Task`, identical
constraint hit in run-2 cycles 1-4). Every angle executed directly, one
provenance file per angle.

## Baseline

- `npm test --workspace=apps/web`: observed NON-DETERMINISTIC results across
  three runs this cycle:
  - background run #1: `2 failed | 1479 passed (1481)` — failures in
    `serve-upload.test.ts:25` and one sibling.
  - synchronous run #2: `1 failed | 1480 passed (1481)`.
  - synchronous run #3 (after first re-run): `156 passed (156) / 1481 passed`.
- `npm run lint`: 0 errors (exit 0).

The intermittent failures are the headline finding below.

## F1 — Vitest discovers stale test copies under `.next/standalone/` (FLAKY GATE) — HIGH, High confidence

**Files:** `apps/web/vitest.config.ts` (no `exclude` key);
`apps/web/.next/standalone/apps/web/src/__tests__/*.test.ts` (156 gitignored
build-artifact copies).

**Evidence:**
- `apps/web/.next/standalone/apps/web/src/__tests__/serve-upload.test.ts`
  exists (dated 2026-05-30) and is gitignored — it is a copy emitted by
  `next build` with `output: 'standalone'`, which bundles source files.
- A bare `npx vitest run src/__tests__/serve-upload.test.ts` (no `--root`)
  resolved to `apps/web/.next/standalone/apps/web/src/__tests__/serve-upload.test.ts`
  and ran **10 tests across 2 files**, all failing:
  `Error: Cannot find package '@/lib/serve-upload' … Serialized Error:
  { code: 'ERR_MODULE_NOT_FOUND' }`. The `@/` alias does not resolve inside the
  standalone tree.
- The same invocation with explicit `--root "$(pwd)"` ran **1 file / 5 tests,
  all passing.** Root detection is the discriminator.

**Why it's a problem:** `vitest.config.ts` defines
`include: ['src/__tests__/**/*.test.ts']` but **no `exclude`**, so it inherits
vitest defaults (`node_modules`, `dist`, `.idea`, `.git`, `.cache`) which do
**NOT** include `.next`. The cycle GATES run `npm run build` (creates
`.next/standalone/.../src/__tests__/*.test.ts`) AND `npm test`. Depending on
vitest's project-root resolution at invocation time (sensitive to CWD and
whether a positional filter is passed), the standalone copies can be discovered
and executed, failing with `ERR_MODULE_NOT_FOUND`. This makes the test gate
non-deterministic: green on a clean tree, red after a build, and the failure
points at a phantom path that does not exist in source control — maximally
confusing for triage.

**Failure scenario:** Orchestrator (or developer) runs `npm run build` then
`npm test`; OR runs a single-file vitest filter for debugging after a build.
The suite fails with 5-10 spurious `ERR_MODULE_NOT_FOUND` errors in
`serve-upload.test.ts` / sibling files that are 100% green in the real tree.
CI flakiness, wasted triage, and a real risk of a "fix" being applied to the
wrong (source) file.

**Fix:** Add an explicit `exclude` to `vitest.config.ts` that preserves the
vitest defaults and adds the build-output dirs:

```ts
import { configDefaults } from 'vitest/config';
// ...
test: {
    include: ['src/__tests__/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/.next/**', '.next/**'],
    testTimeout: 15000,
},
```

Zero downside: `.next` is a gitignored build artifact; no real test lives there.

## F2 — No test coverage for `/api/admin/lr/upload` route — MEDIUM, High confidence

**File:** `apps/web/src/app/api/admin/lr/upload/route.ts` — grep across
`apps/web/src/__tests__/` for `lr/upload`, `X-GalleryKit-Token`,
`allowTokenScope.*upload` returns **zero** hits.

The Lightroom PAT upload route is a high-trust, cross-origin, token-authenticated
write surface (it bypasses same-origin, accepts multipart, inserts an image
row, enqueues processing). It has no unit/source-contract test. By contrast the
browser upload path, the Stripe webhook, the download-token route, and
`admin-tokens.ts` all have dedicated fixtures. A source-contract test (mirroring
`og-route-source-contracts.test.ts` / `stripe-webhook-source.test.ts`) should
at minimum lock: `runtime = 'nodejs'`, `withAdminAuth(..., { allowTokenScope:
'lr:upload' })` wrapping, topic-existence check, and the HDR-ingest gate once
F2-CODE (below) lands.

## Re-verified clean

- i18n EN/KO parity: 812/812 keys both directions, zero gaps (node flatten diff).
- Privacy field guard, migration drift, lock lifecycle, download single-use
  claim ordering: re-read, unchanged from run-2 cycle-4 verification.
