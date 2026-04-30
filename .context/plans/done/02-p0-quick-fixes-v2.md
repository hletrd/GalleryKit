# Plan 02: P0 Quick Fixes (Critical, Low Effort)

**Priority:** P0 — Fix immediately  
**Estimated effort:** 1-2 hours  
**Sources:** Security C2, Code C-01/C-02/C-03/C-04, Architecture 16.1/7/8.1

---

## 1. Client-side password minLength mismatch (8→12)
**Source:** Code C-01  
**Files:**
- `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx:72,84` — change `minLength={8}` to `minLength={12}`
- `apps/web/src/components/admin-user-manager.tsx:81` — change `minLength={8}` to `minLength={12}`
- Add visible hint: `<p className="text-xs text-muted-foreground">Minimum 12 characters</p>`

## 2. Remove `user_filename` from public `selectFields`
**Source:** Code C-02, Security M1  
**Files:**
- `apps/web/src/lib/data.ts:19` — remove `user_filename: images.user_filename` from `selectFields`
- Move to `adminSelectFields` only
- Audit all components referencing `user_filename` — ensure they gracefully handle `undefined`:
  - `photo-viewer.tsx:259` — fallback to `t('imageManager.untitled')` when user_filename missing
  - `info-bottom-sheet.tsx:99` — same fallback
  - `home-client.tsx:193` — same fallback

## 3. GPS latitude validation accepts >90 degrees
**Source:** Code C-03  
**File:** `apps/web/src/lib/process-image.ts:474`
- Add `maxDegrees` parameter to `convertDMSToDD`
- Pass `90` for latitude, `180` for longitude
```typescript
const convertDMSToDD = (dms: number[], ref: string, maxDegrees: number) => {
    if (!dms || dms.length < 3) return null;
    if (dms[0] < 0 || dms[0] > maxDegrees || ...) return null;
```

## 4. Google Analytics ID XSS vector
**Source:** Code C-04, Security H5  
**File:** `apps/web/src/app/[locale]/layout.tsx:107-116`
- Validate GA ID format before interpolation: `/^G-[A-Z0-9]+$|^UA-\d+-\d+$/`
- Use `JSON.stringify(gaId)` for safe interpolation
- Wrap in conditional: only render if format matches

## 5. Migration script password minimum (8→12)
**Source:** Security C2  
**File:** `apps/web/scripts/migrate.js:133`
- Change `password.length < 8` to `password.length < 12`
- If password is too short, auto-generate a strong one: `crypto.randomBytes(16).toString('base64url')`

## 6. Move runtime deps from devDependencies to dependencies
**Source:** Architecture 16.1, UX M4, Security L5/L6  
**File:** `apps/web/package.json`
- Move to `dependencies`: `exif-reader`, `framer-motion`, `react-dropzone`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`

## 7. Add error boundaries
**Source:** Architecture 7  
**Files to create:**
- `apps/web/src/app/global-error.tsx` — root layout error boundary
- `apps/web/src/app/[locale]/error.tsx` — locale-scoped error boundary
- `apps/web/src/app/[locale]/p/[id]/error.tsx` — photo page error boundary
- All should be `'use client'` components with retry button

## 8. GPS float vs double schema drift
**Source:** Architecture 8.1  
**Files:**
- `apps/web/drizzle/0000_nappy_madelyne_pryor.sql:31-32` — change `float` to `double` for latitude/longitude
- OR generate a new migration via `drizzle-kit generate`
- Verify with `drizzle-kit push` in dev

---

## Verification
- [ ] `npm run lint` — 0 errors
- [ ] `npm run build` — success
- [ ] Password forms show "Minimum 12 characters" hint
- [ ] `user_filename` absent from public page source
- [ ] GPS coordinates with degrees >90 rejected
- [ ] GA script only renders for valid GA4 IDs
- [ ] `migrate.js` rejects 8-char passwords
- [ ] `npm ls exif-reader` shows it as a production dep
- [ ] Error boundary renders on forced error
