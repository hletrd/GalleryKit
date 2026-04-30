# Plan 169 — Cycle 2 EXIF Rendering and Bootstrap Hardening

**Created:** 2026-04-20
**Status:** DONE
**Sources:** `.context/reviews/critic.md`, `.context/reviews/security-reviewer.md`

## Scope
Fix the confirmed EXIF time-rendering bug and harden the migration bootstrap path so startup no longer writes generated admin passwords to a predictable `/tmp` file.

## Ralph progress
- 2026-04-20: Added `apps/web/src/lib/exif-datetime.ts` to parse stored naive EXIF datetimes without timezone conversion.
- 2026-04-20: Updated `apps/web/src/components/photo-viewer.tsx` and `apps/web/src/components/info-bottom-sheet.tsx` to render EXIF date/time strings with UTC-preserving formatters instead of `new Date(image.capture_date)`.
- 2026-04-20: Changed `apps/web/scripts/migrate.js` to require an explicit strong `ADMIN_PASSWORD` or Argon2 hash instead of generating a password and writing it to `/tmp/gallerykit-admin-password.txt`.
- 2026-04-20: Final verification passed: `npm run lint --workspace=apps/web`, `npm run lint:api-auth --workspace=apps/web`, `npm test --workspace=apps/web`, `npm run build --workspace=apps/web`, and `npm run test:e2e --workspace=apps/web`.
