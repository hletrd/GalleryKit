# Plan 98 — Cycle 11 Fixes

**Created:** 2026-04-19 (Cycle 11)
**Status:** DONE

---

## Findings to Address

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| C11-F01 | `uploadImages` tracker adjustment may operate on stale reference after Map eviction | MEDIUM | Medium | IMPLEMENTED |
| C11-F02 | `api-auth.ts` returns hardcoded English `'Unauthorized'` string | MEDIUM | High | ALREADY FIXED (prior cycle) |
| C11-F03 | `photo-viewer.tsx` has hardcoded English fallback `'Failed to share'` | LOW | High | ALREADY FIXED (prior cycle) |
| C11-F04 | `login-form.tsx` references missing `description` translation key | LOW | High | ALREADY FIXED (prior cycle) |
| C11-F05 | `deleteImages` audit log omits `notFoundCount` from metadata | LOW | Medium | IMPLEMENTED |

---

## C11-F01: uploadImages tracker stale reference — IMPLEMENTED

**File:** `apps/web/src/app/actions/images.ts:246-252`

**Fix implemented:** Re-read the tracker from the Map immediately before adjustment to avoid operating on a stale reference if pruneUploadTracker() evicted this IP's entry during the upload loop.

**Progress:** [x] Implemented — commit 057505a

---

## C11-F02: api-auth.ts hardcoded English 'Unauthorized' — ALREADY FIXED (prior cycle)

**File:** `apps/web/src/lib/api-auth.ts`

**Status:** Already uses `getTranslations('serverActions')` and `t('unauthorized')`. The hardcoded `'Unauthorized'` string was fixed in a prior cycle.

**Progress:** [x] No action needed — already fixed

---

## C11-F03: photo-viewer.tsx English fallback — ALREADY FIXED (prior cycle)

**File:** `apps/web/src/components/photo-viewer.tsx`

**Status:** Grep for `'Failed to share'` returns no matches. The fallback was already replaced with `t('viewer.errorSharing')` in a prior cycle.

**Progress:** [x] No action needed — already fixed

---

## C11-F04: login-form missing description translation key — ALREADY FIXED (prior cycle)

**File:** `apps/web/messages/en.json`, `apps/web/messages/ko.json`

**Status:** Both locale files already contain `"description"` under the `"login"` section:
- `en.json`: `"description": "Sign in to manage your gallery"`
- `ko.json`: `"description": "갤러리 관리를 위해 로그인하세요"`

**Progress:** [x] No action needed — already fixed

---

## C11-F05: deleteImages audit metadata incomplete — IMPLEMENTED

**File:** `apps/web/src/app/actions/images.ts:421`

**Fix implemented:** Added `requested: ids.length, notFound: notFoundCount` to the audit metadata for `images_batch_delete` events.

**Progress:** [x] Implemented — commit 057505a

---

## Verification

- [x] C11-F01: Tracker re-read from Map before adjustment
- [x] C11-F02: `api-auth.ts` returns localized error string (was already fixed)
- [x] C11-F03: Photo viewer uses `t('viewer.errorSharing')` fallback (was already fixed)
- [x] C11-F04: Login form description key exists in both locale files (was already fixed)
- [x] C11-F05: Batch delete audit includes `requested` and `notFound`
- [x] `npm run lint --workspace=apps/web` passes with 0 errors
- [x] `npm run build` passes
- [x] `cd apps/web && npx vitest run` passes (9 files, 66 tests)
