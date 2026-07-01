# Cycle 79 Architect/Debugger/Tracer Review

HEAD reviewed: `9cc143d06f3b4f9fe1862316c0f449f745926829`.
Scope: architectural boundaries, race conditions, state consistency, restore/deploy/runtime topology, cross-file invariants, latent failure modes, and suspicious flows. No fixes implemented.

## Inventory

- Loaded project rules from `AGENTS.md` and `CLAUDE.md`; relevant invariants include single web-instance runtime topology, durable restore maintenance, advisory locks, deploy persistence boundaries, and blocking lint/type/test gates.
- Checked the prior baseline before reviewing: Cycle 78 scheduled four findings, including the runtime Docker `sharp` gap at `.context/reviews/cycle-78-2026-07-01/_aggregate.md:47`; the prior aggregate explicitly carried `C77-ARCH-01` as deferred rather than re-raising it at `.context/reviews/cycle-78-2026-07-01/_aggregate.md:57`.
- Reviewed the Cycle 78 deferred register. `C77-ARCH-01` remains a known deferred item with an unchanged exit criterion at `.context/plans/cycle-78-2026-07-01-deferred.md:12`; no new evidence in HEAD changes its failure mode or severity.
- Reviewed the Cycle 78 implementation delta at HEAD: `apps/web/Dockerfile`, `apps/web/scripts/check-public-route-rate-limit.ts`, `apps/web/src/__tests__/deploy-script-contract.test.ts`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`, and `apps/web/src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts`.
- Ran focused validation: `npm test --workspace=apps/web -- --run src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts src/__tests__/deploy-script-contract.test.ts` passed 3 files / 122 tests; `npm run lint:public-route-rate-limit --workspace=apps/web` passed all scanned public routes.

## High-Risk Trace: Runtime `sharp` Dependency Boundary

Claim traced: production runtime image should load `sharp` in every runtime path that needs it, not just during `next build`.

1. Runtime consumers really need native `sharp`: upload processing imports it at `apps/web/src/lib/process-image.ts:1`, topic cover processing imports it at `apps/web/src/lib/process-topic-image.ts:1`, CLIP image embedding imports it at `apps/web/src/lib/clip-model.ts:29`, admin backfill imports it at `apps/web/src/lib/admin-backfill-runner.ts:56`, and per-photo OG generation imports it at `apps/web/src/app/api/og/photo/[id]/route.tsx:4`.
2. Next intentionally keeps `sharp` external to the server bundle at `apps/web/next.config.ts:50`, so the final container must provide a working runtime `node_modules/sharp`.
3. The Docker build dependency stage still installs the Linux native packages for build-time use at `apps/web/Dockerfile:49` through `apps/web/Dockerfile:61`.
4. The separate production dependency stage now mirrors the runtime-critical packages and smokes the actual load: `npm ci --omit=dev --workspace=apps/web`, architecture mapping, explicit `@img/sharp-libvips-linux-${npm_arch}@1.2.4`, explicit `@img/sharp-linux-${npm_arch}@0.34.5`, and `node -e "require('sharp')"` at `apps/web/Dockerfile:63` through `apps/web/Dockerfile:80`.
5. The final runner copies standalone output first and then overlays production dependencies into `/app/node_modules` at `apps/web/Dockerfile:132` through `apps/web/Dockerfile:143`, so the smoked `prod-deps` tree is present in the runtime image.
6. The explicit versions match the lockfile entries for Linux arm64 and x64: arm64 `@img/sharp-linux-arm64` depends on `@img/sharp-libvips-linux-arm64` at `package-lock.json:1351` through `package-lock.json:1370`; x64 `@img/sharp-linux-x64` depends on `@img/sharp-libvips-linux-x64` at `package-lock.json:1439` through `package-lock.json:1458`; `sharp` itself lists those optional dependencies at `package-lock.json:9669` through `package-lock.json:9689`.
7. The source contract pins the runtime stage shape and smoke check at `apps/web/src/__tests__/deploy-script-contract.test.ts:268` through `apps/web/src/__tests__/deploy-script-contract.test.ts:275`.

Trace result: no confirmed deploy/runtime topology defect. The previous Cycle 78 runtime `sharp` failure mode is closed in source, with a build-stage smoke for the exact runtime dependency stage. Residual limitation: I did not run a Docker build in this review, so this is source-and-test evidence rather than an image-level proof.

## Additional Cross-File Checks

- Public route rate-limit scanner: the previous raw-text marker false positive was replaced with AST call/new-expression checks at `apps/web/scripts/check-public-route-rate-limit.ts:615` through `apps/web/scripts/check-public-route-rate-limit.ts:680`. Regression fixtures prove marker words inside strings/comments are not treated as work at `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:421` through `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:442`, while expensive imported/called helpers remain covered by existing fixtures around `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:354` through `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:419`.
- Sidecar backfill freshness: both `flushBatch` update branches advance `updated_at` at `apps/web/scripts/backfill-color-pipeline.ts:467` through `apps/web/scripts/backfill-color-pipeline.ts:490`, and the test now anchors each branch independently at `apps/web/src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts:206` through `apps/web/src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts:220`.
- In-app backfill mirrors the same freshness and delete-mid-reencode protection: full metadata updates set `updated_at` at `apps/web/src/lib/admin-backfill-runner.ts:612` through `apps/web/src/lib/admin-backfill-runner.ts:630`; derivative-only detection-failure updates also set it and then probe missed updates for deleted rows at `apps/web/src/lib/admin-backfill-runner.ts:650` through `apps/web/src/lib/admin-backfill-runner.ts:663`.
- Per-photo OG route uses a freshness-aware ETag source including `updated_at`, sorted `imageSizes`, settings hash, and pipeline version at `apps/web/src/app/api/og/photo/[id]/route.tsx:56` through `apps/web/src/app/api/og/photo/[id]/route.tsx:84`, then applies conditional response handling before any internal derivative fetch at `apps/web/src/app/api/og/photo/[id]/route.tsx:139` through `apps/web/src/app/api/og/photo/[id]/route.tsx:159`.

## Findings

No new confirmed issue.

- Severity: none.
- Confidence: medium-high. The reviewed source, focused tests, and rate-limit lint support the no-defect conclusion; Docker was not image-built in this lane, so the deploy/runtime trace stops at source plus committed regression contracts.
- Failure scenario checked and not confirmed: production upload/topic/backfill/CLIP/OG paths fail because `sharp` can load in the build stage but not the runtime image. HEAD now installs and smokes the runtime `prod-deps` `sharp` tree before copying it into the final runner.
- Suggested fix: none for a confirmed defect. A future hardening pass could add an actual Docker image smoke in CI when Docker is available, but this is a validation-depth improvement rather than a confirmed architecture bug.

## Deferred Not Re-Raised

- `C77-ARCH-01` remains deferred: restore maintenance still does not globally drain every already-started foreground non-upload admin mutation. Cycle 79 found no new restore-flow evidence that changes the recorded severity or exit criterion in `.context/plans/cycle-78-2026-07-01-deferred.md:12`.
- Cycle 76/75 UI and source-shaped test gaps listed at `.context/plans/cycle-78-2026-07-01-deferred.md:13` through `.context/plans/cycle-78-2026-07-01-deferred.md:15` were outside this architecture/runtime trace and were not re-filed.
