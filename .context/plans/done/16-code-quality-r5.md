# Plan 16: Code Quality & Architecture — Round 5 ✅ PARTIAL (ActionResult deferred)

**Priority:** P2
**Estimated effort:** 3-4 hours
**Sources:** Architecture TD-07, Code Q-04/Q-07/Q-09/Q-13, Performance P2-004

---

## 1. Adopt or delete ActionResult type (P2)
**Source:** Architecture TD-07, Plan 08 #4 (carried forward)
**File:** `src/lib/action-result.ts:2-4`

`ActionResult<T>` is defined but imported by zero action modules. All actions use ad-hoc return shapes.

**Fix — Adopt incrementally:**
- Start with the simplest actions that already return `{ success, ... } | { error }`:
  - `actions/admin-users.ts` — 3 functions
  - `actions/sharing.ts` — 3 functions
  - `actions/tags.ts` — `deleteTag`, `updateTag`
- Pattern:
  ```ts
  export async function deleteAdminUser(id: string): Promise<ActionResult<{ deletedId: string }>> {
      // ...
      return { success: true, data: { deletedId: id } };
      // vs
      return { success: false, error: 'Cannot delete last admin' };
  }
  ```
- Client code updates: check `result.success` instead of `result.error`
- If adopting proves too disruptive, delete the type to avoid confusion

**Verification:**
- [ ] >= 5 action functions use `ActionResult<T>`
- [ ] Client components correctly handle `result.success` / `result.error`
- [ ] Build passes

---

## 2. Fix ISR cache thrashing — targeted revalidation (P2)
**Source:** Performance P2-004
**Files:** `src/app/actions/tags.ts`, `src/app/actions/images.ts`

Tag add/remove and image metadata updates call `revalidateLocalizedPaths('/')` which invalidates the entire homepage ISR cache. A busy admin editing 20 tags triggers 20 full-site cache invalidations.

**Fix:**
- Tag operations: remove `revalidatePath('/')` — only revalidate `/admin/dashboard`
  ```ts
  // addTagToImage, removeTagFromImage, batchAddTags
  revalidateLocalizedPaths('/admin/dashboard');
  // Remove the '/' revalidation for tag-only changes
  ```
- Image metadata update (`updateImageMetadata`): only revalidate the specific photo page
  ```ts
  revalidateLocalizedPaths(`/p/${imageId}`, '/admin/dashboard');
  // No '/' — the image is already visible; title/description change only affects its own page
  ```
- Keep full `revalidatePath('/')` for: `uploadImages`, `deleteImage`, topic CRUD (these change what's visible on the homepage)
- Add comments explaining when full vs targeted revalidation is appropriate

**Verification:**
- [ ] Tag edits don't invalidate homepage ISR
- [ ] Image upload/delete still refreshes homepage
- [ ] Photo page reflects metadata changes immediately

---

## 3. Clean up stale dev comments (P3)
**Source:** Q-04
**File:** `src/app/[locale]/admin/(protected)/password/password-form.tsx:13-14, 32-34`

Dev comments like "or just cast initialState to any if we want to be lazy" should be removed.

**Fix:**
- Remove lines 13-14 and 32-34 (stale development notes)
- Check for similar comments across the codebase with: `grep -rn "just cast\|keep imports\|keep ActionState\|to make TS happy\|we want to be lazy"`

**Verification:**
- [ ] No stale dev comments in password-form.tsx
- [ ] No similar comments found by grep

---

## 4. Add view count tracking for shared photo links (P3)
**Source:** Q-07
**File:** `src/lib/data.ts:325-359`

`getImageByShareKey` has no view count increment, unlike `getSharedGroup`. No way to track shared photo link access.

**Fix:**
- Add fire-and-forget view count to `getImageByShareKey`:
  ```ts
  // After fetching the image
  db.update(images)
      .set({ view_count: sql`${images.view_count} + 1` })
      .where(eq(images.id, image.id))
      .catch(err => console.debug('share view_count increment failed:', err.message));
  ```
- Add `view_count` column to `images` schema if it doesn't exist (it likely doesn't — check first)
- If adding a column is too invasive, consider a separate `share_link_views` table
- Make this opt-in via `options.incrementViewCount` parameter (matching the `getSharedGroup` pattern)

**Verification:**
- [ ] Shared photo link access is tracked
- [ ] No performance impact on the response

---

## 5. Fix revalidation coverage for photo pages (P3)
**Source:** UX R3 open question #3
**File:** `src/app/actions/images.ts`

Admin edits to photo titles/tags don't revalidate individual photo pages (`/[locale]/p/[id]`). Due to 1-week ISR, edited metadata doesn't show until the cache expires.

**Fix:**
- In `updateImageMetadata`, add `revalidateLocalizedPaths(\`/p/${id}\`)` (this is also addressed by Plan 15 item 2)
- Verify all image mutation actions revalidate the affected photo page:
  - `addTagToImage` / `removeTagFromImage` — should revalidate `/p/${imageId}`
  - `createPhotoShareLink` / `revokePhotoShareLink` — should revalidate `/p/${imageId}`

**Verification:**
- [ ] Editing a photo's title in admin immediately reflects on the public photo page
