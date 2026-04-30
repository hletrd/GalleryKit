# Plan 21: Correctness & ISR Fixes — Round 6 ✅ DONE

**Priority:** P1 (items 0-2), P2 (items 3-5), P3 (items 6-9)
**Estimated effort:** 3-4 hours
**Sources:** Comprehensive Review R6 (H-01, H-02, H-03, H-09, M-05, M-10, M-08, L-06, L-07, L-08)

---

## 0. Wrap useSearchParams() components in Suspense boundaries (P1)
**Source:** H-01 (R6 review)
**Files:** `src/components/nav-client.tsx:24`, `src/components/tag-filter.tsx:13`
**Confidence:** HIGH

`NavClient` and `TagFilter` call `useSearchParams()` without a `<Suspense>` boundary. This forces the entire page into client-side rendering, completely negating `revalidate = 3600` on homepage and topic pages. Every page hit is a full SSR request instead of serving cached HTML.

**Fix:**
- Wrap `NavClient` in `<Suspense>` at the usage site:
  ```tsx
  <Suspense fallback={<NavSkeleton />}>
      <NavClient />
  </Suspense>
  ```
- Wrap `TagFilter` similarly:
  ```tsx
  <Suspense fallback={null}>
      <TagFilter />
  </Suspense>
  ```
- The `Suspense` boundary isolates the dynamic rendering to just the search-params-dependent component
- The rest of the page can be statically generated and cached by ISR

**Verification:**
- [ ] Homepage serves cached HTML (not full SSR on every request)
- [ ] Topic pages serve cached HTML
- [ ] Nav and tag filter still function correctly
- [ ] Build passes

---

## 1. Add ISR revalidation to sharing actions (P1)
**Source:** H-02 (R6 review)
**File:** `src/app/actions/sharing.ts` (entire file)
**Confidence:** HIGH

None of the four sharing server actions call `revalidateLocalizedPaths`. After revoking a share link, the cached version continues to serve the photo until ISR expires. This is a privacy issue.

**Fix:**
- In `createPhotoShareLink`: add `revalidateLocalizedPaths(\`/p/${imageId}\`)`
- In `revokePhotoShareLink`: fetch the image ID before nullifying, then `revalidateLocalizedPaths(\`/p/${imageId}\`)`
- In `createGroupShareLink`: add `revalidateLocalizedPaths('/')`
- In `deleteGroupShareLink`: add `revalidateLocalizedPaths('/')`
- For revoke/delete: fetch the key before nullifying so we know which paths to revalidate

**Verification:**
- [ ] Revoking a share link immediately hides the photo from the share page
- [ ] Creating a share link immediately makes it accessible
- [ ] No stale cached share pages after mutation
- [ ] Build passes

---

## 2. Fix schema default `processed: true` contradicts business logic (P1)
**Source:** H-03 (R6 review)
**File:** `src/db/schema.ts:60`
**Confidence:** HIGH

The `processed` column defaults to `true`, but all inserts set `processed: false`. Any future code path that inserts without explicitly setting `processed` creates a phantom "processed" image with no variants on disk — broken images for end users.

**Fix:**
```ts
// Before
boolean("processed").default(true)
// After
boolean("processed").default(false)
```

**Verification:**
- [ ] New inserts without explicit `processed` field default to `false`
- [ ] Existing rows with `processed: true` are unaffected
- [ ] Build passes

---

## 3. Fix sequential DB queries in getImageByShareKey (P2)
**Source:** H-09 (R6 review)
**File:** `src/lib/data.ts:322-354`
**Confidence:** HIGH

Two sequential `await` calls where `getImage` uses `Promise.all`. Adds a full DB roundtrip to every shared photo page.

**Fix:**
- Use `Promise.all` to parallelize independent queries, matching the `getImage` pattern:
  ```ts
  const [image, tags] = await Promise.all([
      db.select().from(images).where(eq(images.id, imageId)).limit(1),
      db.select().from(tags).innerJoin(imageTags, ...).where(eq(imageTags.imageId, imageId)),
  ]);
  ```

**Verification:**
- [ ] Shared photo page loads with one fewer DB roundtrip
- [ ] No behavior change in displayed data
- [ ] Build passes

---

## 4. Fix updateImageMetadata not revalidating topic pages (P2)
**Source:** M-05 (R6 review)
**File:** `src/app/actions/images.ts:427`
**Confidence:** MEDIUM

Topic pages show stale title for up to 1 hour after metadata update. The current revalidation only covers `/p/${id}`, `/admin/dashboard`, and `/`.

