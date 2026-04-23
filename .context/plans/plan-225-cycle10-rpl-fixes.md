# plan-225 — cycle 10 rpl fixes

Source: `.context/reviews/_aggregate-cycle10-rpl.md`.

HEAD at plan authoring: `0000000f3d0f7d763ad86f9ed9cc047aad7c0b1f`.

This plan addresses the cycle-10 rpl must-fix items. Deferred items live in `plan-226-cycle10-rpl-deferred.md`.

Must-fix findings:
- AGG10R-RPL-01 (LOW / HIGH) — `createAdminUser` rate-limit ordering. Scheduled here.
- AGG10R-RPL-04/-05/-06/-07 — reap stale or false-positive deferred items from plan-218 (no code change; plan doc cleanup).

## Task AGG10R-RPL-01 — Move `createAdminUser` form-field validation above rate-limit pre-increment

### Change

`apps/web/src/app/actions/admin-users.ts` function `createAdminUser` (lines ~69-166).

Move the following blocks FROM the position AFTER the rate-limit pre-increment (current lines 107-125) TO the position JUST AFTER `getRestoreMaintenanceMessage` check (current line 76) and BEFORE the `const requestHeaders = await headers();` line:

```ts
const rawUsername = formData.get('username')?.toString() ?? '';
const username = stripControlChars(rawUsername) ?? '';
// Sanitize before validation so length checks operate on the same value
// that will be hashed (matches uploadImages tagsString pattern, see C46-01).
// C0 controls in passwords are almost always accidental paste artifacts.
const password = stripControlChars(formData.get('password')?.toString() ?? '') ?? '';
const confirmPassword = stripControlChars(formData.get('confirmPassword')?.toString() ?? '') ?? '';

// Reject malformed input: if sanitization changes the value, the input
// contained control characters and must not silently proceed (defense in
// depth — matches updateTopic/deleteTopic pattern, see C7R2-05).
if (username !== rawUsername) return { error: t('invalidUsernameFormat') };

if (!username || username.length < 3) return { error: t('usernameTooShort') };
if (username.length > 64) return { error: t('usernameTooLong') };
if (!/^[a-zA-Z0-9_-]+$/.test(username)) return { error: t('invalidUsernameFormat') };
if (!password || password.length < 12) return { error: t('passwordTooShortCreate') };
if (password.length > 1024) return { error: t('passwordTooLongCreate') };
if (password !== confirmPassword) return { error: t('passwordsDoNotMatch') };
```

After this move, the rate-limit block (`getClientIp`, `checkUserCreateRateLimit`, `incrementRateLimit`+`checkRateLimit`) runs only after all form fields have been validated — matching the `login` and `updatePassword` ordering.

Rationale: legitimate admin typos (empty field / too short / regex mismatch / password mismatch) should not consume a rate-limit attempt. Only actual authenticated-admin create-attempts (which run Argon2) should count.

### Test

Add a new test file `apps/web/src/__tests__/admin-user-create-ordering.test.ts` (or integrate into existing `admin-users.test.ts`) that:

1. Mocks `isAdmin` to return true.
2. Mocks `requireSameOriginAdmin` to return null.
3. Mocks `getRestoreMaintenanceMessage` to return null.
4. Invokes `createAdminUser` with an empty `username` 20 times.
5. Asserts the in-memory `userCreateRateLimit` Map does NOT grow beyond 0 for the test IP.
6. Asserts no DB `incrementRateLimit` was called with `'user_create'` bucket.

If mocking the headers/connection path is painful, an integration-style test that verifies the first-call `userCreateRateLimit.get(ip)?.count` stays at 0 after repeated validation-error calls is acceptable.

### Verification

- `npm run lint --workspace=apps/web` — must pass.
- `npm test --workspace=apps/web` — must pass with new test included.
- `npm run build --workspace=apps/web` — must pass.
- `npm run lint:api-auth --workspace=apps/web` — must pass.
- `npm run lint:action-origin --workspace=apps/web` — must pass.
- `npm run test:e2e --workspace=apps/web` — must pass.

### Commit message

```
fix(admin): 🛡️ validate createAdminUser fields before rate-limit increment (AGG10R-RPL-01)

Mirror the AGG9R-RPL-01 fix applied to updatePassword. Move
stripControlChars + length/regex/match validation above the rate-limit
pre-increment so legitimate authenticated-admin typos do not consume
the 10-per-hour user_create budget. Without this, an admin mistyping
a short username or mismatched confirm-password ten times locks
themselves out of user creation for an hour even though no Argon2
hash ever runs.

Ref: AGG10R-RPL-01 (.context/reviews/_aggregate-cycle10-rpl.md).
```

## Task AGG10R-RPL-04 — Remove already-completed items from plan-218 carry-forward

### Change

No code change. Plan-doc housekeeping only.

In the new deferred plan (plan-226-cycle10-rpl-deferred.md), do NOT carry forward the following items. They were deferred in plan-218 but are in fact already done:

- **AGG9R-RPL-04** — "CLAUDE.md missing account-scoped login rate limit docs." VERIFIED DONE in CLAUDE.md:125.
- **AGG9R-RPL-05** — "CLAUDE.md missing gallerykit:image-processing:<id> advisory lock docs." VERIFIED DONE in CLAUDE.md:190-191.

Also withdraw these false-positive "dead code" flags:

- **AGG9R-RPL-10** — `searchImages` length check. Defense-in-depth; add clarifying comment.
- **AGG9R-RPL-12** — `deleteTopicAlias` \x00 regex. Defense-in-depth; keep.
- **AGG9R-RPL-14** — `recordFailedLoginAttempt` consumed by tests; keep export.

### Verification

- Grep/read plan-226 after writing to confirm the withdrawn items are NOT listed.

### Commit message

Plan doc changes are included in the same commit as the final aggregation (plan files tend to ship with the reviews).

## Execution order

1. AGG10R-RPL-01 (code + test) as a single commit.
2. Plan-doc updates (plan-225, plan-226) ship as a separate commit under `docs(plan): ...`.

## Post-execution

- Update `.context/reviews/_aggregate-cycle10-rpl.md` with a "Status" section recording the commit hashes.
- Move this plan file to `.context/plans/done/` once both commits landed and all gates passed.
