# Plan 52 — Admin Action i18n + Form maxLength (C9-02, C9-03)

**Status:** DONE
**Severity:** LOW
**Findings:** C9-02 (admin action i18n gaps), C9-03 (missing maxLength on form inputs)

---

## Problem

Two related issues:
1. Admin-only server actions (`tags.ts`, `admin-users.ts`, `images.ts`, `sharing.ts`) use hardcoded English strings — inconsistent with the `topics.ts` i18n pattern.
2. Several form inputs lack `maxLength` attributes despite server-side validation enforcing length limits — missing defense-in-depth.

## Implementation Steps

### Part A: Admin Action i18n (C9-02)

#### Step 1: Add translation keys to `en.json` under `serverActions`

Add these keys:

```json
"invalidImageId": "Invalid image ID",
"invalidTagId": "Invalid tag ID",
"tagNameRequired": "Tag name required",
"invalidTagName": "Tag names must be 1-100 characters and cannot contain commas",
"invalidTagFormat": "Invalid tag name format",
"tagNotFound": "Tag not found",
"failedToAddTag": "Failed to add tag",
"failedToRemoveTag": "Failed to remove tag",
"failedToUpdateTag": "Failed to update tag (Name might be taken)",
"noImagesSelected": "No images selected",
"tooManyImages": "Too many images (max 100)",
"tooManyTags": "Too many tags in a single update (max 100 each)",
"invalidUserId": "Invalid user ID",
"usernameTooShort": "Username must be at least 3 chars",
"usernameTooLong": "Username is too long (max 64 chars)",
"invalidUsernameFormat": "Username can only contain letters, numbers, underscores, and hyphens",
"passwordTooShortCreate": "Password must be at least 12 characters long",
"passwordTooLongCreate": "Password is too long (max 1024 chars)",
"usernameExists": "Username already exists",
"failedToCreateUser": "Failed to create user",
"cannotDeleteSelf": "Cannot delete your own account",
"cannotDeleteLastAdmin": "Cannot delete the last admin user",
"failedToDeleteUser": "Failed to delete user",
"noFilesProvided": "No files provided",
"tooManyFiles": "Too many files at once (max 100)",
"tagsStringTooLong": "Tags string is too long (max 1000 chars)",
"invalidTagNames": "Tag names must be 1-100 characters and cannot contain commas",
"invalidTopicFormat": "Invalid topic format",
"topicRequired": "Topic required",
"insufficientDiskSpace": "Insufficient disk space for upload",
"totalUploadSizeExceeded": "Total upload size exceeds limit",
"cumulativeUploadSizeExceeded": "Cumulative upload size exceeds limit per hour",
"uploadLimitReached": "Upload limit reached (max 100 files per hour). Please try again later.",
"allUploadsFailed": "All uploads failed",
"imageNotFound": "Image not found",
"invalidFilename": "Invalid filename in database record",
"failedToUpdateImage": "Failed to update image",
"titleTooLong": "Title is too long (max 255 chars)",
"descriptionTooLong": "Description is too long (max 5000 chars)",
"tooManyShareRequests": "Too many share link requests. Please try again later.",
"imageStillProcessing": "Image is still processing",
"imagesMustBeProcessed": "All selected images must finish processing before sharing",
"imagesNotFound": "One or more selected images could not be found",
"failedToGenerateKey": "Failed to generate unique key",
"failedToCreateGroup": "Failed to create group",
"noActiveShareLink": "Image does not have an active share link",
"failedToRevokeShareLink": "Failed to revoke share link",
"groupNotFound": "Group not found",
"invalidGroupId": "Invalid group ID",
"failedToFetchTags": "Failed to fetch tags",
"failedToDeleteTag": "Failed to delete tag"
```

#### Step 2: Add translation keys to `ko.json` under `serverActions`

Add corresponding Korean translations for all keys above.

#### Step 3: Update server action files to use `getTranslations`

For each of the 4 files:
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/sharing.ts`

Add `const t = await getTranslations('serverActions');` at the top of each exported function and replace hardcoded strings with `t('xxx')` calls.

### Part B: Form maxLength (C9-03)

#### Step 4: Add maxLength attributes to form inputs

1. `apps/web/src/components/admin-user-manager.tsx` line 82:
   - Add `maxLength={64}` to username input

2. `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`:
   - Create form (lines 140-141): Add `maxLength={100}` to label and slug inputs
   - Edit form (lines 218-219): Add `maxLength={100}` to label and slug inputs

3. `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx` line 146:
   - Add `maxLength={100}` to name input

4. `apps/web/src/components/image-manager.tsx` lines 404, 408:
   - Add `maxLength={255}` to title Input
   - Add `maxLength={5000}` to description Textarea

#### Step 5: Verify build

Run `npm run build --workspace=apps/web` to ensure no compilation errors.

## Files Modified

- `apps/web/messages/en.json` — add ~40 keys to `serverActions`
- `apps/web/messages/ko.json` — add ~40 keys to `serverActions`
- `apps/web/src/app/actions/tags.ts` — i18n all error strings
- `apps/web/src/app/actions/admin-users.ts` — i18n all error strings
- `apps/web/src/app/actions/images.ts` — i18n all error strings
- `apps/web/src/app/actions/sharing.ts` — i18n all error strings
- `apps/web/src/components/admin-user-manager.tsx` — add maxLength to username
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx` — add maxLength to label/slug
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx` — add maxLength to name
- `apps/web/src/components/image-manager.tsx` — add maxLength to title/description

## Testing

- Create a user with username > 64 chars — input should truncate at 64
- Create a topic with label > 100 chars — input should truncate at 100
- Edit an image title > 255 chars — input should truncate at 255
- Verify admin action errors display correctly in both English and Korean locales
