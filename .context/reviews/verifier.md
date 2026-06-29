# Verifier Review - Cycle 16/100

Date: 2026-06-30
HEAD: `3da74946a7e7a198041bf6067a0192411d61a860`
Scope: current `HEAD` only. No diff/PR sampling. Reviewed repository-wide invariants from `AGENTS.md` and `CLAUDE.md`, with emphasis on behavior documented for auth, public routes, migrations, privacy, upload/processing, color/HDR honesty, semantic search, and deployment gates.

## Inventory Summary

- Tracked files: 2,557 total.
- Runtime/test code inventory:
  - `apps/web/src/app`: 77 tracked files.
  - Public/admin API route handlers: 8 route files.
  - Server actions: 13 action files plus `apps/web/src/app/[locale]/admin/db-actions.ts`.
  - Components: 57 files.
  - Library/data/processing modules: 96 files.
  - Unit tests: 267 tracked test/stub files; Vitest reported 262 test files discovered.
  - E2E tests: 8 files.
  - Drizzle migrations: 28 SQL migrations plus metadata.
- Historical/review context:
  - `.context`: 1,755 tracked artifacts, mostly review/plan history and screenshots.
  - `plan`: 176 tracked plan artifacts.
  - These were inventoried but not treated as runtime behavior unless referenced by current code/tests.

## Verification Evidence

Passed:

- `npm run lint:api-auth --workspace=apps/web`
  - Confirmed every `apps/web/src/app/api/admin/**/route.*` export is wrapped with `withAdminAuth(...)`.
- `npm run lint:action-origin --workspace=apps/web`
  - Confirmed mutating server actions return early on `requireSameOriginAdmin()` or carry explicit read-only/public exemptions.
- `npm run lint:public-route-rate-limit --workspace=apps/web`
  - Confirmed public mutating API route exports are rate-limited or non-mutating.
- `npm run typecheck --workspace=apps/web`
  - `next typegen`, app typecheck, script typecheck, and JS script check passed.
- `npm run lint --workspace=apps/web`
  - ESLint passed.
- `npm test --workspace=apps/web`
  - 260 passed, 2 skipped test files.
  - 2,418 passed, 4 skipped tests.
- `npm run build --workspace=apps/web`
  - Production build passed.
  - Build-time sitemap generation logged `ECONNREFUSED 127.0.0.1:3306` and intentionally fell back to homepage-only sitemap; this matches the documented fallback in `apps/web/src/app/sitemap.ts:24-55` for build/runtime DB outage tolerance.

Not run:

- `npm run test:e2e --workspace=apps/web`.
  - No browser-flow-specific issue was found that required Playwright confirmation in this verifier lane.

## Confirmed Issues

None found.

I did not identify a confirmed correctness, security, privacy, migration, or documented-behavior violation in current `HEAD` after the full inventory and invariant sweep above.

## Likely Issues

None found.

## Manual-Validation Risks

### MVR-01 - Backup download still opens a validated path by pathname after `realpath()`

- Severity: Low
- Confidence: Medium
- Files:
  - `apps/web/src/app/api/admin/db/download/route.ts:43-76`
  - `apps/web/src/app/[locale]/admin/db-actions.ts:138-147`
  - `apps/web/src/__tests__/backup-download-route.test.ts:103-170`
- Evidence:
  - The download route validates the requested backup file with `lstat()`, rejects symlinks/non-files, resolves the path with `realpath()`, verifies it remains under `data/backups`, then calls `createReadStream(resolvedFilePath)` (`route.ts:43-76`).
  - The backup writer creates `data/backups` with mode `0700` and backup files with mode `0600` (`db-actions.ts:138-147`, `172`), so normal app-generated backups are not attacker-writable.
  - Existing tests cover auth/origin rejection, normal streaming, and unexpected stream failures (`backup-download-route.test.ts:103-170`), but do not simulate replacing the validated path between `realpath()` and `createReadStream()`.
- Failure scenario:
  - If a same-UID local process, compromised deployment user, or misconfigured host write path can modify `data/backups` concurrently, it could replace the validated backup pathname after `realpath()` returns and before `createReadStream()` opens it. Because `createReadStream()` opens by pathname and follows symlinks at open time, the comment at `route.ts:72-74` overstates the TOCTOU closure. I did not find an in-app unauthenticated or admin upload path that writes arbitrary symlinks into `data/backups`, so this is a host/runtime validation risk rather than a confirmed application exploit.
