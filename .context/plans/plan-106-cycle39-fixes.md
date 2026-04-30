# Plan 106 — Cycle 39 Fixes

**Created:** 2026-04-19 (Cycle 39)
**Status:** DONE

---

## Scope

Addresses findings from the Cycle 39 aggregate review (`_aggregate-cycle39.md`).

### C39-01: `batchUpdateImageTags` remove path still uses slug-only lookup [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/app/actions/tags.ts` lines 309-318
- **Fix:** Apply the same name-first, slug-fallback lookup pattern from `removeTagFromImage` to the remove loop in `batchUpdateImageTags`. The remove loop currently does:
  ```ts
  const slug = getTagSlug(cleanName);
  const [tagRecord] = await tx.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug));
  ```
  Change to:
  ```ts
  let [tagRecord] = await tx.select({ id: tags.id }).from(tags).where(eq(tags.name, cleanName));
  if (!tagRecord) {
      const slug = getTagSlug(cleanName);
      [tagRecord] = await tx.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug));
  }
  ```
- **Implementation:**
  1. In `batchUpdateImageTags` remove loop, replace the slug-only lookup with name-first lookup.
  2. Import `eq` from drizzle-orm is already available.
  3. The `getTagSlug` import is already available.

### C39-02: Mobile bottom sheet GPS dead code not annotated (incomplete C38-02 fix) [LOW] [HIGH confidence]
- **File:** `apps/web/src/components/info-bottom-sheet.tsx` lines 288-301
- **Fix:** Add the same unreachable-GPS comment block that was added to `photo-viewer.tsx` in C38-02. Place the comment above the GPS conditional render block.
- **Implementation:**
  1. Add comment: `{/* GPS coordinates: this block is currently unreachable from public photo pages because `selectFields` in data.ts intentionally excludes latitude/longitude for privacy. It would only render if an admin-only data accessor explicitly includes these fields. See SEC-38-01. */}`

### C39-03: Admin user creation form labels not associated with inputs [LOW] [HIGH confidence]
- **File:** `apps/web/src/components/admin-user-manager.tsx` lines 93-98
- **Fix:** Add `htmlFor` to labels and matching `id` to inputs.
- **Implementation:**
  1. Change `<label className="text-sm font-medium">{t('users.username')}</label>` to `<label htmlFor="create-username" className="text-sm font-medium">{t('users.username')}</label>`
  2. Add `id="create-username"` to the username Input.
  3. Change `<label className="text-sm font-medium">{t('users.password')}</label>` to `<label htmlFor="create-password" className="text-sm font-medium">{t('users.password')}</label>`
  4. Add `id="create-password"` to the password Input.

### SEC-39-01: Locale cookie missing `Secure` flag [LOW] [HIGH confidence]
- **File:** `apps/web/src/components/nav-client.tsx` line 60
- **Fix:** Add `Secure` flag when on HTTPS.
- **Implementation:**
  1. Change the cookie string to: `NEXT_LOCALE=${otherLocale};path=/;SameSite=Lax;max-age=${60 * 60 * 24 * 365}${window.location.protocol === 'https:' ? ';Secure' : ''}`

### SEC-39-03: `sql-restore-scan.ts` does not check `SET @@global.` pattern [LOW] [MEDIUM confidence]
- **File:** `apps/web/src/lib/sql-restore-scan.ts` lines 1-30
- **Fix:** Add `/\bSET\s+@@global\./i` to the dangerous SQL patterns list.
- **Implementation:**
  1. Add `/\bSET\s+@@global\./i,` to the `DANGEROUS_SQL_PATTERNS` array.

### UX-39-02: Admin user creation form lacks password confirmation [LOW] [MEDIUM confidence]
- **File:** `apps/web/src/components/admin-user-manager.tsx` line 98
- **Fix:** Add a password confirmation input and validate both match client-side before submission.
- **Implementation:**
  1. Add a `confirmPassword` state variable.
  2. Add a new Input with `type="password"`, `name="confirmPassword"`, matching label with `htmlFor`, and `id="create-confirm-password"`.
  3. In `handleCreate`, validate that `formData.get('password') === formData.get('confirmPassword')` before proceeding. If they don't match, show a toast error and return early.
  4. The server-side `createAdminUser` already validates the password, so the confirmation is purely a client-side guard against typos.

---

## Not In Scope (Deferred)

See Plan 107 (deferred carry-forward) for items not addressed this cycle.

## Gate Checks

After all changes:
- [x] `eslint` passes
- [x] `next build` succeeds
- [x] `vitest` passes (66/66 tests)
- [x] `tsc --noEmit` passes

## Completion Notes

All 6 fixes implemented, committed (5 GPG-signed commits), pushed, and deployed.

### C39-01: DONE
- `batchUpdateImageTags` remove loop now queries by exact tag name first, falling back to slug only when no name match is found.
- Commit: `00000008894b62643080a654f0f462d9e733e0dc`

### C39-02: DONE
- Added unreachable-GPS comment block to `info-bottom-sheet.tsx`, matching the C38-02 fix in `photo-viewer.tsx`.
- Commit: `0000000bba6ca8232c2702b73c6703021d04167b`

### C39-03 + UX-39-02: DONE
- Added `htmlFor`/`id` pairs to username and password labels/inputs.
- Added password confirmation field with client-side validation.
- Commit: `00000008e189b22cd8311184575087753b484c9b`

### SEC-39-01: DONE
- Added `Secure` flag to NEXT_LOCALE cookie when on HTTPS.
- Commit: `000000015b253fbca09b6190fd111d0e37a9e41d`

### SEC-39-03: DONE
- Added `SET @@global.` pattern to dangerous SQL patterns list.
- Commit: `00000006da2248f321b468cc319f04ed895f51c8`
