# Code Reviewer — review-plan-fix cycle 5

**Date:** 2026-06-29
**HEAD:** `79c698eb877e563cd46331c8cd92fc29ed970874` (`79c698eb`)
**Role:** code-reviewer
**Scope:** current HEAD only; code quality, logic, SOLID/maintainability, operational correctness, test strength, and cross-file interactions. No application source edits made.

## Inventory Coverage

I inventoried the current HEAD before reviewing implementation details.

Changed files in HEAD:

- `CLAUDE.md`
- `apps/web/public/sw.js`
- `apps/web/src/__tests__/deploy-script-contract.test.ts`

Review-relevant files and regions examined:

- Commit/delta: `git show --stat --oneline --find-renames HEAD`, `git show --unified=80 HEAD`.
- Project instructions/context: `AGENTS.md` supplied in prompt, `CLAUDE.md`.
- Deployment/runtime contracts: `.dockerignore:1-24`, `apps/web/.dockerignore:1-18`, `apps/web/Dockerfile:59-120`, `apps/web/docker-compose.yml:23-27`, `apps/web/deploy.sh:28-62`, `scripts/deploy-remote.sh`.
- New/adjacent tests: `apps/web/src/__tests__/deploy-script-contract.test.ts:1-51`, `apps/web/src/__tests__/nginx-config.test.ts:1-52`, `apps/web/src/__tests__/sw-template-contract.test.ts:1-168`.
- Service worker generation and output: `apps/web/scripts/build-sw.ts:1-57`, `apps/web/public/sw.template.js:1-120`, `apps/web/public/sw.js:1-220`, `apps/web/package.json:8-26`.
- Public asset surfaces: `apps/web/src/app/manifest.ts:1-53`, `apps/web/src/components/register-service-worker.tsx`, `apps/web/public/`, and the current local `.next/standalone/apps/web/public` build output as evidence of what Next packages.
- Repo-wide sweeps: `rg` over `public/uploads`, `public/resources`, broad `public` mounts, Docker context rules, `sw.js`, deploy scripts, sidecar examples, and persistence documentation.

Skipped/not inspected in depth:

- Application feature logic outside deploy/public-asset packaging, because HEAD only changed documentation, generated service-worker stamp, and deploy-contract tests.
- Full unit/build gates, because the reviewed delta is narrow; I ran targeted deploy/runtime contract tests instead.
- `node_modules`, screenshots, binary images/fonts, and historical plan/review archives except where they surfaced current deploy-contract lineage.

## Validation Evidence

- `npm test --workspace=apps/web -- deploy-script-contract nginx-config` — pass, 2 files / 11 tests.
- Confirmed current Docker build context is repo root via `apps/web/docker-compose.yml:5-6`.
- Confirmed root `.dockerignore` excludes `apps/web/public/uploads` but not `apps/web/public/resources`.
- Confirmed local generated standalone output currently contains `apps/web/.next/standalone/apps/web/public/resources/...` files when resources exist under `apps/web/public/resources`.

## Findings

### MEDIUM — Confirmed — High confidence

**File/region:** `.dockerignore:16-18`, with cross-file flow through `apps/web/Dockerfile:69` and `apps/web/Dockerfile:106` plus the runtime mount in `apps/web/docker-compose.yml:26`.

**Issue:** The root Docker build context excludes runtime uploads but not runtime topic-cover resources. The compose build uses the repo root as context (`apps/web/docker-compose.yml:5-6`), so the root `.dockerignore` is authoritative for normal deploys. It currently ignores:

```text
apps/web/public/uploads
apps/web/public/uploads/**
apps/web/data
```

but has no matching `apps/web/public/resources` / `apps/web/public/resources/**` rule. Because the builder stage does `COPY . .` (`apps/web/Dockerfile:69`) and the runner stage copies `.next/standalone` (`apps/web/Dockerfile:106`), gitignored topic-cover files under `apps/web/public/resources/` can be sent into the Docker build and baked into the image before the compose bind mount hides that path at runtime.

**Failure scenario:** A production host has admin-uploaded topic covers in `apps/web/public/resources/`. `npm run deploy` builds from the repo root. Docker sends those gitignored files into the build context, Next includes them under `.next/standalone/apps/web/public/resources`, and the final image now contains stale runtime/user-generated cover assets. In the documented compose path the bind mount hides them, but the image is still unnecessarily carrying mutable runtime state; if the image is pushed, inspected, or run without the mount, those stale resources can leak or be served. This also contradicts the newly reinforced contract that mutable `public/resources` state lives in the host bind mount while immutable public assets come from the image.

**Concrete fix:** Add `apps/web/public/resources` and `apps/web/public/resources/**` to the root `.dockerignore`. Also add the analogous `public/resources` and `public/resources/**` entries to `apps/web/.dockerignore` for anyone building with `apps/web` as context. Strengthen a source-contract test to read both `.dockerignore` files and assert both `public/uploads` and `public/resources` are excluded from Docker build contexts while `apps/web/public/resources/.gitkeep` remains only a git placeholder. Optionally update the Dockerfile comment at `apps/web/Dockerfile:105` from broad “public is mounted at runtime” wording to “only public/uploads and public/resources are mounted; immutable public assets are packaged in the image.”

## Non-Findings

- The HEAD `sw.js` stamp (`48d9ad6a-p7`) does not match the current HEAD short SHA (`79c698eb`), but this is not an actionable defect for this commit. `apps/web/scripts/build-sw.ts` stamps `git rev-parse --short HEAD` during the production `prebuild` hook; the HEAD change did not alter the service-worker template logic.
- The new CLAUDE sidecar example now uses separate `public/uploads` and `public/resources` mounts, which matches the compose runtime mount contract.
- The new deploy-script contract test passes, and the existing nginx-config test still pins narrow compose mounts. The finding above is a Docker build-context gap, not a failure of the compose runtime mount itself.

## Final Missed-Issues Sweep

Final sweep covered:

- Current HEAD changed files and full diff.
- All authoritative deployment docs included in the new test.
- Docker compose, Dockerfile, root and app `.dockerignore` files.
- Service-worker template/generated parity and build stamping.
- Public immutable assets (`sw.js`, icons, fonts, histogram worker) versus mutable public state (`uploads`, `resources`).
- Existing deploy/nginx source-contract tests and their blind spots.

Not inspected:

- Deep application logic unrelated to deploy packaging.
- Full lint/typecheck/build/unit suite.
- Live Docker image build or push; evidence was collected from source, current build artifacts, and targeted tests.

## Recommendation

**REQUEST CHANGES** for the Docker build-context hygiene gap before treating the deploy-persistence contract as closed.
