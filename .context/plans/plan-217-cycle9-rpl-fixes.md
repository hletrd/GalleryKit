# plan-217 — cycle 9 rpl fixes

Source: `.context/reviews/_aggregate-cycle9-rpl.md`.

HEAD at plan authoring: `00000002ad51a67c0503f50c3f79c7b878c7e93f`.

This plan addresses the cycle-9 rpl must-fix items. Deferred items live in `plan-218-deferred-cycle9-rpl.md`.

Must-fix findings:
- AGG9R-RPL-01 (MEDIUM) — `updatePassword` rate-limit ordering. **FIXED** in
  commit `0000000d7bef338f0aaef7386005ce02b932332e`.
- AGG9R-RPL-03 (LOW, doc) — CLAUDE.md CSV doc drift. **WITHDRAWN**: re-reading
  CLAUDE.md line 146 confirms the existing wording is accurate; the reviewers
  were quoting paraphrased text that does not exist in the file.

## Task AGG9R-RPL-01 — Move `updatePassword` form-field validation above rate-limit pre-increment

### Change

`apps/web/src/app/actions/auth.ts` function `updatePassword` (lines ~261-402).

Move the following blocks FROM the position AFTER the rate-limit pre-increment TO the position JUST AFTER `hasTrustedSameOrigin` check:

```ts
// Sanitize before validation so length checks operate on the same value
// that will be hashed (matches createAdminUser pattern, see C8-01).
const currentPassword = stripControlChars(formData.get('currentPassword')?.toString() ?? '') ?? '';
const newPassword = stripControlChars(formData.get('newPassword')?.toString() ?? '') ?? '';
const confirmPassword = stripControlChars(formData.get('confirmPassword')?.toString() ?? '') ?? '';

if (!currentPassword || !newPassword || !confirmPassword) {
    return { error: t('allFieldsRequired') };
}

if (newPassword !== confirmPassword) {
    return { error: t('passwordsDoNotMatch') };
}

if (newPassword.length < 12) {
    return { error: t('passwordTooShort') };
}

if (newPassword.length > 1024) {
    return { error: t('passwordTooLong') };
}
```

After this move, the rate-limit pre-increment block runs only after all form fields have been validated — matching the `login` ordering at lines 83-89.

Rationale: legitimate admin typos (empty field / mismatch / too-short / too-long) should not consume a rate-limit attempt. Only actual credential-verify attempts should.

### Test

Add to `apps/web/src/__tests__/auth-rethrow.test.ts` OR new file `auth-rate-limit.test.ts`:

- Invoke `updatePassword` with empty `confirmPassword` 20 times.
- Assert `passwordChangeRateLimit.get(ip)` does NOT exist, or has count === 0.
- Assert no entry was inserted into the DB rate_limit_buckets table.

If the existing auth-rate-limit.test.ts doesn't mock the full surface, add a minimal test that imports `passwordChangeRateLimit` directly and checks the map state after a validation-error call.

### Verification

- `npm run lint --workspace=apps/web` — must pass.
- `npm test --workspace=apps/web` — must pass with new test included.
- `npm run build --workspace=apps/web` — must pass.
- `npm run lint:api-auth --workspace=apps/web` — must pass.
- `npm run lint:action-origin --workspace=apps/web` — must pass.

### Commit message

```
fix(auth): 🛡️ validate updatePassword form fields before rate-limit increment (AGG9R-RPL-01)

Match the `login` ordering so typo-driven validation errors (empty
field, password mismatch, length bounds) don't consume the 10-attempt
password_change bucket. Without this, a legitimate admin mistyping
the confirm-password ten times locks themselves out of password
change for 15 minutes even though no Argon2 verify ever ran.

Ref: AGG9R-RPL-01 (.context/reviews/_aggregate-cycle9-rpl.md).
```

## Task AGG9R-RPL-03 — Correct CLAUDE.md CSV escape documentation

### Change

`CLAUDE.md` "Database Security" section.

Replace:
```
- CSV export escapes formula injection characters (`=`, `+`, `-`, `@`, `\t`, `\r`)
```

With:
```
- CSV export strips C0/C1 control chars (incl. `\t`, `\r`, `\n`), strips
  Unicode bidi overrides and zero-width chars, collapses any remaining
  CR/LF to a single space, and prefixes `=`, `+`, `-`, `@` with an
  apostrophe (OWASP CSV-injection guidance). Also wraps each field in
  double quotes and doubles any embedded double quote.
```

### Verification

- Re-run all gates (same as task above).
- Doc-only change — no test required.

### Commit message

```
docs(claude): 📝 correct CSV escape behavior description (AGG9R-RPL-03)

The previous wording said `\t` and `\r` are "escaped"; actual behavior
strips them via the C0/C1 pass. The apostrophe-prefix guard applies
only to `=`, `+`, `-`, `@`. Align docs with csv-escape.ts.

Ref: AGG9R-RPL-03 (.context/reviews/_aggregate-cycle9-rpl.md).
```

## Execution order

1. AGG9R-RPL-01 (code + test) as a single commit.
2. AGG9R-RPL-03 (docs) as a separate commit.

## Post-execution

- Update `.context/reviews/_aggregate-cycle9-rpl.md` with a "Status" section recording the commit hashes.
- Move this plan file to `.context/plans/done/` once both commits landed and gates passed.
