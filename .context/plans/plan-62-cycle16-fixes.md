# Plan 62 — Cycle 16 Low-Priority Fixes (C16-01 through C16-06)

**Created:** 2026-04-19 (Cycle 16)
**Status:** DONE
**Severity:** All LOW

---

## Problem

Six low-priority issues identified in the cycle 16 comprehensive review. None are critical, but all represent small improvements to robustness, defense-in-depth, or UX.

---

## Implementation Steps

### Step 1: C16-01 — Unref viewCount flush timer

**File:** `apps/web/src/lib/data.ts`, line 21

Add `.unref?.()` to the `setTimeout` on the `viewCountFlushTimer` so the timer does not keep the Node.js event loop alive during shutdown.

```ts
// Before
viewCountFlushTimer = setTimeout(flushGroupViewCounts, 5000);

// After
viewCountFlushTimer = setTimeout(flushGroupViewCounts, 5000);
viewCountFlushTimer.unref?.();
```

### Step 2: C16-02 — Reduce searchImages effectiveLimit cap

**File:** `apps/web/src/lib/data.ts`, line 538

Reduce the `effectiveLimit` cap from 500 to 100 in `searchImages`:

```ts
// Before
const effectiveLimit = Math.min(Math.max(limit, 1), 500);

// After
const effectiveLimit = Math.min(Math.max(limit, 1), 100);
```

### Step 3: C16-03 — Add console.debug to photo-viewer catch blocks

**File:** `apps/web/src/components/photo-viewer.tsx`, lines 62, 92, 97, 106

Replace empty `catch {}` with `catch { console.debug(...) }` for sessionStorage operations:

```ts
// Before
catch {}

// After
catch { console.debug('sessionStorage operation failed') }
```

### Step 4: C16-04 — Disable batch add tag button during operation

**File:** `apps/web/src/components/image-manager.tsx`, line 228

Add `disabled={isAddingTag}` to the `AlertDialogAction` for the batch add tag dialog:

```tsx
// Before
<AlertDialogAction onClick={handleBatchAddTag}>{t('imageManager.addTag')}</AlertDialogAction>

// After
<AlertDialogAction onClick={handleBatchAddTag} disabled={isAddingTag}>{isAddingTag ? t('imageManager.adding') : t('imageManager.addTag')}</AlertDialogAction>
```

Note: May need to add an `'imageManager.adding'` translation key to `en.json` and `ko.json`.

### Step 5: C16-05 — Centralize BASE_URL in constants.ts

**Files:**
- `apps/web/src/lib/constants.ts` — add centralized `getBaseUrl()` function
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx` — use centralized constant
- `apps/web/src/app/[locale]/(public)/page.tsx` — use centralized constant
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx` — use centralized constant
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` — use centralized constant
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` — use centralized constant

Add to `constants.ts`:
```ts
import siteConfig from '@/site-config.json';

/** Centralized base URL derivation with validation warning. */
export const BASE_URL = (() => {
    const url = process.env.BASE_URL || siteConfig.url;
    if (!url) {
        console.warn('[config] BASE_URL is not set and site-config.json has no URL. OG metadata will be incomplete.');
    }
    return url;
})();
```

Then replace all `const BASE_URL = process.env.BASE_URL || siteConfig.url;` in page files with `import { BASE_URL } from '@/lib/constants';`.

### Step 6: C16-06 — Client-side password confirmation validation

**File:** `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx`

Add a client-side check before form submission that validates `newPassword === confirmPassword`. Show an inline error if they differ.

Approach: Add a `useRef` or state-based check in the form's `onSubmit` handler. If passwords don't match, set an error state and prevent submission.

```tsx
const [confirmError, setConfirmError] = useState<string | null>(null);

// In form submission handler or form action wrapper:
const handleSubmit = (formData: FormData) => {
    const newPw = formData.get('newPassword') as string;
    const confirmPw = formData.get('confirmPassword') as string;
    if (newPw !== confirmPw) {
        setConfirmError(t('password.mismatch'));
        return;
    }
    setConfirmError(null);
    formAction(formData);
};
```

Need to add `'password.mismatch'` translation key to `en.json` and `ko.json`.

### Step 7: Verify build and tests

Run `npm run build --workspace=apps/web` and `npm test --workspace=apps/web`.

---

## Files Modified

- `apps/web/src/lib/data.ts` — unref timer + reduce search limit cap
- `apps/web/src/components/photo-viewer.tsx` — add console.debug to catch blocks
- `apps/web/src/components/image-manager.tsx` — disable button during batch add
- `apps/web/src/lib/constants.ts` — add centralized BASE_URL
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx` — use centralized BASE_URL
- `apps/web/src/app/[locale]/(public)/page.tsx` — use centralized BASE_URL
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx` — use centralized BASE_URL
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` — use centralized BASE_URL
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx` — use centralized BASE_URL
- `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx` — client-side confirmation check
- `apps/web/messages/en.json` — add translation keys
- `apps/web/messages/ko.json` — add translation keys

## Risk Assessment

- **Risk:** VERY LOW — All changes are small, targeted improvements. No logic changes to auth, data integrity, or security paths.
