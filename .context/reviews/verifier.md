# Verifier Review - Cycle 21

Date: 2026-06-30 KST
HEAD reviewed: `2cc619bb7896` (`fix(cycle20): 🐛 close review-plan-fix findings`)
Scope: verifier review of current HEAD against `AGENTS.md`, `CLAUDE.md`, README files, tests, and prior plan/review conventions. No implementation files were modified.

## Inventory

Required instructions read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Current and prior planning/review artifacts inspected:

- `.context/plans/cycle-21-plan.md`
- `.context/plan/plan-cycle21.md`
- `.context/reviews/_aggregate.md`
- `.context/reviews/architect.md`
- `.context/reviews/code-reviewer.md`
- `.context/reviews/critic.md`
- `.context/reviews/debugger.md`
- `.context/reviews/document-specialist.md`
- `.context/reviews/perf-reviewer.md`
- `.context/reviews/security-reviewer.md`
- `.context/reviews/test-engineer.md`
- `.context/reviews/tracer.md`
- `.context/reviews/verifier.md` from the previous cycle

Relevant file inventory before findings:

- Build/deploy/runtime docs and contracts: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `AGENTS.md`, `package.json`, `apps/web/package.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/.env.local.example`, `apps/web/next.config.ts`, `apps/web/src/lib/upload-limits.ts`.
- Admin backup download path: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/__tests__/backup-download-route.test.ts`, `apps/web/src/lib/backup-filename.ts`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/lib/audit.ts`.
- Semantic search contracts: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/__tests__/semantic-search-route.test.ts`, `apps/web/src/__tests__/similar-route.test.ts`, `apps/web/README.md`.
- Cycle-21 validation surfaces: `apps/web/src/__tests__/deploy-script-contract.test.ts`, `apps/web/src/__tests__/focus-visible-links-scan.test.ts`, `apps/web/src/__tests__/clip-semantic-limits-env.test.ts`, `apps/web/src/__tests__/process-image-max-input-pixels-env.test.ts`, custom lint scanners, migration journal tests, privacy tests, and source-contract tests.

Validation run:

- `npm test --workspace=apps/web -- --run src/__tests__/deploy-script-contract.test.ts src/__tests__/backup-download-route.test.ts src/__tests__/focus-visible-links-scan.test.ts src/__tests__/clip-semantic-limits-env.test.ts src/__tests__/process-image-max-input-pixels-env.test.ts`: passed, 5 files / 56 tests.

Full lint, typecheck, build, full Vitest, and Playwright were not rerun in this verifier-only pass. The focused tests above are important because they pass while still leaving the doc/manual-command and post-open backup error gaps below.

## Confirmed Findings

### V21-01 - Manual Docker deployment docs still omit the env file needed for build-time args

Severity: Medium  
Confidence: High  
Status: Confirmed source-contract drift

Evidence:

- The README tells operators to configure `apps/web/.env.local`, then run `docker compose -f apps/web/docker-compose.yml up -d --build`: `README.md:175-182`.
- `CLAUDE.md` repeats the same manual compose command in the deployment checklist: `CLAUDE.md:657`.
- The compose build args are resolved from Compose interpolation, not from the runtime `env_file`: `BASE_URL`, `IMAGE_BASE_URL`, `UPLOAD_MAX_TOTAL_BYTES`, and `NEXT_UPLOAD_BODY_MAX_BYTES` are under `build.args` at `apps/web/docker-compose.yml:4-11`, while `env_file: .env.local` is only the service runtime environment at `apps/web/docker-compose.yml:18-22`.
- The scripted deploy path was fixed to pass the env file explicitly: `docker compose --env-file apps/web/.env.local -f apps/web/docker-compose.yml up -d --build` at `apps/web/deploy.sh:30-32`.
- The deploy contract test pins the fixed script and build args, but it does not reject the stale manual commands in README/CLAUDE: `apps/web/src/__tests__/deploy-script-contract.test.ts:56-60`.
- `README.md:149` warns that build-time values must be present in the shell/Compose environment; the later step at `README.md:181` still gives a command that does not make `.env.local` part of that environment.

Failure scenario:

An operator follows the README or `CLAUDE.md`: they set `IMAGE_BASE_URL` or `NEXT_UPLOAD_BODY_MAX_BYTES` in `apps/web/.env.local`, then run the documented compose command. The runtime container receives those values through `env_file`, but the image can be built with empty/default build args. The result is a build that lacks the configured CDN image host or bakes the wrong Next.js server-action body limit even though runtime env inspection looks correct.

Suggested fix:

Update every manual compose build command to use `docker compose --env-file apps/web/.env.local -f apps/web/docker-compose.yml up -d --build`, or state immediately beside the command that the build-time variables must be exported into the shell first. Add a source-contract test that scans README/CLAUDE manual compose commands and fails if a documented `--build` path omits `--env-file apps/web/.env.local` without an adjacent explicit export instruction.

### V21-02 - Backup download leaks the opened file descriptor if a pre-stream step throws

Severity: Low-Medium  
Confidence: Medium-High  
Status: Confirmed error-path resource leak

Evidence:

- The route opens the backup file descriptor before user lookup and audit logging: `const fileHandle = await open(resolvedFilePath, 'r')` at `apps/web/src/app/api/admin/db/download/route.ts:56`.
- It closes the descriptor only on the `!stats.isFile()` branch: `apps/web/src/app/api/admin/db/download/route.ts:57-64`.
- It then awaits `getCurrentUser()` and audit setup before creating the descriptor-backed stream: `apps/web/src/app/api/admin/db/download/route.ts:66-74`.
- The catch block returns 404/500 but has no reference to close a descriptor opened before the failure: `apps/web/src/app/api/admin/db/download/route.ts:87-99`.
- Existing tests cover an `open()` failure before any descriptor exists, but not a throw after `open()` succeeds and before `createReadStream()` takes ownership: `apps/web/src/__tests__/backup-download-route.test.ts:170-184`.

Failure scenario:

A transient auth/session, request-header, or audit-path exception occurs after the file has been opened but before `fileHandle.createReadStream()` is constructed. The request returns 500 and the descriptor remains open until process exit or garbage collection. Repeated failed downloads can exhaust file descriptors on the single web process, making unrelated backup and upload operations fail.

Suggested fix:

Track whether the file handle has been handed to a stream and close it in the catch path when it has not. A small shape is `let fileHandle: FileHandle | undefined; let streamCreated = false;` outside the `try`, set `streamCreated = true` immediately before `createReadStream()`, and in `catch` call `await fileHandle?.close().catch(console.debug)` when `!streamCreated`. Add a regression that mocks `getCurrentUser()` or `getClientIp()` to throw after `open()` resolves and asserts `close()` is called.

### V21-03 - A non-archived cycle-21 plan still says semantic text search must reject stub mode

Severity: Low  
Confidence: High  
Status: Confirmed planning/source-contract drift

Evidence:

- `.context/plan/plan-cycle21.md` says `PLAN-C21-01` should make `apps/web/src/app/api/search/semantic/route.ts` reject requests unless `semantic_search_mode === 'production'`: `.context/plan/plan-cycle21.md:10-24`.
- The same plan marks that item complete: `.context/plan/plan-cycle21.md:101-106`.
- Current route comments explicitly state that the public semantic endpoint serves both `stub` and `production` modes: `apps/web/src/app/api/search/semantic/route.ts:19-31`.
- Current implementation allows both modes and only returns 503 for other modes: `apps/web/src/app/api/search/semantic/route.ts:186-203`.
- Current operator docs also define `stub` as a supported mode with an experimental disclaimer: `apps/web/README.md:60-64`.
- Current tests set stub as the normal semantic-route mode and state that stub and operator-gated production both serve requests: `apps/web/src/__tests__/semantic-search-route.test.ts:113-115`.

Failure scenario:

A later reviewer or implementer treats `.context/plan/plan-cycle21.md` as the authoritative completed cycle-21 plan, reopens "reject stub mode" as an unfinished regression, and changes the public semantic endpoint to return 503 in stub mode. That would break the current README contract and the intended experimental/demo mode without failing any plan-history review until after behavior changes.

Suggested fix:

Mark `.context/plan/plan-cycle21.md` as superseded, move it under an archive with a clear stale-contract note, or update it to match the current served-mode decision. Prefer keeping only the current `.context/plans/cycle-21-plan.md` as the active cycle-21 plan surface, since it already records the completed/current validation set.

## Missed-Issues Sweep

Final sweep covered manual and scripted Docker deploy paths, build-time/runtime env propagation, the backup download descriptor-backed streaming path, semantic/similar mode contracts, current and stale cycle-21 plan files, README/CLAUDE deployment commands, focused regression tests, and the current HEAD diff context. I did not find additional evidence-backed invariant breaks in the reviewed surfaces. The unrelated modified `.context/reviews/code-reviewer.md` was present before this report edit and was left untouched.
