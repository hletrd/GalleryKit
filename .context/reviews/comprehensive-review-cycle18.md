# Comprehensive Review — Cycle 18 (2026-04-19)

**Reviewer:** Single deep-review pass over all key source files
**Scope:** All server actions, middleware, auth, rate-limiting, data layer, image processing, DB schema, API routes, UI components

---

## Methodology

Read every server action file, all lib modules, middleware, API routes, and DB schema. Validated cross-file interactions (rate-limit patterns, auth guard chains, data-flow integrity). Cross-referenced against prior cycle aggregates (C1 through C17) to avoid duplicates.

---

## Previously Fixed — Confirmed Resolved

All findings from cycles 1-17 remain fixed. No regressions detected. Key items re-verified:

- C17-01 (search rate limit rollback on incrementRateLimit failure): `public.ts` lines 82-87 now keep the in-memory pre-increment on DB failure. Confirmed fixed.
- C17-02 (seo.ts control chars): Line 104 uses `stripControlChars()`. Confirmed fixed.
- C17-03 (settings.ts control chars): Line 61 uses `stripControlChars()`. Confirmed fixed.
- C16-01 through C16-08: All confirmed fixed per C17 re-verification.
- C39-01 through SEC-39-03: All confirmed fixed per C17 re-verification.

---

## NEW FINDINGS

### C18-01: Share rate limit and user-create rate limit don't roll back in-memory counter when DB-backed check returns "limited" [LOW] [MEDIUM confidence]

- **Files**: `apps/web/src/app/actions/sharing.ts` lines 63-75, `apps/web/src/app/actions/admin-users.ts` lines 70-85
- **Description**: Both `createPhotoShareLink`/`createGroupShareLink` and `createAdminUser` use a two-phase rate limit: (1) in-memory pre-increment via `checkShareRateLimit`/`checkUserCreateRateLimit`, then (2) DB-backed increment + check. When the DB-backed check returns `dbLimit.limited`, the action returns an error but does NOT roll back the in-memory pre-increment. This causes the in-memory counter to over-count by 1 per rejected request. After several rejected requests, the in-memory counter drifts higher than the DB counter, causing slightly more aggressive rate limiting than intended.

  The search rate limit (`public.ts` lines 64-76) correctly rolls back the in-memory counter when the DB says "limited", making this an inconsistency in the rate-limiting pattern across the codebase.

- **Concrete failure scenario**: An admin is at the share rate limit (20/20). They make 5 more share requests, all rejected by the DB. The in-memory counter is now at 25 (vs DB at 20). After the window partially expires, the DB counter drops to 18 (some buckets expired). The in-memory counter is still at 25. The in-memory check rejects the next request, even though the DB would allow it (18 < 20). The admin is rate-limited prematurely for the remainder of the window.

- **Fix**: Add in-memory rollback when the DB-backed check returns "limited", matching the pattern in `searchImagesAction` (public.ts lines 64-76):

  ```typescript
  if (dbLimit.limited) {
      // Roll back in-memory pre-increment to stay consistent with DB
      const currentEntry = shareRateLimit.get(ip);
      if (currentEntry && currentEntry.count > 1) {
          currentEntry.count--;
      } else {
          shareRateLimit.delete(ip);
      }
      return { error: t('tooManyShareRequests') };
  }
  ```

  Apply the same pattern to `checkUserCreateRateLimit` in `admin-users.ts`.

### C18-02: `stripControlChars` does not strip `\x7F` (DEL character) [LOW] [LOW confidence]

- **File**: `apps/web/src/lib/sanitize.ts` line 8
- **Description**: The regex `/[\x00-\x08\x0B\x0C\x0E-\x1F]/g` strips ASCII control characters C0 (0x00-0x1F) but skips `\x7F` (DEL). The DEL character can cause display anomalies in some contexts (e.g., terminal rendering, certain text editors) and could potentially interfere with MySQL string operations in edge cases. React JSX rendering handles it gracefully (renders as invisible char), and MySQL stores it as-is in VARCHAR/TEXT columns without truncation.

- **Concrete failure scenario**: Extremely unlikely — DEL character almost never appears in user-submitted text from browser forms. Even if it did, the impact would be limited to a cosmetic display issue in the admin dashboard.

- **Fix**: Extend the regex to include `\x7F`: `/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g`

### C18-03: `uploadImages` GPS stripping defaults to "keep" when DB is unavailable [LOW] [MEDIUM confidence]

- **File**: `apps/web/src/app/actions/images.ts` lines 146-154
- **Description**: When `getGalleryConfig()` throws (DB unavailable), GPS coordinates are not stripped from uploaded images. The comment says "privacy-safe default is to keep", but a stricter privacy posture would strip GPS by default when the admin-configured setting cannot be verified. This is a design judgment rather than a bug — since only admins can see GPS data (excluded from public queries) and the admin is the uploader, the risk is minimal. However, if a future feature exposes GPS data to the public, this default could become a privacy leak.

- **Concrete failure scenario**: DB is temporarily unreachable during an upload. The admin has `stripGpsOnUpload: true` configured. GPS coordinates are stored in the database because the config couldn't be read. If a future code change accidentally includes GPS in a public query, the privacy intent is violated.

- **Fix**: Change the catch block to strip GPS by default when the config cannot be read:

  ```typescript
  } catch {
      // DB unavailable — strip GPS by default (privacy-safe: err on the side of
      // privacy when the admin's preference can't be verified)
      exifDb.latitude = null;
      exifDb.longitude = null;
  }
  ```

---

## DEFERRED CARRY-FORWARD

All previously deferred items remain unchanged. See `.omc/plans/plan-deferred-items.md` for the full list.

---

## TOTALS

- **0 CRITICAL/HIGH** findings
- **0 MEDIUM** findings
- **3 LOW** findings (C18-01, C18-02, C18-03)
- **3 total** new findings
