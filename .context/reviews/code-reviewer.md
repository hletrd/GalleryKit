# code-reviewer Review — Cycle 2

## Inventory

- Prompt read first: `.omx/context/cycle2-review-prompt.md`.
- Current uncommitted input state reviewed:
  - Modified review aggregate: `.context/reviews/_aggregate.md`.
  - Modified app/config files: `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/next.config.ts`, `apps/web/package.json`, `apps/web/tsconfig.scripts.json`, `apps/web/tsconfig.typecheck.json`.
  - Modified app source: `apps/web/src/app/actions/public.ts`, `apps/web/src/app/[locale]/admin/layout.tsx`, `apps/web/src/app/[locale]/admin/(protected)/error.tsx`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, `apps/web/src/components/admin-user-manager.tsx`, `apps/web/src/components/home-client.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/nav-client.tsx`, `apps/web/src/components/photo-viewer-loading.tsx`, `apps/web/src/components/tag-input.tsx`, `apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/lib/storage/local.ts`, `apps/web/src/lib/upload-limits.ts`, `apps/web/src/lib/validation.ts`.
  - Untracked review/input files: `apps/web/scripts/prepare-next-typegen.mjs`, `plan/plan-249-cycle2-fresh-gate-fix.md`, `plan/plan-250-cycle1-implementation.md`, `plan/plan-251-cycle1-deferred.md`.
