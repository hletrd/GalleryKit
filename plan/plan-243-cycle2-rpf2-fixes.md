# Plan 243 — Cycle 2 RPF2 in-scope polish

**Source review:** `.context/reviews/_aggregate-cycle2-rpf2.md`
**Created:** 2026-04-25 (orchestrator-cycle 2 of the 100-cycle review-plan-fix loop)
**Repo policy honored:** small reviewable changes; conventional-commit + gitmoji; GPG-signed; no `--no-verify`; tests + lint + typecheck + build must remain green.

## Scope

Address the in-scope Low-severity findings from cycle 2 RPF2 that are small, bounded, and have low regression risk. Larger items move to `plan/plan-244-cycle2-rpf2-deferred.md` with severity preserved and exit criteria recorded.

## Tasks

### Task 1 — C2L2-01: surface lock-acquisition errors as friendly i18n errors

**Status:** pending
**Severity:** Low / High confidence
**Files:**
- `apps/web/src/lib/upload-processing-contract-lock.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/settings.ts`

**Plan:** Wrap `acquireUploadProcessingContractLock()` call sites in try/catch (or change the helper to return `null` on `connection.getConnection()` rejection instead of re-throwing). When the helper rejects, the action currently throws a 500. Returning a friendly i18n `uploadSettingsLocked` keeps the user-facing UX consistent with the lock-timeout path.

**Acceptance:** A simulated `connection.getConnection()` rejection from the upload server action returns `{ error: t('uploadSettingsLocked') }` instead of throwing.

### Task 2 — C2L2-03: bound user_filename byte length, not just character length

**Status:** pending
**Severity:** Low / High confidence
**Files:**
- `apps/web/src/app/actions/images.ts` (`getSafeUserFilename`)

**Plan:** Compute `Buffer.byteLength(sanitized, 'utf8')` and reject when it exceeds 255 bytes. Keeps the column constraint honored even for high-codepoint filenames.

**Acceptance:** A 250-character CJK filename is rejected at the action boundary instead of failing at insert time.

### Task 3 — C2L2-05: drop the redundant double `.trim()` in `getSafeUserFilename`

**Status:** pending
**Severity:** Low / High confidence
**Files:**
- `apps/web/src/app/actions/images.ts:38`

**Plan:** Replace `stripControlChars(path.basename(filename).trim())?.trim() ?? ''` with the simpler `stripControlChars(path.basename(filename))?.trim() ?? ''`. `stripControlChars` already removes ASCII control chars; the trailing `.trim()` then handles whitespace and the result is uniform.

**Acceptance:** existing `images-actions.test.ts` still passes; helper still rejects empty/oversized filenames.

### Task 4 — C2L2-07: log lock-acquisition timeouts at debug

**Status:** pending
**Severity:** Low / High confidence
**Files:**
- `apps/web/src/lib/upload-processing-contract-lock.ts`

**Plan:** Add a `console.debug('GET_LOCK (upload processing contract) returned ${acquired}')` line on the `null`-return path. Operators can then distinguish "user collision" from "lock infra returned NULL/0/timeout" in production logs.

**Acceptance:** code path is exercised in the existing test suite; no behavior change other than the debug line.

### Task 5 — C2L2-08: tighten data/backups directory mode

**Status:** pending
**Severity:** Low / High confidence
**Files:**
- `apps/web/src/app/[locale]/admin/db-actions.ts:122-125`

**Plan:** Pass `{ recursive: true, mode: 0o700 }` to `fs.mkdir(backupsDir, ...)` so the directory is owner-only readable. Aligns directory mode with the per-file `0o600` mode already on backups.

**Acceptance:** new directories created on a clean install are mode `0o700`. Existing directories are not retroactively changed (operators can `chmod` if needed).

## Out of scope (deferred)

- C2L2-02 (advisory lock scope across upload window) — bounded; would need broader refactor of the upload contract lock semantics. Deferred.
- C2L2-04 (helper asymmetry between IP/account rate-limit rollback) — readability, no behavioral bug. Deferred.
- C2L2-06 (Symbol.for-keyed restore-maintenance singleton) — dev-only, prod cannot hot-reload, CLAUDE.md already documents single-writer constraint. Deferred.
- C2L2-09 (decrementRateLimit two round-trips) — perf polish. Deferred.

See `plan/plan-244-cycle2-rpf2-deferred.md` for these.

## Progress

- [x] Task 1 — C2L2-01 (lock-acquisition error → i18n) — `apps/web/src/lib/upload-processing-contract-lock.ts` now returns `null` on connection acquisition / GET_LOCK round-trip rejection instead of throwing, so callers surface a friendly i18n error.
- [x] Task 2 — C2L2-03 (filename byte-length bound) — `getSafeUserFilename` now enforces a 255-byte UTF-8 budget, not a 255-character budget.
- [x] Task 3 — C2L2-05 (double-trim cleanup) — collapsed to a single trailing `.trim()` after `stripControlChars`.
- [x] Task 4 — C2L2-07 (lock-timeout debug log) — both the connection-failure and the non-1 GET_LOCK return now `console.debug` the failure mode for operator triage.
- [x] Task 5 — C2L2-08 (backups dir mode 0o700) — `data/backups` directory created with mode `0o700` to align with per-file `0o600`.
