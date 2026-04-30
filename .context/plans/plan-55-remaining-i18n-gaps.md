# Plan 55 — Remaining i18n Gaps (C11-01 through C11-05)

**Status:** DONE
**Severity:** 2 MEDIUM + 3 LOW
**Findings:** C11-01 (api-auth i18n), C11-02 (photo-viewer fallback), C11-03 (login description key), C11-04 (redundant getTranslations), C11-05 (CSV warning i18n)

---

## Problem

Five i18n consistency gaps remain after cycles 8-10 completed the main i18n migration:

1. **C11-01 (MEDIUM)**: `api-auth.ts` `withAdminAuth()` returns hardcoded `'Unauthorized'` in JSON error response. All server actions use `t('unauthorized')`.

2. **C11-02 (LOW)**: `photo-viewer.tsx` line 242 uses `toast.error(result.error || 'Failed to share')` — the fallback is hardcoded English. The translation key `viewer.errorSharing` already exists.

3. **C11-03 (MEDIUM)**: `login-form.tsx` renders `<CardDescription>{t('description')}</CardDescription>` using `useTranslations('login')`, but the `login.description` key does not exist in either `en.json` or `ko.json`.

4. **C11-04 (LOW)**: `tags.ts` `getAdminTags()` redundantly calls `getTranslations('serverActions')` at line 36 inside a catch block, shadowing the identical call at line 18.

5. **C11-05 (LOW)**: `db-actions.ts` line 80 returns hardcoded English `'Result truncated at 50,000 rows'` warning. The `t` variable is already available in that function scope.

---

## Implementation Steps

### Step 1: Fix C11-01 — Localize `api-auth.ts` error string

File: `apps/web/src/lib/api-auth.ts`

- Import `getTranslations` from `next-intl/server`
- In the wrapper function, call `const t = await getTranslations('serverActions')` before the auth check
- Replace `'Unauthorized'` with `t('unauthorized')` (key already exists in both locale files)

Note: API routes run outside the i18n middleware matcher, but `getTranslations` uses the request's `Accept-Language` header or falls back to the default locale. This is acceptable for an API error response.

### Step 2: Fix C11-02 — Replace hardcoded fallback in photo-viewer.tsx

File: `apps/web/src/components/photo-viewer.tsx`, line 242

Change:
```
toast.error(result.error || 'Failed to share');
```
To:
```
toast.error(result.error || t('viewer.errorSharing'));
```

The `t` function is already available (from `useTranslation()` at line 49), and `viewer.errorSharing` already exists in both locale files.

### Step 3: Fix C11-03 — Add missing `login.description` translation key

File: `apps/web/messages/en.json` — add under `login`:
```json
"description": "Sign in to manage your gallery"
```

File: `apps/web/messages/ko.json` — add under `login`:
```json
"description": "갤러리 관리를 위해 로그인하세요"
```

### Step 4: Fix C11-04 — Remove redundant `getTranslations` call in tags.ts

File: `apps/web/src/app/actions/tags.ts`, line 36

Remove the duplicate `const t = await getTranslations('serverActions');` inside the catch block. The `t` from line 18 is already in scope.

### Step 5: Fix C11-05 — Localize CSV export warning in db-actions.ts

File: `apps/web/messages/en.json` — add under `serverActions`:
```json
"csvTruncated": "Result truncated at 50,000 rows"
```

File: `apps/web/messages/ko.json` — add under `serverActions`:
```json
"csvTruncated": "50,000행에서 잘렸습니다"
```

File: `apps/web/src/app/[locale]/admin/db-actions.ts`, line 80

Change:
```
const warning = rowCount >= 50000 ? 'Result truncated at 50,000 rows' : undefined;
```
To:
```
const warning = rowCount >= 50000 ? t('csvTruncated') : undefined;
```

The `t` variable is already available (called at line 32).

### Step 6: Verify build

Run `npm run build --workspace=apps/web` to ensure no compilation errors.

---

## Files Modified

- `apps/web/src/lib/api-auth.ts` — import getTranslations, localize error string
- `apps/web/src/components/photo-viewer.tsx` — replace hardcoded fallback with `t()` call
- `apps/web/messages/en.json` — add `login.description` and `serverActions.csvTruncated`
- `apps/web/messages/ko.json` — add `login.description` and `serverActions.csvTruncated`
- `apps/web/src/app/actions/tags.ts` — remove redundant getTranslations call
- `apps/web/src/app/[locale]/admin/db-actions.ts` — localize CSV warning string

## Testing

- Login page CardDescription should show meaningful text in both English and Korean
- API admin auth failure should return localized "Not authorized" / "권한이 없습니다"
- Photo viewer share error fallback should use localized string
- CSV export of 50K+ rows should show localized truncation warning
- Verify no duplicate getTranslations calls in tags.ts catch block
- Run `npm run build` to confirm no compilation errors