- Repository inventory built before analysis:
  - Root docs/scripts/config: `README.md`, `CLAUDE.md`, `AGENTS.md`, `.dockerignore`, `.gitignore`, `.env.deploy.example`, root `package.json` / `package-lock.json`, `scripts/deploy-remote.sh`, `plan/**`.
  - App configs/deploy: `apps/web/package.json`, `next.config.ts`, `eslint.config.mjs`, `playwright.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `drizzle.config.ts`, `Dockerfile`, `docker-compose.yml`, `nginx/default.conf`, `.env.local.example`, `.dockerignore`.
  - App source: 227 tracked TS/TSX files under `apps/web/src` spanning App Router pages/routes/actions, components, db, i18n, proxy, and libraries.
  - Tests: 71 unit tests under `apps/web/src/__tests__` and 8 Playwright/e2e helper/spec files under `apps/web/e2e`.
  - Scripts/migrations/assets: 15 top-level app scripts under `apps/web/scripts`, Drizzle SQL/meta files, message JSON files, `public/histogram-worker.js`, font/static upload fixtures.
- Skipped from line-by-line semantic review: `node_modules`, `.next`, `apps/web/test-results`, `playwright-report`, generated screenshots/logs, binary image/font/upload artifacts, `.omc`/`.omx` runtime state except the required prompt file. These were inventoried or deliberately excluded as generated/runtime/binary artifacts.

## Findings

- [CR2-CQ-01] Severity: High Confidence: High Classification: confirmed Cross-agent hint: debugger/test-engineer should add a two-page infinite-scroll regression test.
  - Location: `apps/web/src/components/home-client.tsx:82-88`, `apps/web/src/components/home-client.tsx:271-277`, `apps/web/src/components/load-more.tsx:80-87`
  - Problem: `HomeClient` creates a fresh cursor object every render with `getClientImageListCursor(images.at(-1))` and passes it as `initialCursor`. `LoadMore` treats `initialCursor` as a reset dependency. After a successful page append, `setAllImages` re-renders `HomeClient`, the cursor prop gets a new object identity, and the `LoadMore` reset effect restores `cursor` back to the first-page cursor.
  - Failure scenario: A gallery with more than 60 images loads page 2 successfully. The parent re-renders after `onLoadMore`; `LoadMore` resets to the original cursor; the next sentinel intersection fetches page 2 again, duplicating images and potentially keeping the user in a repeated-page loop.
  - Suggested fix: Memoize the initial cursor in `HomeClient` using scalar dependencies from the last initial image, or pass a primitive cursor key and reset only when the query changes. In `LoadMore`, avoid depending on object identity for reset; compare cursor fields or reset from `queryKey`/`initialOffset` only. Add a component/e2e regression that loads two consecutive pages and asserts no duplicate IDs.

- [CR2-CQ-02] Severity: High Confidence: High Classification: confirmed Cross-agent hint: build-fixer should run the app typecheck after the cursor type is repaired.
  - Location: `apps/web/src/components/home-client.tsx:55-67`, `apps/web/src/components/home-client.tsx:82-88`, `apps/web/src/components/home-client.tsx:275-276`
  - Problem: `GalleryImage` omits `capture_date` and `created_at`, but `getClientImageListCursor` requires an object with `capture_date`, `created_at`, and `id`. Inside `HomeClient`, `images.at(-1)` is typed as `GalleryImage | undefined`, so the new cursor call is not type-correct even though the database query currently selects those fields.
  - Failure scenario: Once the new typecheck wrapper reaches this file, TypeScript rejects the build because the client prop type no longer matches the cursor helper's required shape. If someone papers over the type error with a cast, future refactors can remove the fields from the server query without a compile-time guard and silently break cursor pagination.
  - Suggested fix: Add `capture_date: string | null` and `created_at: string | Date` to the `GalleryImage` contract, preferably by deriving the prop image type from `getImagesLitePage`/`getImagesLite` instead of duplicating a partial row shape. Reuse the exported `getImageListCursor` helper or keep one cursor-builder type source to avoid future drift.

- [CR2-CQ-03] Severity: Medium Confidence: High Classification: confirmed Cross-agent hint: verifier/test-engineer should lock restore/upload body-limit invariants.
  - Location: `apps/web/src/lib/upload-limits.ts:1-4`, `apps/web/src/lib/upload-limits.ts:15-27`, `apps/web/next.config.ts:69-77`, `apps/web/src/lib/db-restore.ts:1`, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:61-63`, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:185`, `apps/web/src/app/[locale]/admin/db-actions.ts:267-270`, `apps/web/src/app/[locale]/admin/db-actions.ts:357-358`
  - Problem: The new global Server Action/proxy transport cap defaults to `MAX_UPLOAD_FILE_BYTES + 16 MiB` (216 MiB), but the DB restore UI, action, comments, and nginx route still advertise/allow 250 MB restore files. Because `restoreDatabase` is invoked as a Server Action, Next can reject a 217-250 MB restore body before the action's own `MAX_RESTORE_SIZE_BYTES` check runs.
  - Failure scenario: An admin selects a 230 MB SQL dump. The client accepts it because it is below `MAX_RESTORE_SIZE_BYTES`, nginx accepts it because `/admin/db` is capped at 250M, but Next rejects the Server Action request at the smaller 216 MiB transport cap. The user gets the generic restore failure path instead of the documented 250 MB behavior.
  - Suggested fix: Make the framework body cap the maximum of all Server Action upload surfaces plus multipart overhead, or move DB restore upload to a dedicated route with route-specific body handling. Document and test `NEXT_UPLOAD_BODY_MAX_BYTES` if it remains an override. Add a config/unit invariant asserting the default Server Action cap is greater than or equal to `MAX_RESTORE_SIZE_BYTES` plus overhead while app-level per-surface validation remains stricter.

- [CR2-CQ-04] Severity: Medium Confidence: High Classification: confirmed Cross-agent hint: qa-tester/build-fixer should validate e2e env loading with shell-special secrets.
  - Location: `apps/web/playwright.config.ts:10-14`, `apps/web/playwright.config.ts:72-74`
  - Problem: The config first loads `.env.local` with Node's dotenv-compatible `process.loadEnvFile`, but the webServer command then prepends `. ${JSON.stringify(envPath)} &&` before every command. `.env.local` is a dotenv file, not guaranteed to be valid or safe POSIX shell syntax.
  - Failure scenario: A local `DB_PASSWORD` or `ADMIN_PASSWORD` containing `$`, backticks, quotes, whitespace, `#`, or command-substitution syntax is parsed correctly by `process.loadEnvFile` but expanded/truncated/executed by the shell `.` command. E2E init/build/server startup can fail with wrong credentials, or a developer-controlled env file can execute arbitrary shell while tests start.
  - Suggested fix: Stop shell-sourcing dotenv files. Use a small Node webServer runner that calls `process.loadEnvFile(envPath)` and spawns `npm run init`, `npm run e2e:seed`, `npm run build`, and `node .../server.js` with an explicit `env` object; or use Playwright's supported `webServer.env`/wrapper-script pattern. Keep all command arguments structured instead of concatenated shell strings.

