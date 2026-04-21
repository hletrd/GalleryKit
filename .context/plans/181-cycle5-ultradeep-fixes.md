# Plan 181 — Cycle 5 Ultradeep Fixes

**Created:** 2026-04-22  
**Status:** DONE  
**Purpose:** Fix the highest-signal cycle-5 findings that are safely patchable in a bounded pass while honoring the user-injected self-resolving deploy/env requirements.

## Scheduled fixes

### C181-01: Make restore mode a real application write barrier
**Severity:** HIGH | **Confidence:** High  
**Sources:** `C5-01` in `.context/reviews/_aggregate.md`, `.context/reviews/code-reviewer.md`, `.context/reviews/security-reviewer.md`, `.context/reviews/debugger.md`

Implementation:
1. Add a reusable restore-maintenance guard helper in `apps/web/src/lib/restore-maintenance.ts`.
2. Apply that guard to conflicting authenticated mutations (DB export/backup/restore-adjacent admin actions, settings/SEO/topic/tag/share/admin-user/image mutations, password change/logout/login as needed where they write sessions or DB state).
3. Re-check `uploadImages()` after preprocessing and before DB insert so in-flight uploads stop cleanly if restore begins mid-request.
4. Keep return shapes stable by using existing `restoreInProgress` translation messaging.

### C181-02: Surface the restore file-size limit before the server action runs
**Severity:** MEDIUM | **Confidence:** High  
**Sources:** `C5-02` in `.context/reviews/_aggregate.md`, `.context/reviews/designer.md`, `.context/reviews/dependency-expert.md`

Implementation:
1. Extract the 250 MB restore limit into a shared lib constant consumable by both server and client code.
2. Use that shared constant in `db-actions.ts` instead of a local magic number.
3. Add DB admin UI copy that states the supported maximum restore size.
4. Reject oversized selected files client-side before submit and show localized feedback.

### C181-03: Add regression coverage for the restore barrier contract
**Severity:** MEDIUM | **Confidence:** High  
**Sources:** `C5-03` in `.context/reviews/_aggregate.md`, `.context/reviews/test-engineer.md`, `.context/reviews/verifier.md`

Implementation:
1. Extend `apps/web/src/__tests__/restore-maintenance.test.ts` to cover the new reusable guard helper.
2. Add focused regression coverage for the upload/restore boundary helper behavior (clean blocking signal when maintenance is active at the write boundary).

### U181-01: Populate the gitignored deploy env so future runs self-resolve without asking
**Severity:** user-injected TODO | **Confidence:** High  
**Sources:** user TODOs (`"find yourself and make sure to not ask again."`, `"please add config to gitignored env."`), current run context deploy command

Implementation:
1. Parse the active deploy target from the current run context (`gallery.atik.kr`, `ubuntu`, `~/.ssh/atik.pem`, `/home/ubuntu/gallery`, `bash apps/web/deploy.sh`).
2. Write those values into the gitignored root `.env.deploy` using the derived-field mode (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KEY`, `DEPLOY_PATH`, `DEPLOY_REMOTE_SCRIPT`) so `npm run deploy` self-resolves locally.
3. Do **not** commit `.env.deploy` because repo policy intentionally keeps it gitignored.

## Verification target
- `npm run lint --workspace=apps/web`
- `npm run build`
- `npm test --workspace=apps/web`
- `npm run test:e2e --workspace=apps/web`
- `npm run deploy` equivalent via the configured per-cycle deploy command

## Progress
- [x] C181-01: restore maintenance guard applied across conflicting write paths
- [x] C181-02: shared restore size constant + DB page preflight size guidance
- [x] C181-03: restore-maintenance regression coverage extended
- [x] U181-01: root gitignored `.env.deploy` populated from the active deploy target
- [x] `npm run lint --workspace=apps/web`
- [x] `npm test --workspace=apps/web`
- [x] `npm run build`
- [x] `npm run test:e2e --workspace=apps/web`
