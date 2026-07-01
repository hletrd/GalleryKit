# Cycle 79 Code Quality + Performance Review

Review target: current HEAD `9cc143d06f3b4f9fe1862316c0f449f745926829` (`fix(deploy): prevent runtime sharp load failures`).

Scope: correctness, logic, maintainability, performance, concurrency, CPU/memory/UI responsiveness, and photographer-facing product risk. This pass reviewed the HEAD inventory first, then inspected the modified Docker/runtime dependency path, the public-route rate-limit scanner, the sidecar freshness regression test, and the current public route corpus. Older deferred items from Cycle 78 were not re-raised unless the new patch changed their actionability.

## Inventory Reviewed

- `apps/web/Dockerfile` - prod-deps runtime Sharp native workaround and smoke check.
- `apps/web/scripts/check-public-route-rate-limit.ts` - AST-aware expensive public GET detection.
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts` - scanner false-positive regression tests.
- `apps/web/src/__tests__/deploy-script-contract.test.ts` - Dockerfile native dependency contract test.
- `apps/web/src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts` - sidecar timestamp test.
- `apps/web/scripts/backfill-color-pipeline.ts` - actual sidecar UPDATE branches pinned by the test.
- Current public route corpus under `apps/web/src/app/**/route.{ts,tsx}`, especially both OG routes and upload serving routes.
- Cycle 78 aggregate and latest aggregate review artifacts for de-duplication.

## Findings

### C79-01 - Public-route expensive GET scanner misses namespace/property-access marker calls

- Severity: Medium
- Confidence: High
- Citations: `apps/web/scripts/check-public-route-rate-limit.ts:60`, `apps/web/scripts/check-public-route-rate-limit.ts:72`, `apps/web/scripts/check-public-route-rate-limit.ts:75`, `apps/web/scripts/check-public-route-rate-limit.ts:622`, `apps/web/scripts/check-public-route-rate-limit.ts:629`, `apps/web/scripts/check-public-route-rate-limit.ts:633`, `apps/web/scripts/check-public-route-rate-limit.ts:672`, `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:422`
- Problem: The Cycle 78 fix correctly stopped scanning raw source text, but the replacement only treats bare identifier callees as marker hits, plus property access whose root is in the dotted marker set. The marker list still contains expensive non-dotted names such as `ImageResponse`, `getImage`, and `sharp`, but `calleeMatchesMarker()` does not check the property name of a property-access callee. As a result, common namespace forms such as `new og.ImageResponse(...)` are classified as non-expensive.
- Evidence: `npx tsx -e` calling `checkPublicRouteSource()` with `import * as og from 'next/og'; export async function GET() { return new og.ImageResponse(<div>hi</div>); }` returned `OK: ... (no mutating or expensive GET handlers...)`. The direct import form `new ImageResponse(...)` still fails as expected. The committed regression tests cover marker words in strings/comments, but do not cover namespace/property-access marker calls.
- Failure scenario: A future public OG or image-processing route imports an expensive API through a namespace or object wrapper, e.g. `import * as og from 'next/og'` then `new og.ImageResponse(...)`, and forgets to add a rate-limit pre-increment. `npm run lint:public-route-rate-limit` passes, leaving a CPU-bound public endpoint unmetered. That is a photographer-facing availability risk because OG/Satori and Sharp paths can consume CPU during social unfurls or abusive traffic.
- Suggested fix: Extend `calleeMatchesMarker()` so property-access calls compare both the root for dotted markers and the final property name for non-dotted markers, e.g. `og.ImageResponse`, `client.getImage`, and `sharp.default` where appropriate. Add scanner fixtures that prove namespace `ImageResponse`, namespace/imported `sharp`, and a property-access expensive data helper are detected before the rate-limit gate and pass after an approved gate.

## Confirmed Non-Issues / Evidence

- The current shipped OG routes use direct `ImageResponse` imports and explicit rate-limit gates before expensive work, so C79-01 is a guard regression for accepted future syntax, not an unmetered route currently present in `apps/web/src/app/api/og/route.tsx` or `apps/web/src/app/api/og/photo/[id]/route.tsx`.
- `apps/web/Dockerfile` now installs `@img/sharp-libvips-linux-${npm_arch}@1.2.4` and `@img/sharp-linux-${npm_arch}@0.34.5` in `prod-deps`, then runs `node -e "require('sharp')"`. These versions match the committed lockfile/package state for Sharp `0.34.5` and libvips `1.2.4`, so I did not find a new runtime Sharp packaging issue.
- The sidecar full-metadata and derivative-only UPDATE branches both assign `updated_at = CURRENT_TIMESTAMP` in `apps/web/scripts/backfill-color-pipeline.ts`, and the new test anchors those branches rather than counting global source occurrences.

## Validation

- `npm run lint:public-route-rate-limit --workspace=apps/web` passed on the current route corpus.
- `npm test --workspace=apps/web -- --run src/__tests__/check-public-route-rate-limit.test.ts src/__tests__/deploy-script-contract.test.ts src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts` passed: 3 files, 122 tests.
- Manual scanner probes confirmed the namespace `og.ImageResponse` false negative and the direct `ImageResponse` positive case.

## Low-Confidence Risks

- I did not run a Docker daemon build of `apps/web/Dockerfile`; the review evidence for the prod-deps Sharp fix is source/lockfile inspection plus the committed smoke command in the Dockerfile. A real multi-arch Docker build remains the strongest validation for this path.