- [CR2-CQ-05] Severity: Medium Confidence: High Classification: confirmed Cross-agent hint: test-engineer/build-fixer should broaden script-gate coverage.
  - Location: `apps/web/package.json:16-21`, `apps/web/tsconfig.scripts.json:7-10`, `apps/web/scripts/prepare-next-typegen.mjs:1-31`
  - Problem: The new `typecheck:scripts` gate compiles only `scripts/**/*.ts`; it excludes every JS/MJS script, including the new `prepare-next-typegen.mjs` that is now on the critical `typecheck:app` path, plus `ensure-site-config.mjs`, `migrate.js`, `migrate-capture-date.js`, and `mysql-connection-options.js`.
  - Failure scenario: A typo or API misuse in `prepare-next-typegen.mjs` (or a deploy/migration JS script) passes `npm run typecheck:scripts` and is caught only when `npm run typecheck`, Docker build, init, or deployment actually executes that script. This undermines the cycle's stated goal of making the build/typecheck gate deterministic and comprehensive.
  - Suggested fix: Convert critical JS/MJS scripts to TypeScript, or enable `allowJs` + `checkJs` for a dedicated scripts config that includes `scripts/**/*.{ts,js,mjs}`. If full JS typechecking is too noisy, at least add a `node --check` syntax gate for JS/MJS scripts and focused unit tests for `prepare-next-typegen.mjs` behavior.

- [CR2-CQ-06] Severity: Low Confidence: High Classification: likely Cross-agent hint: architect/security-reviewer should decide whether the experimental storage abstraction remains live API or should be removed.
  - Location: `apps/web/src/lib/storage/local.ts:22-37`, `apps/web/src/lib/storage/local.ts:122-131`
  - Problem: `LocalStorageBackend` validates keys through `resolve()` for read/write/delete/copy, but `getUrl()` implements a separate normalization path that only trims, swaps backslashes, and blocks `original/`. It does not reject empty keys, `..` segments, leading slashes, or other shapes that `resolve()` would reject.
  - Failure scenario: A future caller uses `getUrl()` with a key that came from admin/database state rather than a hardcoded derivative filename. Keys like `../x`, `/jpeg/a.jpg`, or `jpeg/../../x` produce malformed public URLs instead of failing fast, creating hard-to-debug broken links and a validation split between URL generation and filesystem access. The current live upload pipeline mostly bypasses this abstraction, which lowers immediate severity.
  - Suggested fix: Factor a shared `normalizeStorageKey()` used by both `resolve()` and `getUrl()`, reject the same invalid key shapes everywhere, then URL-encode individual path segments. If the abstraction is intentionally dormant, mark it internal/dead or remove it to avoid future callers assuming it is production-ready.

## Final Sweep

- Static/manual sweep covered the uncommitted diff, app source/actions/components/libs, auth/session/rate-limit/restore/upload paths, storage abstraction, build/typecheck scripts, Docker/nginx/deploy config, Playwright config, public/admin route interactions, unit/e2e tests, and docs/plans relevant to current changes.
- Pattern sweeps included server-action/auth/origin checks, global/process state, raw SQL and restore scanning, file upload/restore limits, cursor pagination, shell/env handling, and changed UI/client state flows.
- Findings above are limited to code quality, logic bugs, SOLID/maintainability, and cross-file correctness. Security-only, performance-only, and UI-only issues were noted only where they directly intersected code correctness/maintainability.
- No fixes were implemented and no application code was edited.

## Skipped/Limitations

- Skipped generated/runtime/binary artifacts: `node_modules`, `.next`, `.omc`, `.omx` runtime state beyond the required prompt, `apps/web/test-results`, Playwright reports, screenshots, uploaded image derivatives, fonts, and logs.
- Historical `.context/plans/**` and `.context/reviews/**` were not line-reviewed beyond current aggregate/provenance because the requested output was a current repository/code review, not a historical review audit.
- Verification commands were intentionally limited. A read-only `npx tsc -p tsconfig.typecheck.json --noEmit --pretty false --incremental false` attempt produced no output for roughly 25 seconds and was terminated to avoid spending the review window on a known gate-hang surface; no lint/test/e2e/build gates were run to completion.
