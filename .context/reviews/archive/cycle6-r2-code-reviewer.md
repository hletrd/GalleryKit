# Code Quality Review — Cycle 6 Round 2 (2026-04-19)

## Reviewer: code-reviewer
## Scope: Full repository, focus on recent changes (storage abstraction, settings page, SEO, admin layout)

---

### C6R2-F01: StorageBackend abstraction exists but zero callers use it (HIGH)

**File:** `apps/web/src/lib/storage/index.ts`, `apps/web/src/lib/storage/local.ts`, `apps/web/src/lib/storage/s3.ts`, `apps/web/src/lib/storage/minio.ts`

The entire `StorageBackend` abstraction layer (4 files, ~580 lines) is dead code. Every consumer still uses direct `fs` operations via `UPLOAD_DIR_*` constants from `process-image.ts`:

- `process-image.ts`: uses `fs.writeFile`, `fs.copyFile`, `fs.link`, `fs.stat`, `fs.unlink`, `fs.mkdir` directly
- `image-queue.ts`: uses `fs.access`, `fs.stat`, `fs.unlink` directly  
- `serve-upload.ts`: uses `createReadStream`, `lstat` directly
- `actions/images.ts`: uses `fs.unlink`, `statfs` directly

The `switchStorageBackend()` function in `actions/settings.ts` fires when the admin changes the setting, but switching has no effect because no code path actually calls `getStorage()` or `getStorageSync()`.

**Failure scenario:** Admin switches to S3/MinIO in settings. `switchStorageBackend()` runs, initializes an S3 client, but all uploads still go to local disk, all reads still come from local disk, and S3 bucket remains empty. The admin is led to believe they are using remote storage when they are not.

**Fix:** Route `process-image.ts`, `image-queue.ts`, `serve-upload.ts`, and `actions/images.ts` through the `StorageBackend` interface. This is a large integration pass that must be done carefully to maintain the existing Sharp pipeline (which needs file paths for mmap).

**Confidence:** HIGH

---

### C6R2-F02: `settings-client.tsx` uses raw `<button>` toggle instead of Switch component (MEDIUM)

**File:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:211-219`

The GPS toggle uses a hand-built `<button role="switch">` with inline Tailwind classes instead of the shadcn/ui `Switch` component. The project uses shadcn/ui (new-york style) throughout. No `Switch` component exists in `components/ui/` yet.

Problems:
- Visual inconsistency with other shadcn/ui components
- Missing `aria-label` on the switch (only `id` and `role` set)
- Keyboard handling relies on native `<button>` which works but lacks the `Switch` pattern's space-bar toggle semantics
- Dark mode styles are manually specified rather than inheriting from the design system

**Fix:** Add the `Switch` component from shadcn/ui and use it for the GPS toggle.

**Confidence:** HIGH

---

### C6R2-F03: `settings-client.tsx` storage backend selector uses native `<select>` instead of shadcn/ui `Select` (MEDIUM)

**File:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:277-286`

The storage backend dropdown uses a native `<select>` with inline Tailwind classes to mimic the shadcn/ui `Select` appearance. This creates:
- Visual inconsistency with other shadcn/ui form controls
- Missing accessibility features of the Radix Select (keyboard navigation, screen reader announcements)
- Fragile CSS coupling (manually replicating `h-10`, `rounded-md`, `border-input`, etc.)

**Fix:** Replace with `Select`/`SelectTrigger`/`SelectContent`/`SelectItem` from `@/components/ui/select`.

**Confidence:** HIGH

---

### C6R2-F04: Duplicate `UPLOAD_ROOT` derivation logic in 3 files (MEDIUM)

**Files:**
- `apps/web/src/lib/process-image.ts:35-45`
- `apps/web/src/lib/storage/local.ts:17-27`
- `apps/web/src/lib/serve-upload.ts:8-9`

The `UPLOAD_ROOT` derivation logic (env var check -> monorepo path -> simple path) is duplicated in `process-image.ts` and `storage/local.ts`. Additionally, `serve-upload.ts` derives it via `path.dirname(UPLOAD_DIR_ORIGINAL)` which is a different approach that breaks if `UPLOAD_DIR_ORIGINAL` is ever redefined.

**Fix:** Consolidate `UPLOAD_ROOT` and `UPLOAD_DIR_*` constants in a single module. The storage module is the natural home since it already defines `REQUIRED_DIRS`.

**Confidence:** HIGH

---

### C6R2-F05: `updateGallerySettings` runs N individual DB queries in a loop (LOW)

**File:** `apps/web/src/app/actions/settings.ts:57-66`

The settings update runs a separate `INSERT ... ON DUPLICATE KEY UPDATE` or `DELETE` for each key. With 12 gallery settings, this is 12 sequential DB round-trips. Same pattern exists in `updateSeoSettings` (seo.ts:101-111) for 6 keys.

**Fix:** Use a single transaction with batch operations, or at minimum use `Promise.all` for independent upserts.

**Confidence:** MEDIUM

---

### C6R2-F06: `home-client.tsx` file-level eslint-disable already fixed (INFO)

**File:** `apps/web/src/components/home-client.tsx:1`

The previous cycle flagged a file-level `eslint-disable @next/next/no-img-element`. Current code only has `eslint-disable-next-line` on line 260 (correct) and a different `eslint-disable-next-line` on line 158 (for react-hooks). This issue appears to have been resolved since the last review. No action needed.

**Confidence:** HIGH

---

### Previously Confirmed Findings (carry-forward)

- C6-F01: `selectFields` privacy guard is implicit — now has compile-time assertion (`_privacyGuard`). The type-level guard was added since last cycle. This is partially fixed; a separate `publicSelectFields` would be stronger.
- C6-F02: File-level eslint-disable — now resolved (see C6R2-F06)
- C6-F03: No E2E tests for upload pipeline — still valid
- C6-F04: Native checkboxes in image-manager.tsx — still valid
