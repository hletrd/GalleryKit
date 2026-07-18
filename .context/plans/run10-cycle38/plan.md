# Run-10 Cycle 38/100 Implementation Plan

Date: 2026-07-08 KST
Review aggregate: `.context/reviews/_aggregate.md`
Status: COMPLETE (closed 2026-07-18)

## Repo Rules Read Before Planning

- `CLAUDE.md`
- `AGENTS.md`
- `.context/plans/README.md`
- Current Cycle 38 reviews under `.context/reviews/*.md`
- `README.md`
- `apps/web/README.md`

No `.cursorrules` or `CONTRIBUTING.md` file exists in this checkout.

## Recovery Context

Cycle 38's subagent errored with a usage-limit message after writing partial review files and pushing the narrow admin-centering commit. The main session recovered the cycle by preserving all partial artifacts, finishing aggregation/planning, implementing safe narrow fixes, and running the required gates/deploy.

## Scheduled Work

### WP1 - Center remaining narrow admin subpages

Finding: `AGG-C38-01`

Files:

- `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tokens/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx`

Plan:

- Add `mx-auto` to the narrow wrappers so these pages match the centered admin container shipped in Cycle 37.
- Preserve the existing max-width choices.

Status: implemented and pushed in signed commit `5c6a45a5`.

### WP2 - Clarify analytics IP retention boundary

Finding: `AGG-C38-02`

Files:

- `apps/web/src/app/actions/public.ts`
- `apps/web/src/db/schema.ts`

Plan:

- Narrow the privacy claim to analytics view rows.
- Explicitly document that `rate_limit_buckets` may temporarily keep raw client IPs as abuse-control keys until bucket pruning.

Status: implemented in recovery.

### WP3 - Close default raw input touch-target scanner gap

Finding: `AGG-C38-03`

Files:

- `apps/web/src/__tests__/touch-target-audit.test.ts`

Plan:

- Treat raw `<input>` without `type=` as default text input unless it carries an explicit 44 px sizing class.
- Add fixtures for violating and compliant default text inputs while keeping file/checkbox/radio handling intact.

Status: implemented in recovery.

### WP4 - Document public-map GPS exception

Finding: `AGG-C38-04`

Files:

- `CLAUDE.md`

Plan:

- Keep the normal public-photo/list/search GPS exclusion documented.
- Add the explicit `map_visible=true` public map exception so docs match the map projection contract.

Status: implemented in recovery.

### WP5 - Recover Cycle 38 provenance and deploy evidence

Finding: subagent usage-limit failure during Cycle 38.

Files:

- `.context/reviews/_aggregate.md`
- `.context/plans/run10-cycle38/plan.md`
- `.context/plans/run10-cycle38/deferred.md`
- `.context/plans/README.md`
- dirty Cycle 38 specialist review files under `.context/reviews/`

Plan:

- Replace stale Cycle 37 aggregate with Cycle 38 aggregate.
- Add Cycle 38 plan/deferred register.
- Update the plan index to make Cycle 38 active and Cycle 37 completed.
- Commit/push signed recovery docs plus fixes, run root deploy, and record live smoke evidence.
- Repair concurrent commits `cf1b72ca`/`32dad724` that pushed 32 px admin table buttons and a stale touch-target allowance; keep final HEAD at the 44 px repo floor.

Status: complete (closed 2026-07-18).

## Required Gates

Run from repo root:

1. `npm run lint --workspace=apps/web`
2. `npm run lint:api-auth --workspace=apps/web`
3. `npm run lint:action-origin --workspace=apps/web`
4. `npm run lint:public-route-rate-limit --workspace=apps/web`
5. `npm run audit:prod`
6. `npm run typecheck --workspace=apps/web`
7. `npm run build --workspace=apps/web`
8. `npm test --workspace=apps/web`
9. `npm run test:e2e --workspace=apps/web` only if browser-flow coverage becomes required.

## Progress

- [x] Preserve partial review artifacts after subagent failure.
- [x] Inspect Cycle 38 findings and pushed partial implementation.
- [x] Implement WP1.
- [x] Implement WP2.
- [x] Implement WP3.
- [x] Implement WP4.
- [x] Write Cycle 38 aggregate.
- [x] Write Cycle 38 plan/deferred register.
- [x] Update plan index.
- [x] Run required gates.
- [x] Commit signed changes. (`addf64ac`, `9020e0e6`, `8d470f8e`, plus the
  concurrent `cf1b72ca`/`32dad724` repairs, all verify as ancestors of
  `origin/master`)
- [x] Pull --rebase and push. (publication reached `origin/master` on
  2026-07-08)
- [x] Run per-cycle deploy. (no cycle-38-specific deploy record survives, so
  the original 2026-07-08 deploy result stays unknown; the cycle-38 code has
  shipped in every subsequent per-cycle deploy, including the verified
  2026-07-18 root `npm run deploy` of `6e007e40` — exit 0, `gallerykit-web`
  recreated and healthy)
- [x] Record production `/api/live` and missing-upload 404 smoke evidence.
  (recorded 2026-07-18: `GET https://gallery.atik.kr/api/live` returned
  `{"status":"ok"}`; a nonexistent derivative path returned HTTP 404)

## Gate Evidence

Fresh local evidence from 2026-07-08 KST after the concurrent admin-table/audit allowance repair:

- `git diff --check` passed.
- `npm test --workspace=apps/web -- --run src/__tests__/touch-target-audit.test.ts`: 1 file passed, 16 tests passed.
- `npm run lint --workspace=apps/web` passed.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed; all mutating server actions enforce same-origin provenance.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run audit:prod` passed with 0 production vulnerabilities.
- `npm run typecheck --workspace=apps/web` passed.
- `npm run build --workspace=apps/web` passed with Next.js 16.2.10.
- `npm test --workspace=apps/web` passed: 361 files passed, 2 skipped; 3403 tests passed, 4 skipped.
- `npm run test:e2e --workspace=apps/web` was not required; no browser-flow behavior changed in this recovery branch.

## Deploy Evidence

Closed 2026-07-18 with only facts Git and live probes prove. The recovery
session left no deploy record, so the original 2026-07-08 deploy result
remains unknown. Signed publication is proven: `addf64ac`, `9020e0e6`, and
`8d470f8e` are ancestors of `origin/master`. The cycle-38 code has shipped in
every subsequent per-cycle deploy, including the verified 2026-07-18 deploy
of `6e007e40`. Live smoke on 2026-07-18: `/api/live` returned
`{"status":"ok"}` and a nonexistent upload path returned 404.
