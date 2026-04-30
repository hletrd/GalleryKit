# Verifier Review — Cycle 2 Fresh

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Verification summary

All configured gates pass on the current HEAD:

- `npm run lint --workspace=apps/web`: PASS (clean)
- `npx tsc --noEmit --project apps/web/tsconfig.json`: PASS (0 errors)
- `npm test --workspace=apps/web`: PASS (78 test files, 503 tests passing)
- `npm run lint:api-auth --workspace=apps/web`: PASS
- `npm run lint:action-origin --workspace=apps/web`: PASS

## Verified fixes from Cycle 1

| AGG1 ID | Finding | Status |
|---------|---------|--------|
| AGG1-05 | Light destructive button contrast | Verified fixed in globals.css/button.tsx |
| AGG1-08 | File-serving TOCTOU | Verified fixed: serve-upload.ts streams from resolvedPath |
| AGG1-09 | Settings Record<string,string> | Verified fixed: normalizeStringRecord used |
| AGG1-10 | batchUpdateImageTags Array.isArray | Verified fixed: guard present |
| AGG1-12 | nginx admin throttling | Verified fixed: seo/settings in rate-limited location |
| AGG1-39 | Share rate limit rollback | Verified fixed: rollbackShareRateLimitFull symmetric |
| AGG1-21 | Share-key page rate limiting | Verified fixed: preIncrementShareAttempt in rate-limit.ts |

## New finding

### C2-VER-01 (Medium / High). Shared-group view count inflation not yet addressed

- AGG1-07 remains unimplemented. Verified by reading `g/[key]/page.tsx` — the component still calls `getSharedGroupCached(key)` without passing `{ incrementViewCount: false }` for photo detail renders.
- Evidence: `apps/web/src/lib/data.ts:852` — `if (options?.incrementViewCount !== false)` defaults to true when no options are passed.

## Behavioral verification spot checks

- Login rate limiting (per-IP + per-account): verified both in-memory and DB-backed counters are pre-incremented before check.
- Session token verification: HMAC-SHA256 with timingSafeEqual confirmed.
- Upload quota tracking: pre-increment + settle pattern verified in `images.ts:242-244`.
- Restore advisory lock: `GET_LOCK('gallerykit_db_restore', 0)` + upload-processing contract lock confirmed.
