# Cycle 2 recovery — review fixes plan

Status: complete
Created: 2026-04-24
Source aggregate: `.context/reviews/_aggregate.md` (Cycle 2 / Prompt 1 Recovery)

## Repo-policy inputs consulted before planning

- `CLAUDE.md`: Node 24+, formal gates, security lint gates, local-only storage warning, auth/session/rate-limit architecture, deployment notes, git workflow.
- `AGENTS.md`: always commit/push; use gitmoji; keep diffs small/reviewable/reversible; run lint/typecheck/build/tests/static analysis.
- `.context/**`: previous plans/reviews and recovered partial review artifacts. No rule authorizes deferring confirmed security/correctness/data-loss bugs.
- `.cursorrules`: not present.
- `CONTRIBUTING.md`: not present.
- `docs/**` style/policy files: not present.

Every current aggregate finding is scheduled below. No current aggregate finding is deferred; see `plan/cycle2-recovery-deferred.md` for the disposition map.

## Planned implementation tasks

### C2REC-01 — Revalidate direct-share and group-share pages after image deletion

- **Source finding:** AGG2C2-01.
- **Files:** `apps/web/src/app/actions/images.ts`, `apps/web/src/__tests__/images-delete-revalidation.test.ts` (new/static or unit regression).
- **Severity / confidence:** HIGH / High.
- **Goal:** prevent stale cached `/s/{shareKey}` and `/g/{groupKey}` pages from surviving an admin image delete.
- **Plan:**
  1. Include `images.share_key` in single/batch delete metadata queries.
  2. Add a helper to collect affected `sharedGroups.key` rows via `sharedGroupImages` before deletion.
  3. Include `/s/{key}` and `/g/{key}` in targeted `revalidateLocalizedPaths(...)` for single and small batch deletes; keep `revalidateAllAppData()` for large batches.
  4. Add regression coverage guarding the share/group revalidation paths.
- **Progress:** [x] implemented and verified.

### C2REC-02 — Make auth DB-backed rate-limit checks include the current request

- **Source finding:** AGG2C2-02.
- **Files:** `apps/web/src/app/actions/auth.ts`, `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts`.
- **Severity / confidence:** MEDIUM / High.
- **Goal:** close the cross-process check-before-increment race for login IP, login account, and password-change buckets.
- **Plan:**
  1. Import/use `isRateLimitExceeded` in `auth.ts`.
  2. Move DB `incrementRateLimit(...)` before DB `checkRateLimit(...)` for login and password change.
  3. Check with `includesCurrentRequest=true` and roll back pre-incremented counters before returning `tooManyAttempts`.
  4. Update static regression tests to assert increment-before-check order while preserving validation-before-password-change-increment behavior.
- **Progress:** [x] implemented and verified.

### C2REC-03 — Share DB SSL policy between app runtime and backup/restore CLI

- **Source finding:** AGG2C2-03.
- **Files:** `apps/web/src/lib/mysql-cli-ssl.ts` (new), `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/__tests__/mysql-cli-ssl.test.ts` (new).
- **Severity / confidence:** MEDIUM / High.
- **Goal:** make `DB_SSL=false` consistently disable TLS for non-local backup/restore CLI paths, matching runtime DB and migration behavior.
- **Plan:**
  1. Add a small helper that returns `[]` for local hosts or `DB_SSL=false`, otherwise `['--ssl-mode=REQUIRED']`.
  2. Use it for both `mysqldump` and `mysql` restore spawn args.
  3. Cover local, remote default, and remote opt-out behavior in unit tests.
- **Progress:** [x] implemented and verified.

### C2REC-04 — Lock output-size changes once any image exists

- **Source finding:** AGG2C2-04.
- **Files:** `apps/web/src/app/actions/settings.ts`, `apps/web/messages/en.json`, `apps/web/messages/ko.json`, `apps/web/src/__tests__/settings-image-sizes-lock.test.ts` (new/static regression).
- **Severity / confidence:** MEDIUM / Medium-High.
- **Goal:** prevent derivative filename mismatches from changing `image_sizes` while uploaded images are still processing.
- **Plan:**
  1. Change the lock query from `processed=true` to any existing image row.
  2. Update admin copy to say output sizes are locked after photos have been uploaded, not only after processing.
  3. Add regression coverage so the lock cannot regress back to `images.processed`.
- **Progress:** [x] implemented and verified.

### C2REC-05 — Reorder quick-start docs around environment setup

- **Source finding:** AGG2C2-05.
- **Files:** `README.md`, `apps/web/README.md`.
- **Severity / confidence:** MEDIUM / High.
- **Goal:** make first-run docs executable by creating/editing env and site config before DB init.
- **Plan:**
  1. Reorder root quick-start steps: install, create DB/user, copy/edit `.env.local`, copy/edit site config, run init, run dev.
  2. Apply the same order to the app README.
  3. Add a small smoke-check note: log in, upload one photo, confirm public homepage renders.
- **Progress:** [x] implemented and verified.

## Gate requirements

Run against the whole repo after implementation:
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test`
- `npm run test:e2e`


## Progress log

- 2026-04-24: Implemented C2REC-01 through C2REC-05.
- 2026-04-24: Verification passed: targeted Vitest (`mysql-cli-ssl`, image delete revalidation, settings image-size lock, auth rate-limit ordering) 4 files / 19 tests; `npm run lint`; `npm run typecheck`; `npm run test` (57 files / 329 tests); `npm run build`; `npm run test:e2e` (20 Playwright tests); `npm run lint:api-auth`; `npm run lint:action-origin`.
- 2026-04-24: E2E gate required a temporary local MySQL 8.4 container because no server was listening on `127.0.0.1:3306`; after database initialization, the full E2E suite passed.
- 2026-04-24: Ralph deslop pass scoped to changed code/test/docs/plan files found no behavior-preserving cleanup worth applying beyond the already minimal helpers/tests; no post-deslop code changes were made, so prior green gates remain current.
- 2026-04-24: Architect-agent verification was attempted for Ralph sign-off, but the platform child-agent limit still returned `agent thread limit reached (max 6)`. Self-verification used full gates plus diff review instead.
