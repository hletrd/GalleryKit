# Verifier Review — Cycle 3 Repository Sweep

**Date:** 2026-04-22  
**Scope:** repo-wide inventory + evidence-based verification of behavior-defining code, tests, docs, and deployment surfaces.

## Inventory

Tracked files: 231

Reviewed the major behavior surfaces that govern auth, uploads, image processing, settings, storage, tags/topics, photo viewing, public routes, deployment, and the test harness.

## Verification evidence

- `npm test --workspace=apps/web` — PASS (13 files, 97 tests)
- `npm run lint --workspace=apps/web` — PASS
- `npm run build --workspace=apps/web` — PASS
- `npm run test:e2e --workspace=apps/web` — PASS (10 passed, 3 skipped)

Build/test output was clean aside from expected runtime warnings:
- `TRUST_PROXY` warnings during build and E2E startup
- a Next.js standalone/runtime warning in the Playwright webServer harness

## Confirmed issues

### 1) `getImage()` still claims legacy `processed = NULL` support that the query does not implement

- **Severity:** MEDIUM
- **Files/regions:**
  - `apps/web/src/lib/data.ts:377-392`
  - `apps/web/drizzle/0002_fix_processed_default.sql:1`
- **What I verified:**
  - The comment at `data.ts:382` says `getImage()` returns processed images where `processed is true OR null/undefined for legacy`.
  - The actual filter is only `eq(images.processed, true)`.
  - The migration `0002_fix_processed_default.sql` only changes the default to `false`; it does not backfill existing rows that may still be `NULL`.
- **Failure scenario:**
  - Any older image row left with `processed = NULL` will be hidden from `getImage()`, so the photo page can 404 even though the code comment says legacy rows are still supported.
- **Suggested fix:**
  - Either explicitly include the legacy `NULL` case in the predicate, or remove the legacy-support claim and backfill/migrate old rows so the comment and runtime behavior match.
- **Confidence:** high

### 2) Storage-backend switching is advertised by code/comments/messages, but the settings pipeline does not actually expose it

- **Severity:** LOW
- **Files/regions:**
  - `apps/web/src/lib/storage/index.ts:4-13`
  - `apps/web/src/lib/gallery-config-shared.ts:10-19`
  - `apps/web/src/app/actions/settings.ts:35-45`
  - `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:76-165`
  - `apps/web/messages/en.json:532-539`
- **What I verified:**
  - `storage/index.ts` says the backend is driven by a `storage_backend` admin setting and implies the settings page can switch backends.
  - `GALLERY_SETTING_KEYS` contains only image-processing and privacy keys; there is no `storage_backend` key.
  - `updateGallerySettings()` rejects any key outside that whitelist.
  - The settings UI renders only image-processing and privacy cards; there is no storage section or control.
  - The translation catalog still ships Storage Backend strings describing Local/MinIO/S3 selection.
- **Failure scenario:**
  - A maintainer or operator can read the storage module/messages and reasonably conclude backend switching is supported, but the current admin settings pipeline cannot persist such a setting and the upload/serve paths remain local-filesystem based.
- **Suggested fix:**
  - Either complete the storage-backend feature end-to-end, or remove/park the storage-backend copy, singleton surface, and translation strings until the feature is actually wired.
- **Confidence:** medium-high

## Risks needing manual validation

### 3) The Playwright suite validates `next start`, not the standalone Docker entrypoint

- **Severity:** LOW (verification risk)
- **Files/regions:**
  - `apps/web/playwright.config.ts:54-60`
  - `apps/web/Dockerfile:35-58`
- **Why this matters:**
  - The E2E harness runs `npm run build && npm run start ...`, while the Docker runtime uses the standalone server (`node apps/web/server.js`).
  - That means a bug specific to the standalone bundle or Docker entrypoint could still evade the browser suite.
- **Manual validation recommendation:**
  - Add at least one smoke test against the standalone Docker runtime, or run a dedicated container-based check before release.
- **Confidence:** medium

## Final sweep notes

I re-checked the cycle-3 touch points after the main pass:

- The photo-viewer GPS guard is correctly gated by `isAdmin`.
- The tag add/remove flows use the intended name-first / slug-fallback lookup pattern.
- The document-title cleanup path is present and the photo-viewer / bottom-sheet flows passed E2E.
- I did not find any CRITICAL or HIGH severity regressions in this sweep.

## Bottom line

The repository is in good shape overall and the build/test/lint/E2E gates are green. The two confirmed issues are both divergence problems rather than crashing regressions: one stale legacy-data claim and one dormant storage-backend surface that overstates what the current settings pipeline supports.