**Fix:**
- Query the image's topic before updating, then revalidate the topic page:
  ```ts
  const [image] = await db.select({ topic: images.topic }).from(images).where(eq(images.id, id));
  if (image?.topic) {
      revalidateLocalizedPaths(`/p/${id}`, '/admin/dashboard', '/', `/${image.topic}`);
  }
  ```

**Verification:**
- [ ] Editing a photo's title immediately reflects on its topic page
- [ ] Photos without a topic don't cause errors
- [ ] Build passes

---

## 5. Fix createTopicAlias misleading error for non-duplicate-key failures (P2)
**Source:** M-10 (R6 review)
**File:** `src/app/actions/topics.ts:241-246`
**Confidence:** MEDIUM

FK violation shows "Invalid alias format" instead of "Topic does not exist."

**Fix:**
- Catch the specific MySQL error code for FK violation (`ER_NO_REFERENCED_ROW_2` = 1452):
  ```ts
  catch (e: any) {
      if (e.code === 'ER_DUP_ENTRY') {
          return { error: 'Alias already exists' };
      }
      if (e.code === 'ER_NO_REFERENCED_ROW_2') {
          return { error: 'Referenced topic does not exist' };
      }
      return { error: 'Failed to create alias' };
  }
  ```
- Remove the generic "Invalid alias format" catch-all that masks FK errors

**Verification:**
- [ ] Creating alias for non-existent topic returns "Referenced topic does not exist"
- [ ] Duplicate alias returns "Alias already exists"
- [ ] Other errors return generic message
- [ ] Build passes

---

## 6. Fix login rate-limit DB reset fire-and-forget (P3)
**Source:** M-08 (R6 review)
**File:** `src/app/actions/auth.ts:134`
**Confidence:** MEDIUM

If DB reset fails, the IP remains rate-limited in database. Admin locked out on next attempt.

**Fix:**
- Await the DB reset or at least log failure:
  ```ts
  try {
      await loginRateLimit.reset(ip);
  } catch (err) {
      console.error('Failed to reset login rate limit for IP:', ip, err);
  }
  ```

**Verification:**
- [ ] DB reset failure is logged
- [ ] Successful login still proceeds even if reset fails

---

## 7. Fix ISO EXIF extraction `||` vs `??` (P3)
**Source:** L-06 (R6 review)
**File:** `src/lib/process-image.ts:442`
**Confidence:** LOW

`ISO: 0` would fall through to `ISOSpeedRatings` due to `||` operator. Change to `??`.

**Fix:**
```ts
// Before
ISO: exif.ISO || exif.ISOSpeedRatings
// After
ISO: exif.ISO ?? exif.ISOSpeedRatings
```

**Verification:**
- [ ] ISO value of 0 is preserved (not treated as falsy)
- [ ] Build passes

---

## 8. Add early return for searchImages limit <= 0 (P3)
**Source:** L-07 (R6 review)
**File:** `src/lib/data.ts:454-501`
**Confidence:** LOW

`searchImages` accepts `limit: 0` but returns empty after executing queries.

**Fix:**
```ts
if (limit <= 0) return [];
```
Add at the top of the function, before any DB queries.

**Verification:**
- [ ] `searchImages('test', 0)` returns empty array without DB queries
- [ ] `searchImages('test', -1)` returns empty array without DB queries

---

## 9. Add audit log to deleteImage for consistency (P3)
**Source:** L-08 (R6 review)
**File:** `src/app/actions/images.ts:257-311`
**Confidence:** LOW

Single-image deletions are invisible in audit log. `deleteImages` (batch) already calls `logAuditEvent`.

**Fix:**
- Add after the DB transaction, matching the `deleteImages` pattern:
  ```ts
  const currentUser = await getCurrentUser();
  logAuditEvent(currentUser?.id ?? null, 'image_delete', 'image', String(id), undefined, {}).catch(console.debug);
  ```

**Verification:**
- [ ] Single image deletion creates audit log entry
- [ ] Log format matches batch deletion
- [ ] Build passes

---

## Priority Order

1. Item 0 — useSearchParams breaking ISR (affects all public pages)
2. Item 1 — Sharing actions missing revalidation (privacy issue)
3. Item 2 — Schema default processed: true (data integrity)
4. Item 3 — Sequential queries in getImageByShareKey
5. Item 4 — Topic page revalidation on metadata update
6. Items 5-9 — Lower priority correctness fixes
