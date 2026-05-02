# Cycle 1 verifier correctness review

Date: 2026-05-02 (Asia/Seoul)  
Role: verifier  
Scope: README, CLAUDE.md, package scripts, tests, deployment config, and implementation in `/Users/hletrd/flash-shared/gallery`.

## Inventory and files examined

I first inventoried the repository with `omx explore`, `git ls-files`, and targeted `rg` searches, then examined the relevant docs, scripts, tests, and implementation surfaces before writing this report. The repository currently has 1,476 tracked files. The relevant review inventory was:

- Workspace rules and docs: `AGENTS.md`, `README.md`, `CLAUDE.md`, `apps/web/README.md`.
- Package scripts/config: root `package.json`, `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/playwright.config.ts`, `apps/web/vitest.config.ts`, `apps/web/drizzle.config.ts`, `apps/web/eslint.config.mjs`, `apps/web/tsconfig*.json`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, env/site-config examples, and the checked-in `site-config.json`.
- Source implementation: 243 tracked `apps/web/src/**/*.ts(x)` files, including 55 app route/action files, 52 lib files, 46 component files, DB schema/index files, i18n messages, API routes, upload/image-processing paths, auth/session/origin guards, and admin/public UI flows.
- Tests: 85 tracked unit/source tests under `apps/web/src/**/__tests__` plus 5 Playwright specs under `apps/web/e2e`; relevant test helpers and lint gate scripts in `apps/web/scripts` were inspected.
- Skipped from manual line review as not relevant to the stated behavior: `node_modules`, generated/ignored `.next`, binary fixtures/assets/uploads, historical `.context` artifacts other than this report, and lockfile dependency resolution details beyond package-script/dependency checks. Runtime Playwright execution was skipped because `apps/web/scripts/run-e2e-server.mjs:75-84` runs DB init/seed/build before launching a local standalone server; the config/specs were inspected instead.

Working-tree note: `.context/reviews/tracer.md` was already modified by another process when this report was written. I did not stage or commit it, and I did not edit application code.

## Verification commands and results

- `npm run lint:api-auth --workspace=apps/web` — passed; the script reported the expected protected DB download API route.
- `npm run lint:action-origin --workspace=apps/web` — passed; mutating server actions were reported as same-origin guarded.
- `npm run typecheck --workspace=apps/web` — passed.
- `npm run lint --workspace=apps/web && npm test --workspace=apps/web` — passed on the final run; 85 test files / 607 tests.
- `npm run build --workspace=apps/web` — one earlier run passed. A later rerun was inconclusive because generated `.next` cleanup failed with a host filesystem error while unlinking `.next/trace`; no source-code build finding is raised from that generated-artifact failure.

## Findings

### HIGH-01 — Last-admin deletion can still race to zero admins

Severity: High  
Status: confirmed  
Confidence: High

Evidence:

- The documented/stated behavior says "Last admin deletion prevented to avoid lockout" in `CLAUDE.md:128-132`.
- `deleteAdminUser()` says its advisory lock is meant to serialize deletion so concurrent requests cannot both observe "more than one admin" in `apps/web/src/app/actions/admin-users.ts:198-215`.
- The actual lock name is per target user: `const lockName = getAdminDeleteLockName(id)` at `apps/web/src/app/actions/admin-users.ts:209-215`.
- `getAdminDeleteLockName()` explicitly scopes the lock to the target user ID in `apps/web/src/lib/advisory-locks.ts:26-32`.
- The protected invariant is checked with an unlocked count, then a target-row delete, inside each caller's transaction: `SELECT COUNT(*) AS count FROM admin_users` and `DELETE FROM admin_users WHERE id = ?` in `apps/web/src/app/actions/admin-users.ts:227-247`.

Failure scenario:

With exactly two admins A and B, two authenticated requests can concurrently delete different target users. Request 1 deletes B and obtains `gallerykit_admin_delete:B`; request 2 deletes A and obtains `gallerykit_admin_delete:A`. Because those locks differ, both transactions can count 2 admins, both pass the `<= 1` guard, and both delete their target. The result is zero admin users, violating the lockout-prevention contract.

Suggested fix:

Use a single global admin-delete lock for all admin-user deletions, or lock a shared DB row/table range so the count-and-delete sequence is serialized across all targets. Add a regression test that runs two concurrent `deleteAdminUser` calls against different admins and asserts one succeeds while the other returns the last-admin error.

### MEDIUM-01 — Upload body-cap documentation conflicts with shipped nginx/app behavior

Severity: Medium  
Status: confirmed  
Confidence: High

Evidence:

