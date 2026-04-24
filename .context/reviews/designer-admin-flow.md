# Designer / Admin Flow Review — Cycle 3

**Date:** 2026-04-23
**Scope:** All `/[locale]/admin/*` routes (protected + login). Flows covered: login (success + failure + rate-limited), dashboard, tag CRUD, topic CRUD, user management, password change, SEO, settings, DB backup/restore, sharing.
**Method:** Playwright-driven navigation + source review of `apps/web/src/app/[locale]/admin/**`, action files in `apps/web/src/app/actions/*.ts`, and admin-facing components.

## Flow-level observations

### Admin login (LoginForm + login server action)

- Login form (`apps/web/src/app/[locale]/admin/login-form.tsx`) has proper `sr-only` labels, `autoFocus` on username, `maxLength={64}` on username and `maxLength={1024}` on password.
- `autoComplete="username"` and `autoComplete="current-password"` are set — enables OS password manager.
- `Button` shows "Submitting..." during `isPending`; success redirects to `/[locale]/admin/dashboard`.
- On error, `toast.error(state.error)` emits via `useEffect` on `state` change — correct pattern using `useActionState`.
- Server-side: `login` action (`apps/web/src/app/actions/auth.ts:70-240`) enforces:
  - Dummy-hash timing equalization (line 57-68)
  - Rate-limit pre-increment + rollback on infra errors (line 132-144, 228-238)
  - Account-scoped rate limit (line 117-130)
  - `hasTrustedSameOrigin` origin check (line 93)
  - Session fixation prevention via transaction-wrapped insert + delete (line 190-202)
  - Argon2id verify against real or dummy hash

**Findings:** None. Robust.

### Admin password change

- `apps/web/src/app/actions/auth.ts:261-402`: `updatePassword` action rate-limits on a separate map (`passwordChangeRateLimit`), uses `unstable_rethrow(e)` to preserve Next.js control-flow (C2R-01), rolls back rate-limit on infra errors.
- Clears rate-limit only after tx commit (C1R-02).
- `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx` — client form using `useActionState`.
- Validates `currentPassword`, `newPassword`, `confirmPassword`; min 12 / max 1024 length.
- **Finding ADMIN-01:** No visible feedback that minimum length is 12 characters — the form does not hint at the constraint. A user typing an 8-char password only learns "Password too short" post-submit. **[LOW]**

### Admin user management (`apps/web/src/components/admin-user-manager.tsx`)

- `createAdminUser` action rate-limits on `userCreationRateLimit` (separate map).
- Deletion prevented for "last admin" to avoid lockout.
- Session invalidation on delete (per `CLAUDE.md`).
- **Finding ADMIN-02:** Create form placeholder reads `{username usernameFormat}` from translations but the form has `maxLength` set that is not surfaced to the user (the user must read the constraint from the translation string). This is minor polish. **[LOW]**

### Admin topic (categories) management

- `topic-manager.tsx` — CRUD with alias support.
- `createTopic` / `updateTopic` / `deleteTopic` all behind `requireSameOriginAdmin` (C2R-02/03).
- Topic slug validation enforces lowercase — a fix applied in C1R-06.
- **Finding ADMIN-03:** On delete of a topic that has associated images, the confirmation dialog text "Delete this category? This cannot be undone." does not mention what happens to the images (they remain in DB but their `topic` foreign key orphans to the slug string; images still render since `topic` is a string, not a FK constraint). **Confirmation text could be clearer.** **[LOW]**

### Admin DB backup / restore

- `db-actions.ts:dumpDatabase` — mysqldump via `MYSQL_PWD` env var, not `-p` flag.
- `restoreDatabase` — validates file header bytes (SQL INSERT / CREATE keywords), uses `--one-database` flag, sets `isRestoreMaintenanceActive` during execution.
- Restore activates app-wide maintenance message via `restore-maintenance.ts`.
- `dangerZone` warning on the page: "This cannot be undone."
- **Finding ADMIN-04:** Restore confirms via JS `confirm()` dialog, not a styled `AlertDialog`. Inconsistent with the rest of the admin surface (which uses `AlertDialog` for destructive actions). The JS `confirm()` also does not render during an e2e test cleanly. **[LOW]**

### Admin SEO

- `seo-client.tsx` — straightforward form; `updateSeoSettings` action behind `requireSameOriginAdmin`.
- Successful update rehydrates form from server response (C1R-04).

**Findings:** None new.

### Admin Settings

- `settings-client.tsx` — image quality / size / strip_gps.
- `updateGallerySettings` normalizes and canonicalizes on server, returns the persisted values so UI rehydrates (C1R-04).
- **Finding ADMIN-05:** The `image_sizes` input uses `pattern="[0-9]+(\s*,\s*[0-9]+)*"` but the input has `type="text"` (default). Browser pattern enforcement only runs on submit and gives a generic error. Also, the hint text is somewhere else. Consider a more structured input (e.g., tag-like pills) for sizes. Polish only. **[LOW]**

### Admin Sharing (Shared groups / links)

- `sharing.ts` actions behind `requireSameOriginAdmin`, rate-limited, transactional.
- **Finding ADMIN-06:** No UI to rotate/expire a shared-group view count bucket. Carry-forward D6-10 (durable shared-group view counts). **[INFO]**

### Dashboard

- Shows recent uploads and quick actions.
- Upload dropzone at `/admin/dashboard`.
- **Finding ADMIN-07:** Upload progress shows `completedCount / totalFiles` but on partial failure does not clearly indicate which files failed (only count). Already an observation; see `upload-dropzone.tsx:193-201`. **[LOW]**

## Destructive action confirmation audit

| Action | Confirmation style | Finding |
|---|---|---|
| Delete user | `AlertDialog` (shadcn) | OK |
| Delete topic | `AlertDialog` | OK |
| Delete tag | `AlertDialog` | OK |
| Delete alias | `AlertDialog` | OK |
| Restore DB | `window.confirm()` | ADMIN-04 — inconsistent |
| Delete image (single) | `AlertDialog` | OK |
| Batch delete images | `AlertDialog` | OK |
| Change password | No confirmation | OK (reversible by user) |
| Logout | No confirmation | OK |

## Totals

- **0 CRITICAL / HIGH**
- **0 MEDIUM**
- **5 LOW** (ADMIN-01 through ADMIN-05, excluding ADMIN-06/07 as INFO / carry-forward)
- **2 INFO** (ADMIN-06 carry-forward, ADMIN-07 observation)