- Suggested fix:
  - For stronger defense-in-depth, open the file descriptor immediately after validation with no symlink following where available, then stream from the file descriptor rather than reopening the pathname. In Node, use `fs.promises.open(resolvedFilePath, constants.O_RDONLY | constants.O_NOFOLLOW)` where supported, validate `fd.stat().isFile()`, and create the stream from the `FileHandle` or descriptor. Add a regression test that mocks a symlink/path replacement after validation and asserts the stream does not follow the replaced path.

## Cross-File Invariant Sweep

- Admin API auth:
  - `withAdminAuth` centralizes cookie auth, same-origin checks, PAT scope handling, no-store, and `nosniff` headers in `apps/web/src/lib/api-auth.ts:55-141`.
  - Admin route lint passed for both current admin route files.
- Server action provenance:
  - Mutating action exports are gated by `requireSameOriginAdmin()` in `apps/web/src/lib/action-guards.ts:37-44`; the scanner reported all mutating exports as OK.
  - Public analytics actions are explicitly exempt and validate/rate-limit before writes in `apps/web/src/app/actions/public.ts:365-455`.
- Public route rate limiting:
  - OG image routes are IP-rate-limited before expensive render/fetch work in `apps/web/src/app/api/og/route.tsx:46-62` and `apps/web/src/app/api/og/photo/[id]/route.tsx:44-60`.
  - Semantic/similar search routes use the semantic limiter per the scanner.
  - Share-key pages rate-limit in the page body, while metadata stays generic and does not perform key lookup, in `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:35-101` and `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:40-115`.
- Privacy:
  - `publicSelectFields` omits GPS, original filenames, admin-only color/HDR fields, processing diagnostics, upload attribution, and pipeline internals in `apps/web/src/lib/data.ts:369-489`.
  - `publicMapSelectFields` is the only public latitude/longitude select and is constrained to `topics.map_visible = true` plus runtime assertion in `apps/web/src/lib/data.ts:1651-1687`.
  - Timeline/search mirrors carry compile-time privacy guards in `apps/web/src/lib/data-timeline.ts:20-67` and `apps/web/src/lib/data.ts:1516-1526`.
- Migrations:
  - The non-monotonic historical Drizzle journal region is documented and test-covered, not a new finding. `migrate.js` baselines individual hashes with original `when` values and post-checks missing hashes in `apps/web/scripts/migrate.js:710-805`.
  - Reconcile coverage tests explicitly cover create/index mirrors and drop tripwires for removed paid-download/reactions schema.
- Upload/processing:
  - Browser and Lightroom upload paths both use upload tracker claims, topic validation, metadata sanitization, processing snapshots, restore-maintenance checks, and upload-processing contract locking.
  - Delete/retry/backfill code paths are guarded by existing source-contract tests and passed the full unit suite.
- Color/HDR honesty:
  - Public field sets omit `is_hdr`, `transfer_function`, `matrix_coefficients`, `bit_depth`, `icc_profile_name`, `color_space`, `has_gain_map`, `was_downscaled`, and `pipeline_version`.
  - UI render sites gate admin-only color/HDR fields on `isAdmin`; source scans found expected gated use in `color-details-section`, `lightbox-color-pip`, `photo-viewer`, and `info-bottom-sheet`.
- Sitemap/build behavior:
  - Build-time DB refusal is handled by explicit homepage-only fallback in `apps/web/src/app/sitemap.ts:24-55`; production build completed successfully.

## Final Missed-Issues Sweep

I ran focused repository-wide searches for:

- Sensitive image/admin fields appearing outside data guards and admin-only UI.
- Raw SQL / `sql` usage, `LIKE` paths, and route-level URL/fetch surfaces.
- `dangerouslySetInnerHTML`, JSON-LD, metadata, redirect, OG, and CSP paths.
- Destructive filesystem/database operations and migration/drop behavior.
- Explicit TODO/FIXME/SECURITY/BUG annotations.

No additional confirmed or likely issue survived cross-file tracing against current tests and documented invariants. The only residual concern is MVR-01, which depends on host-level write access or a concurrent same-UID process rather than a demonstrated in-app path.