- `README.md:145` says the shipped nginx config caps general requests at **2 GiB** and `/admin/db` restore requests at **250 MB**.
- `CLAUDE.md:219-220` repeats that general reverse-proxy body caps are **2 GiB** and restore caps are **250 MB**.
- `apps/web/README.md:41` says the total batch upload size defaults to **2 GiB** and refers to larger multipart bodies.
- The shipped nginx default is instead `client_max_body_size 2M` at `apps/web/nginx/default.conf:29-31`.
- The dashboard upload route is capped at `216M`, not 2 GiB, at `apps/web/nginx/default.conf:89-93`.
- The DB restore route is capped at `250M` at `apps/web/nginx/default.conf:72-76`.
- App limits show a 200 MiB per-file upload cap, 250 MiB restore cap, and server-action transport cap derived from restore plus 16 MiB overhead in `apps/web/src/lib/upload-limits.ts:1-7` and `apps/web/src/lib/upload-limits.ts:15-17`.
- `next.config.ts` applies that derived server-action/proxy body limit, not 2 GiB, at `apps/web/next.config.ts:69-77`.
- The dashboard currently submits one file per server action, not a 2 GiB multipart batch, in `apps/web/src/components/upload-dropzone.tsx:199-216` and serializes those calls in `apps/web/src/components/upload-dropzone.tsx:239-246`.

Failure scenario:

An operator following README/CLAUDE expects a shipped 2 GiB general request allowance and may size proxy/temp-storage/container settings around a single large multipart body. In the checked-in deployment, dashboard uploads over roughly 216 MiB are rejected by nginx before the app, non-dashboard requests over 2 MiB are rejected, and the Next server-action parser is configured around the 250 MiB restore surface rather than a 2 GiB request. The docs therefore describe behavior the deployment does not provide.

Suggested fix:

Update README, `apps/web/README.md`, and CLAUDE.md to describe the actual caps: 2 MiB default, 216 MiB dashboard upload, 250 MiB DB restore, 200 MiB per file, and the current one-file-at-a-time upload flow. If a true 2 GiB single-request upload body is intended, change nginx and the Next server-action body limit together and add tests asserting that configuration.

### LOW-01 — Settings UI lets admins toggle a write-once GPS setting that the server will reject

Severity: Low  
Status: confirmed  
Confidence: High

Evidence:

- The settings page passes `hasExistingImages={imageCount > 0}` to the client in `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx:23`.
- The UI disables `image_sizes` when images exist in `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:142-155`.
- The adjacent `strip_gps_on_upload` switch remains enabled and updates form state regardless of `hasExistingImages` in `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:170-180`.
- The same UI then shows a lock message saying image size and GPS settings are write-once in `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:182-185`.
- The server rejects changed `strip_gps_on_upload` values once any image exists in `apps/web/src/app/actions/settings.ts:115-132`.

Failure scenario:

After a gallery has images, an admin can toggle the GPS stripping switch and submit the form. The client appears to accept the change, but the server returns `uploadSettingsLocked`. This is not data loss, but it is a correctness/UX mismatch between the visible control state and the server's write-once upload-processing contract.

Suggested fix:

Disable the `strip_gps_on_upload` switch when `hasExistingImages` is true, just like `image_sizes`, and connect it to the lock hint with `aria-describedby`. Add a component or interaction test that verifies both write-once controls are disabled after images exist.

### LOW-02 — Image zoom math tests duplicate private implementation instead of testing production code

Severity: Low  
Status: risk  
Confidence: High

Evidence:

- `apps/web/src/__tests__/image-zoom-math.test.ts:3-39` says the math is extracted from `image-zoom.tsx`, then redefines `MIN_ZOOM`, `MAX_ZOOM`, `SNAP_THRESHOLD`, `touchDistance`, `touchMidpoint`, `clampZoom`, `wheelStep`, and `clampPan` inside the test file.
- The production component has its own private constants/functions at `apps/web/src/components/image-zoom.tsx:12-38`.

Failure scenario:

A future regression in the production image-zoom helpers can be missed because the unit test exercises a copied implementation, not the code used by `ImageZoom`. For example, changing the production clamp range, clamp direction, or wheel scaling would not necessarily fail this test unless the copied test code were changed too.

Suggested fix:

Move the pure math helpers to a small production module such as `src/lib/image-zoom-math.ts`, import that module from both `ImageZoom` and the test, and keep component-level tests for DOM/wheel/pinch behavior where practical.

## Final missed-issues sweep

- Searched all admin-delete lock references with `rg "getAdminDeleteLockName|gallerykit_admin_delete|LAST_ADMIN|COUNT\\(\\*\\).*admin_users|deleteAdminUser"`; the only serialization path is the per-target advisory lock described in HIGH-01.
- Searched upload-cap references with `rg "client_max_body_size|UPLOAD_MAX_TOTAL_BYTES|NEXT_UPLOAD_BODY_MAX_BYTES|SERVER_ACTION_UPLOAD_BODY_BYTES|MAX_UPLOAD_FILE_BYTES|2 GiB|250 MB|216M|200 MB"`; no hidden 2 GiB nginx/server-action cap was found.
- Searched settings-lock references with `rg "uploadContractLocked|uploadSettingsLocked|strip_gps_on_upload|image_sizes|hasExistingImages"`; the server lock exists for both upload-processing settings, but the client disables only `image_sizes`.
- The API auth lint gate, server-action origin lint gate, typecheck, ESLint, and Vitest suite all passed on the final run.
- Playwright runtime was not executed for this verifier pass because the checked-in local runner initializes/seeds the configured DB and rebuilds the standalone app (`apps/web/scripts/run-e2e-server.mjs:75-84`). Specs/config/helpers were still inventoried and inspected.
- No application files were edited by this verifier.

## Counts by severity

- Critical: 0
- High: 1
- Medium: 1
- Low: 2
- Total findings: 4
