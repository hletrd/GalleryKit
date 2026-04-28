# Critic review — gate reliability change surface

Repo: `/Users/hletrd/flash-shared/gallery`  
Mode: read-only review except writing this file. No fixes were implemented and no gate commands that generate artifacts were run. I did run read-only/static commands (`git diff`, `nl`, `rg`, `git check-ignore`, `npx next typegen --help`) and inspected current generated-file ownership where it was directly relevant to the changed gate.

## Review-relevant inventory built first

### Changed / untracked files in the current change surface
- `apps/web/next.config.ts` — changed to set `typescript.ignoreBuildErrors: true`.
- `apps/web/package.json` — changed `build` to run `npm run typecheck && next build`; changed `typecheck` to run `next typegen && tsc -p tsconfig.typecheck.json --noEmit`.
- `apps/web/tsconfig.typecheck.json` — changed to override `compilerOptions.incremental=false`.
- `plan/plan-249-cycle2-fresh-gate-fix.md` — untracked plan/evidence file for this gate reliability change.

### Adjacent files examined because they define or consume the same invariant
- Root scripts and workspace wiring: `package.json`, `package-lock.json`.
- CI and E2E build orchestration: `.github/workflows/quality.yml`, `apps/web/playwright.config.ts`.
- Docker/deploy path: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/scripts/ensure-site-config.mjs`.
- TypeScript/Next generated-type contract: `apps/web/tsconfig.json`, `apps/web/tsconfig.scripts.json`, `apps/web/next-env.d.ts` (ignored/generated local file), `apps/web/.next/types/routes.d.ts`, `apps/web/.next/types/validator.ts` (generated artifacts inspected only for this gate issue), `.gitignore`, `apps/web/.gitignore`, `.dockerignore`, `apps/web/.dockerignore`.
- Existing tests and config assertions: `apps/web/src/__tests__/next-config.test.ts`, `apps/web/vitest.config.ts`, `apps/web/eslint.config.mjs`.
- Documentation and prior current fan-out reviews for missed/cross-review checks: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `.context/reviews/{code-reviewer,security-reviewer,perf-reviewer,test-engineer,debugger-tracer,document-specialist,designer}.md`, `.context/reviews/_aggregate.md`, `.context/gate-logs/{lint,typecheck,build,test,test-e2e}.log`.

Generated/vendor/runtime artifacts (`node_modules`, `.git`, `.next` generally, upload data, screenshots, test results, `.omx`, `.omc`) were excluded except for the targeted `.next/types` ownership/read-only check above because the change explicitly depends on `.next/types` generation.

## Findings summary

| ID | Severity | Confidence | Category | Finding |
| --- | --- | --- | --- | --- |
| CRIT-01 | High | High | Confirmed process gap / manual validation required | Build/typecheck gate was made safety-critical while the plan still records `npm run build` as pending. |
| CRIT-02 | High | High | Confirmed | `next build` can now bypass TypeScript validation unless the wrapper script is used. |
| CRIT-03 | Medium-High | High | Confirmed | CI/E2E now multiplies the previously flaky typecheck path, increasing timeout risk. |
| CRIT-04 | Medium | Medium-High | Likely / manual validation | The fix still depends on writable, sane `.next/types` generated state, so it only partially addresses the stated stale/foreign-owned artifact class. |
| CRIT-05 | Medium | High | Confirmed maintainability risk | No regression test locks the new `ignoreBuildErrors` ↔ wrapper-typecheck invariant. |
| CRIT-06 | Medium | High | Confirmed pre-existing gap amplified by this change | The promoted typecheck gate still excludes operational TypeScript scripts. |

## Detailed findings

### CRIT-01 — Build/typecheck gate was made safety-critical while `npm run build` evidence is still pending

- **Severity:** High
- **Confidence:** High
- **Category:** Confirmed process gap / manual validation required
- **Files / regions:**
  - `apps/web/next.config.ts:38-44` disables Next's internal build-time TypeScript failure (`ignoreBuildErrors: true`).
  - `apps/web/package.json:11` makes the wrapper build responsible for invoking `npm run typecheck` before `next build`.
  - `apps/web/package.json:15` changes the explicit type gate to `next typegen && tsc -p tsconfig.typecheck.json --noEmit`.
  - `plan/plan-249-cycle2-fresh-gate-fix.md:20-24` lists `npm run build` as “pending rerun with explicit typecheck + skipped duplicate internal Next validation”.
- **Problem:** The change intentionally shifts the release-blocking TypeScript gate out of Next's build step and into the npm wrapper, but the plan file still records the target build path as unverified. That is not just missing paperwork: the modified path is the one Docker, Playwright web-server startup, root workspace build, and CI build now depend on.
- **Concrete failure scenario:** The change is committed with the pending build evidence unchanged. CI or production Docker then runs the new wrapper path for the first time from a different generated-artifact state. If `next typegen`, `tsc`, or the now typecheck-skipping `next build` still hangs/fails, the deployment is blocked; if an alternate path runs `next build` directly, TypeScript errors are no longer build-blocking.
- **Suggested fix:** Do not merge/push this gate change until a clean generated-artifact run proves at least `npm run typecheck` and `npm run build` from `apps/web` (or root equivalents) after removing stale `.next` and `*.tsbuildinfo`. Update the plan/evidence file to replace the pending build line with the actual result and duration. If the build still needs an unchecked Next pass, make that bypass conditional on the explicit typecheck having just succeeded (see CRIT-02).
- **Prior-review comparison:** Prior reviews noted build-safety and gate-shape risks. This review adds that the current plan itself still marks the new critical build path as pending.

### CRIT-02 — Direct `next build` now bypasses TypeScript validation

- **Severity:** High
- **Confidence:** High
- **Category:** Confirmed
- **Files / regions:**
  - `apps/web/next.config.ts:38-44` globally sets `typescript.ignoreBuildErrors: true`.
  - `apps/web/package.json:11-15` keeps type validation only in npm scripts.
  - `README.md:142-143` and `apps/web/README.md:38` still discuss configuration “before `next build`”, which can normalize direct framework builds for operators/contributors.
  - `apps/web/Dockerfile:48` is safe today because it uses `npm run build`, but this is convention rather than a framework-enforced invariant.
- **Problem:** `ignoreBuildErrors` is a global Next config switch. Once enabled, any direct `next build` / `npx next build` / future automation that skips `npm run build` can produce build output despite TypeScript errors. The package script wrapper is necessary but not sufficient as a safety boundary because it is easy to bypass and not enforced by Next itself.
- **Concrete failure scenario:** A maintainer reproduces a production build by running `cd apps/web && npx next build`, or a future deploy optimization changes Docker/CI to call `next build` directly. A route/component TypeScript error exists. The build proceeds because Next's internal check is disabled, and the broken code can be shipped or only fail later at runtime.
- **Suggested fix:** Make the bypass conditional rather than global. For example, have the wrapper set a marker only after the explicit typecheck succeeds (`npm run typecheck && GALLERY_TYPECHECKED=1 next build`) and configure `ignoreBuildErrors: process.env.GALLERY_TYPECHECKED === '1'`. Direct `next build` would then keep Next's native type gate enabled. Also update docs/comments to say the supported production command is `npm run build`, not raw `next build`, unless an explicit typecheck has already succeeded.
- **Prior-review comparison:** `.context/reviews/debugger-tracer.md` already raised this as a build-safety risk. I confirm it and would treat it as higher severity because the config-level switch is global while the guard is only script-level.

### CRIT-03 — CI/E2E now multiplies the previously flaky typecheck path

- **Severity:** Medium-High
- **Confidence:** High
- **Category:** Confirmed
- **Files / regions:**
  - `plan/plan-249-cycle2-fresh-gate-fix.md:4` says `npm run typecheck` had already run for more than 30 minutes before this fix attempt.
  - `.github/workflows/quality.yml:57-58` runs `npm run typecheck` as its own CI step.
  - `apps/web/playwright.config.ts:72-79` starts the local E2E server by running `npm run build`.
  - `.github/workflows/quality.yml:75-79` runs E2E, then runs another `npm run build` step.
  - `apps/web/package.json:11-15` means every `npm run build` now runs `next typegen && tsc` before `next build`.
- **Problem:** The changed package scripts turn the workflow into up to three explicit typecheck passes and two Next production builds in one CI job: the standalone Typecheck step, the Playwright webServer build, and the final Build step. This worsens the exact failure mode the change is trying to fix: a gate that can hang or exceed the 30-minute job timeout.
- **Concrete failure scenario:** CI starts with a clean checkout and MySQL service. Typecheck passes once, E2E then invokes `npm run build` and repeats `next typegen && tsc`, and the final build repeats it again. A typegen/tsc pass that is slow but no longer hung can still push the job over `.github/workflows/quality.yml:11`'s 30-minute timeout; a pass that intermittently hangs now has three chances to hang.
- **Suggested fix:** Collapse the gate plan so CI validates each expensive operation once. Options: remove the final build if the E2E webServer build already proves standalone output, reuse a previously built standalone server for E2E, or introduce an internal unchecked build script used only immediately after a successful CI typecheck while keeping the public/deploy `npm run build` wrapper safe. If using an unchecked internal script, pair it with the conditional env guard from CRIT-02 so direct/accidental framework builds remain protected.
- **Prior-review comparison:** Earlier performance/test reviews noted duplicate CI builds. This change makes the duplicate-build issue more severe by adding duplicate explicit typechecks to each build invocation.

### CRIT-04 — The stale/generated artifact fix still depends on `.next/types` being writable and correct

- **Severity:** Medium
- **Confidence:** Medium-High
- **Category:** Likely / manual validation
- **Files / regions:**
  - `plan/plan-249-cycle2-fresh-gate-fix.md:4-10` identifies stale/foreign-owned `.next` and `tsconfig.typecheck.tsbuildinfo` artifacts as the root failure class.
  - `apps/web/package.json:15` now starts typecheck with `next typegen`, which writes generated route/type files under `.next`.
  - `apps/web/next-env.d.ts:3` imports `./.next/types/routes.d.ts`.
  - `apps/web/tsconfig.typecheck.json:3-8` includes `.next/types/**/*.ts` in the explicit compiler pass.
  - `apps/web/tsconfig.typecheck.json:15-17` disables TypeScript incremental state, but does not address `.next/types` ownership or stale validator output.
  - `apps/web/.gitignore:41-42` ignores `*.tsbuildinfo` and `next-env.d.ts`; `.next/` is also ignored at the repo level (`.gitignore:2`).
- **Problem:** Disabling incremental mode removes one cache file from the failure class, but the new gate still needs Next to write and then TypeScript to read `.next/types`. If the local failure was caused by mixed UID ownership or stale generated `.next` state, `next typegen` can fail/hang before `tsc` ever benefits from `incremental:false`. The mitigation is therefore environment-sensitive rather than a complete fresh-gate guarantee.
- **Concrete failure scenario:** A prior Docker/root/container run leaves `apps/web/.next/types` owned by another UID or otherwise stale/unwritable. A developer runs `npm run typecheck`. The first command (`next typegen`) tries to update `.next/types/routes.d.ts` / `validator.ts`; it blocks or fails on the same generated state family that caused the original incident. The absence of `tsconfig.typecheck.tsbuildinfo` does not help because the failure occurs earlier.
- **Suggested fix:** Add an explicit fail-fast generated-state preflight to the typecheck path: verify `.next`/`.next/types` is writable or remove only the generated type subtree before `next typegen`, and print a clear remediation command when ownership is wrong. Also document the local recovery path (`rm -rf apps/web/.next apps/web/*.tsbuildinfo` or ownership repair) and avoid mixing host/container/root UIDs for local builds. If `next typegen` has no alternate output directory, make that limitation explicit in the plan and verification criteria.
- **Prior-review comparison:** This appears not to be fully covered by the existing current reviews; they identify wrapper bypass and test/deploy gaps, but not that the fix still relies on the same `.next` generated-state class.

### CRIT-05 — The new safety invariant is not locked by tests

- **Severity:** Medium
- **Confidence:** High
- **Category:** Confirmed maintainability risk
- **Files / regions:**
  - `apps/web/next.config.ts:38-44` adds the risky `ignoreBuildErrors` setting with an explanatory comment.
  - `apps/web/package.json:11-15` is the only place that currently keeps type errors blocking the public build command.
  - `apps/web/src/__tests__/next-config.test.ts:19-26` checks image localPatterns only; it does not assert build/typecheck invariants.
  - `apps/web/vitest.config.ts:10-12` scopes tests to `src/__tests__/**/*.test.ts`, so no package/config invariant test exists elsewhere in the current test inventory.
- **Problem:** The correctness of the build now depends on two separate files staying aligned: Next config must skip internal type validation only when the package build script runs the explicit type gate first. There is no regression test or static guard to catch future edits that remove `npm run typecheck`, simplify the build script, or change the typecheck script to omit `next typegen` while leaving `ignoreBuildErrors` enabled.
- **Concrete failure scenario:** A future cleanup changes `apps/web/package.json` back to `"build": "next build"` to reduce duplicate CI time, not noticing the global `ignoreBuildErrors` setting. Unit tests pass because no test reads the scripts/config invariant. Production builds then stop blocking TypeScript errors.
- **Suggested fix:** Add a focused source-contract test or custom lint check that reads `apps/web/package.json` and `apps/web/next.config.ts` and enforces: if `ignoreBuildErrors` is enabled/conditional, the public `build` script must run `npm run typecheck` first; the `typecheck` script must run `next typegen` before `tsc -p tsconfig.typecheck.json`; and direct unchecked build scripts must be clearly named/internal.
- **Prior-review comparison:** Test reviews flagged broader source-contract and operational-gate gaps. This is the specific new invariant created by this change.

### CRIT-06 — The promoted typecheck gate still excludes operational TypeScript scripts

- **Severity:** Medium
- **Confidence:** High
- **Category:** Confirmed pre-existing gap amplified by this change
- **Files / regions:**
  - `apps/web/tsconfig.typecheck.json:10-13` excludes `scripts`.
  - `apps/web/package.json:15` promotes this config as the explicit type gate that must pass before `next build`.
  - `apps/web/package.json:10,17-22` exposes operational script entrypoints (`prebuild`, `db:seed`, `init`, E2E seed, custom lint checks).
  - `apps/web/tsconfig.scripts.json:6-14` exists for scripts but is not invoked by `apps/web/package.json` or `.github/workflows/quality.yml:57-66`.
  - `apps/web/Dockerfile:89-90` runs `node apps/web/scripts/migrate.js` before the server at container startup.
- **Problem:** The change's comments and plan position `npm run typecheck` as the build-blocking substitute for Next's internal TypeScript pass, but that gate still excludes a set of live operational scripts. This was already a gap; it becomes more important when the explicit typecheck is the main advertised build safety net.
- **Concrete failure scenario:** A type error lands in `scripts/seed-e2e.ts`, `scripts/init-db.ts`, or another TypeScript operational script. `npm run typecheck` passes because `scripts` are excluded. CI may catch only the narrow scripts it happens to execute, while deploy-only or maintenance scripts can remain broken until an operator needs them.
- **Suggested fix:** Add `typecheck:scripts` (`tsc -p tsconfig.scripts.json --noEmit`, after ensuring the config does not exclude its own `.next/types` include) and either run it from `npm run typecheck` or as a separate CI gate. Keep the app build gate fast if needed, but do not describe it as covering all operational TypeScript.
- **Prior-review comparison:** `.context/reviews/test-engineer.md` already found the broader script/deployment gate mismatch. I agree and note that the current build-safety change raises its priority.

## Prior-review sweep: what was confirmed vs. newly added

- Confirmed from prior reviews: direct `next build` bypass after `ignoreBuildErrors`, operational script gate mismatch, and duplicate CI build concerns.
- Added / sharpened here: the pending build evidence in `plan/plan-249-cycle2-fresh-gate-fix.md`, the CI triple-typecheck interaction created by the changed `build` script, the incomplete handling of `.next/types` generated-state ownership, and the absence of a test locking the new cross-file safety invariant.
- I did not re-report unrelated current full-repo findings (queue retry, rate-limit unknown bucket, SQL restore scanner, public search/count performance, UI/UX gaps, docs mismatches) unless they directly affected this build/typecheck change surface.

## Final sweep / coverage confirmation

- Built the inventory from `git status`, `git diff`, tracked file searches, and current fan-out artifacts before writing findings.
- Examined every file I identified as relevant to the current build/typecheck change surface: changed files, the untracked plan, root/workspace package wiring, CI, E2E server startup, Docker/deploy scripts, TypeScript configs, generated-type imports, targeted generated type artifacts, ignore files, existing config tests, docs mentioning build commands, and current prior reviews.
- Excluded only vendor/generated/runtime/binary artifacts except for the targeted read-only `.next/types` check required by the stated failure mode.
- No implementation changes were made; only this review file was written.
