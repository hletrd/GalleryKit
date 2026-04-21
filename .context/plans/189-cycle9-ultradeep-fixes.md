# Plan 189 — Cycle 9 Ultradeep Fixes

**Source review:** Cycle 9 Aggregate Review (`C9-01` through `C9-04`)
**Status:** DONE
**User-injected TODOs honored this cycle:** `deeper`, `ultradeep comprehensive`, `find yourself and make sure to not ask again`

---

## Findings to Address This Cycle

| ID | Description | Severity | Confidence |
|---|---|---|---|
| C9-01 | Share-link copy flows can report success even when clipboard writes fail, and there is no legacy fallback path | MEDIUM | HIGH |
| C9-02 | Duplicate-entry collision handling in `createPhotoShareLink()`, `createGroupShareLink()`, and `createAdminUser()` still relies on brittle error-message substring matching | LOW | HIGH |
| C9-03 | Public search still ignores canonical topic labels / aliases and renders slug-derived topic text instead of the real topic label | MEDIUM | MEDIUM |
| C9-04 | Storage abstraction comments still overstate a switchable production backend even though live upload/serving paths remain filesystem-only | LOW | HIGH |

---

## Implementation Plan

### 1. Make share-link copy feedback tell the truth (`C9-01`)
**Files:**
- `apps/web/src/lib/clipboard.ts`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- `apps/web/src/__tests__/clipboard.test.ts`

**Plan:**
1. Add a legacy `document.execCommand('copy')` fallback in `copyToClipboard()`.
2. Preserve focus/selection as safely as possible around the fallback path.
3. Update photo/group share flows to branch on the boolean return value instead of always toasting success.
4. Add regression coverage for successful primary-clipboard writes and the fallback path.

### 2. Replace fragile duplicate-entry message sniffing with code-based checks (`C9-02`)
**Files:**
- `apps/web/src/lib/validation.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/__tests__/validation.test.ts`

**Plan:**
1. Add a shared helper that treats top-level and wrapped MySQL error codes consistently.
2. Use that helper for duplicate-entry handling instead of `message?.includes(...)` checks.
3. Lock the helper behavior with focused unit tests.

### 3. Let public search match the topic names users actually see (`C9-03`)
**Files:**
- `apps/web/src/lib/data.ts`
- `apps/web/src/components/search.tsx`
- `apps/web/scripts/seed-e2e.ts`
- `apps/web/e2e/public.spec.ts`

**Plan:**
1. Extend the search data query to include canonical topic labels and alias matches without duplicating rows.
2. Return `topic_label` with search results so the UI can render the real label instead of slug-humanization.
3. Seed a deterministic E2E topic alias and add a Playwright regression that proves label/alias search works end-to-end.

### 4. Make storage docs/comments match the current product reality (`C9-04`)
**Files:**
- `apps/web/src/lib/storage/index.ts`
- `apps/web/src/lib/storage/types.ts`

**Plan:**
1. Tighten the storage abstraction comments so they explicitly say the live upload/processing/serving path still bypasses this module.
2. Remove wording that implies the admin/UI can already switch the production gallery to S3/MinIO end-to-end.
3. Keep the comments forward-looking without overstating current functionality.

---

## Verification Goals

- `npm run lint --workspace=apps/web`
- `npm run build`
- `npm test --workspace=apps/web`
- `npm run test:e2e --workspace=apps/web`
- Per-cycle deploy command succeeds after green gates:
  - `ssh -i ~/.ssh/atik.pem ubuntu@gallery.atik.kr "cd /home/ubuntu/gallery && bash apps/web/deploy.sh"`

## Completion Notes

- [x] `C9-01` implemented in `apps/web/src/lib/clipboard.ts`, `photo-viewer.tsx`, and `image-manager.tsx`
- [x] `C9-02` implemented in `apps/web/src/lib/validation.ts`, `admin-users.ts`, and `sharing.ts`
- [x] `C9-03` implemented in `apps/web/src/lib/data.ts`, `search.tsx`, `seed-e2e.ts`, and `public.spec.ts`
- [x] `C9-04` implemented in `apps/web/src/lib/storage/index.ts` and `types.ts`

## Verification Results

- [x] `npm run lint --workspace=apps/web`
- [x] `npm run build`
- [x] `npm test --workspace=apps/web`
- [x] `npm run test:e2e --workspace=apps/web`
