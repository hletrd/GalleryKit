# Cycle 15 Verifier Review

Date: 2026-07-07
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `6256a988`
Mode: evidence-based static correctness review, except this report file.

I did not implement fixes, commit, push, deploy, stop processes, remove files, or modify anything outside this assigned review file. I did not run the blocking gates because this assignment is a verifier/report pass; evidence below is from source, test, config, and repository-state inspection.

## Inventory Reviewed

I built the review inventory before analyzing findings.

- Required instructions: `AGENTS.md`, `CLAUDE.md` behavior/testing/deploy sections, `.context/reviews/prompts/common_review_scope.md`, `.context/reviews/prompts/verifier.md`.
- Repository state: `git status --short` showed no tracked code diffs and one unrelated untracked directory, `.context/reviews/cycle-8-2026-07-07/`; I did not touch it.
- Mechanical inventory: `apps/web/src/app` 81 files, `apps/web/src/components` 61, `apps/web/src/lib` 114, `apps/web/src/db` 3, `apps/web/src/__tests__` 359, `apps/web/e2e` 12, `apps/web/scripts` 28, `apps/web/drizzle` 33, deploy/config files 10.
- Specialty surface examined: server actions, public/admin route handlers, auth/origin/rate-limit guards, restore maintenance and mutation drains, upload/original privacy boundary, data/privacy select fields, semantic/OG/public API rate limits, service-worker cache contracts, migration journal/reconcile scripts/tests, Docker/deploy/nginx guarantees, and relevant behavior/source-contract tests.
- Final sweep: every file in the review-relevant specialty inventory was covered either by direct read or by targeted mechanical scans for the invariant it participates in. I did not sample only a subset of action/API/migration/privacy/restore files.

## Confirmed Issues

### VER-15-01 - `login` is not covered by the restore-window admin mutation barrier

Severity: High
Confidence: High
Status: Confirmed issue

Evidence:

- `CLAUDE.md:432-433` states that every mutating admin server action holds a shared process-local barrier slot for its whole body, and that restore sets the durable marker then drains in-flight slot holders before importing.
- `apps/web/src/lib/admin-mutation-barrier.ts:5-25` documents the exact race: an action admitted just before the marker flips can otherwise commit into the freshly restored database.
- `apps/web/src/app/[locale]/admin/db-actions.ts:520-531` relies on `drainAdminMutationsForRestore()` to prove no foreground admin mutation is still mid-body before `runRestore`.
- `apps/web/src/app/actions/auth.ts:79-84` only checks restore maintenance at login entry; there is no `using mutationSlot = acquireAdminMutationSlot()` in `login`.
- The same `login` function performs direct DB writes after that one-time check: login rate-limit increments at `apps/web/src/app/actions/auth.ts:131-143`, successful-attempt cleanup/audit around `193-208`, and a session insert plus pre-existing-session delete in a transaction at `220-232`.
- `apps/web/src/__tests__/auth-mutation-barrier-source.test.ts:13-47` source-tests barrier coverage for `updatePassword` and `logout`, but not for `login`, so the stated auth mutation-barrier coverage misses this mutating auth path.

Problem:

The restore drain only waits for actions that acquired a mutation slot. A login request can pass its maintenance check before restore starts, spend time in Argon2 verification, and then write rate-limit/session rows while the restore window is active. That violates the documented guarantee that admitted foreground admin mutations cannot commit into the freshly restored database.

Concrete failure scenario:

1. An admin submits a valid login. `login` sees no maintenance marker and starts rate-limit work plus password verification.
2. Another admin starts DB restore. Restore sets the durable maintenance marker and calls `drainAdminMutationsForRestore()`, but the login has no slot, so the drain succeeds.
3. The restore imports the dump while the login later inserts a new session and deletes other sessions. Depending on timing, the user can receive a cookie for a session row that was overwritten by the import, or the login can create a new post-restore session and delete sessions restored from the backup.

Suggested fix:

