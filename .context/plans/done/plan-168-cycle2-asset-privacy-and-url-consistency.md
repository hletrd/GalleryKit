# Plan 168 — Cycle 2 Asset Privacy, URL Consistency, and Admin Preview Reliability

**Created:** 2026-04-20
**Status:** DONE
**Sources:** `.context/reviews/critic.md`, `.context/reviews/security-reviewer.md`

## Scope
Fix the confirmed asset-handling and metadata problems where original uploads remained under the public web root, SEO/share URLs ignored `IMAGE_BASE_URL`, and the admin dashboard preview promised immediate visibility without a usable fallback while processing.

## Ralph progress
- 2026-04-20: Moved original-upload storage to a private root (`UPLOAD_ORIGINAL_ROOT`) with legacy-path fallback helpers so new originals are no longer written under `public/uploads/original`.
- 2026-04-20: Added startup migration logic in `apps/web/scripts/migrate.js` so deployed containers move legacy public originals into the private root before the app starts.
- 2026-04-20: Removed public exposure of `original_format` / `original_file_size` values by nulling them out in unauthenticated select fields while retaining the admin-only source fields.
- 2026-04-20: Added `absoluteImageUrl()` and updated homepage/topic/photo/share metadata + JSON-LD surfaces to honor `IMAGE_BASE_URL` consistently.
- 2026-04-20: Added an admin-only image listing path with processing state and switched dashboard previews to a local/CDN-safe JPEG fallback plus an explicit processing placeholder.
- 2026-04-20: Final verification passed: `npm run lint --workspace=apps/web`, `npm run lint:api-auth --workspace=apps/web`, `npm test --workspace=apps/web`, `npm run build --workspace=apps/web`, and `npm run test:e2e --workspace=apps/web`.
