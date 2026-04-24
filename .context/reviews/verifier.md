# Verifier Review — Cycle 3 (Prompt 1)

## Scope and method

This pass checked the current tracked repo state against the documented behavior in `README.md`, `apps/web/README.md`, `CLAUDE.md`, and the active plan/context artifacts. I inspected the behavior surfaces most relevant to uploads, config changes, public photo rendering, auth, and backups:

- Docs/config: `README.md`, `apps/web/README.md`, `CLAUDE.md`, `apps/web/docker-compose.yml`, `apps/web/nginx/default.conf`, `apps/web/.env.local.example`
- Upload/config/public code: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/components/upload-dropzone.tsx`
- Tests: `apps/web/src/__tests__/settings-image-sizes-lock.test.ts`, `apps/web/src/__tests__/images-actions.test.ts`, the rest of the Vitest surface under `apps/web/src/__tests__/`

Verification commands run on the live repo state:

- `npm run lint --workspace=apps/web` → clean
- `npm test --workspace=apps/web` → 57 files / 329 tests passing
- `npm run build --workspace=apps/web` → succeeds (one expected Next edge-runtime warning only)

## Findings summary

| ID | Severity | Status | Confidence | Summary |
|---|---|---|---|---|
| C3V-01 | MEDIUM | Likely | Medium-High | Gallery settings are not snapshotted across in-flight uploads, so `image_sizes` and GPS-stripping can change mid-batch and produce mixed derivative sets / privacy leaks |

## Detailed finding

### C3V-01 — Gallery settings are not snapshotted across in-flight uploads

- **Severity:** MEDIUM
- **Status:** Likely
- **Confidence:** Medium-High
- **Risk:** Mixed derivative sets can break public thumbnail/OG URLs; toggling privacy settings mid-batch can leave some photos with GPS data unexpectedly retained.
- **Files / code regions:**
  - `apps/web/src/app/actions/settings.ts:72-103`
  - `apps/web/src/app/actions/images.ts:228-239, 321-329`
  - `apps/web/src/lib/image-queue.ts:240-263`
  - `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:65-67, 143-144`
  - `apps/web/src/components/upload-dropzone.tsx:137-184`
  - regression coverage gap: `apps/web/src/__tests__/settings-image-sizes-lock.test.ts:16-22`
- **Why this is a problem:** The settings write path only blocks `image_sizes` changes once an `images` row already exists. But uploads are processed in separate server-action calls per file, and the queue worker reads the active gallery config when each job runs. That means a settings change can land after an upload batch has started but before the first row exists or before later jobs run.
- **Concrete failure scenario:** An admin starts a multi-file upload, then changes `image_sizes` or toggles `strip_gps_on_upload` while the batch is still in flight. Some files are processed with the old config and later files with the new config. Public pages then request derivative filenames based on the current config, which can 404 for older images, and GPS metadata can remain on some uploads even though the privacy setting was expected to apply to the whole batch.
- **Suggested fix:** Capture a single gallery-config snapshot at upload start and pass that snapshot through the whole upload/queue pipeline, or block config changes with a DB-level/upload-claim guard until in-flight uploads drain. At minimum, the current `image_sizes` gate should key off in-flight upload activity, not just “any row exists.” Add a concurrency regression test that overlaps a config change with an active batch upload.
- **Evidence:**
  - `settings.ts` only checks `images LIMIT 1` and does not coordinate with active upload claims or queued jobs.
  - `upload-dropzone.tsx` sends each file as its own server-action request, widening the race window.
  - `image-queue.ts` and `images.ts` read `getGalleryConfig()` during processing, so the effective config is not frozen per upload batch.
  - `page.tsx` builds public derivative URLs from the current config, so mixed old/new derivative sets can surface as broken images or OG thumbnails.
  - `settings-image-sizes-lock.test.ts` only asserts the static presence of the `limit(1)` guard; it does not exercise concurrent upload/config-change behavior.

## Final skipped-file sweep

I did not deeply inspect generated or dependency artifacts (`.next/`, `node_modules/`, `test-results/`, binary screenshots/media blobs) because they are build/runtime outputs, not source-of-truth behavior. I also did not re-audit every unrelated component or historical `.context/reviews/*` artifact; the review focused on the source/config/test paths that directly implement the documented upload/config/public-render behavior.

No other confirmed correctness issues were found in the inspected surfaces.