Acquire the restore mutation slot in `login` after same-origin/form validation and before the first DB mutation, then hold it through rate-limit updates, verification, session transaction, and redirects. Return `restoreInProgress` when acquisition fails. Add a source or behavior test mirroring `auth-mutation-barrier-source.test.ts` that proves `login` acquires the slot before `incrementRateLimit(...)` and before the session transaction.

## Likely Issues

None found beyond the confirmed issue above.

## Risks Requiring Manual Validation

### VER-15-02 - Legacy public-original startup guard does not prove the directory is empty recursively

Severity: Low
Confidence: Medium
Status: Risk requiring manual validation

Evidence:

- `CLAUDE.md:220` documents the public serving boundary as only `jpeg`, `webp`, and `avif`; `original/` is excluded.
- `apps/web/src/lib/upload-paths.ts:173-188` implements the production startup guard by reading only the direct entries in `public/uploads/original` and counting `entry.isFile()`.
- `apps/web/src/__tests__/upload-paths.test.ts:137-167` covers empty directories and direct regular files, but it does not cover nested directories containing files or symlink entries.
- `apps/web/nginx/default.conf:206-208` blocks direct `/uploads/original/` requests in the documented nginx path, but this does not by itself prove every nonstandard public-file or image-optimizer path is harmless if unexpected entries remain under the public tree.

Problem:

The guard proves "no direct regular files" rather than "no legacy public-original content remains." If a stale nested directory or symlink exists under `public/uploads/original`, production startup succeeds even though the public tree still contains legacy original material. The direct nginx block reduces exposure in the documented deployment, but the code/test evidence does not prove the stronger privacy invariant for all serving paths or local/dev paths.

Concrete failure scenario:

A manual migration leaves `public/uploads/original/import-batch/leaked.jpg` or a symlink-like entry under `public/uploads/original`. The production startup guard counts zero direct regular files and continues serving. Direct nginx requests to `/uploads/original/...` 404, but any serving path that bypasses that nginx location, such as local Next static serving or a future optimizer/static route change, could expose content the startup guard claimed was absent.

Suggested fix:

Make `assertNoLegacyPublicOriginalUploads()` fail or warn on any entry under the legacy directory, or recursively `lstat` and count regular files plus symlinks. Add tests for nested files, symlinks, and non-empty directories. If the intended contract is only "direct flat legacy originals," document that narrower scope explicitly in `CLAUDE.md` and the tests.

## Evidence of Cross-File Checks With No Finding

- Restore/background interactions: `admin-backfill.ts` lacks a foreground mutation slot, but `triggerAdminBackfill()` checks restore state, uses the color-pipeline advisory lock, and audit writes go through `trackBackgroundDbWrite`, which refuses new work during restore and is drained before import. I did not find a stronger defect there.
- Service worker: `public/sw.template.js`, generated `public/sw.js`, `lib/sw-cache.ts`, `sw-cache.test.ts`, and `sw-template-contract.test.ts` align on admin bypass, revocable route exclusions (`/c`, `/s`, `/g`, `/map` with optional locale), derivative caching, bounded HEAD revalidation, and generated-worker parity.
- Public API rate limiting: semantic search, similar search, and OG routes call the expected pre-increment helpers before protected DB/CPU-heavy work; `check-public-route-rate-limit.ts` recognizes approved helpers from `@/lib/rate-limit`.
- Privacy fields: `data.ts`, `search-enrichment-fields.ts`, `privacy-fields.test.ts`, and map/search privacy tests align on public-field omission and compile-time guards for sensitive keys.
- Migration journal: 30 SQL files match 30 journal entries, with no missing tags, untracked SQL, or duplicate `when` values. The reconcile coverage tests are source-tripwire based, but I did not find a current journal/reconcile mismatch in this pass.
- Deploy/disk hygiene: Docker compose bind mounts, `deploy.sh` prune-after-up ordering, and nginx upload/original/derivative locations match the documented deployment guarantees I checked.

## Final Sweep

- No relevant file in the verifier specialty inventory was intentionally skipped.
- The only file modified by this task is `.context/reviews/verifier.md`.
- No tests or build gates were run; this review is source-evidence based.
