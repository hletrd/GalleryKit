# Comprehensive Code Review — Cycle 11 (2026-04-19)

**Reviewer:** Multi-angle deep review (code quality, security, performance, correctness, architecture, UI/UX)
**Scope:** Full repository re-review after cycles 1-10 fixes

---

## Summary

Cycle 11 deep review of the full codebase found **5 new findings** (2 MEDIUM, 3 LOW). No CRITICAL findings. The codebase remains in strong shape after 37+ prior cycles of fixes. The two cycle 10 findings (C10-F01 batchAddTags FK handling, C10-F02 duplicated tag filter logic) are confirmed fixed.

## Findings

| ID | Description | Severity | Confidence | File |
|----|------------|----------|------------|------|
| C11-F01 | `uploadImages` tracker adjustment may operate on stale reference after eviction | MEDIUM | Medium | `apps/web/src/app/actions/images.ts:246-250` |
| C11-F02 | `api-auth.ts` returns hardcoded English `'Unauthorized'` string | MEDIUM | High | `apps/web/src/lib/api-auth.ts:13` |
| C11-F03 | `photo-viewer.tsx` has hardcoded English fallback `'Failed to share'` | LOW | High | `apps/web/src/components/photo-viewer.tsx:242` |
| C11-F04 | `login-form.tsx` references missing `description` translation key | LOW | High | `apps/web/src/app/[locale]/admin/login-form.tsx:34` |
| C11-F05 | `deleteImages` audit log omits `notFoundCount` from metadata | LOW | Medium | `apps/web/src/app/actions/images.ts:414-418` |

### C11-F01: uploadImages tracker adjustment may operate on stale reference after eviction [MEDIUM]

**File:** `apps/web/src/app/actions/images.ts:246-250`

```typescript
tracker.count += (successCount - files.length);
tracker.bytes += (uploadedBytes - totalSize);
uploadTracker.set(uploadIp, tracker);
```

The `tracker` variable is a reference to the Map value object, captured at line 79. During the upload loop (lines 136-239), `pruneUploadTracker()` (called at line 78, and possibly triggered by other requests) may evict the tracker entry from the Map. If the tracker is evicted, the `tracker` reference becomes orphaned — the final `uploadTracker.set(uploadIp, tracker)` on line 250 would restore it, but the additive adjustment on lines 248-249 would not reflect any concurrent request's modifications made after eviction.

**Failure scenario:** Two concurrent uploads from the same IP. Request A's tracker entry gets evicted by `pruneUploadTracker()` triggered from Request B. Request A finishes and adjusts its orphaned tracker, then sets it back — overwriting Request B's tracker state. This could cause the upload quota tracking to be slightly inaccurate.

**Fix:** Re-read the tracker from the Map immediately before adjustment:
```typescript
const currentTracker = uploadTracker.get(uploadIp) || tracker;
currentTracker.count += (successCount - files.length);
currentTracker.bytes += (uploadedBytes - totalSize);
uploadTracker.set(uploadIp, currentTracker);
```

### C11-F02: api-auth.ts returns hardcoded English 'Unauthorized' string [MEDIUM]

**File:** `apps/web/src/lib/api-auth.ts:13`

The `withAdminAuth` wrapper returns `{ error: 'Unauthorized' }` with a hardcoded English string. All server actions use `t('unauthorized')` via `getTranslations('serverActions')`, but this API-route auth wrapper was never updated. The `/api/admin/db/download` route uses `withAdminAuth`, so if auth fails, the JSON error response will be in English.

Note: API routes run outside the i18n middleware matcher (explicitly excluded per `proxy.ts` config comment), so `getTranslations` may not have the request-scoped locale context. The fix should use `getTranslations` and localize the string for consistency.

**Failure scenario:** An admin's session expires while downloading a backup; the API returns `{"error":"Unauthorized"}` in English while all other admin errors appear in Korean.

**Fix:** Import `getTranslations` from `next-intl/server` and replace `'Unauthorized'` with `t('unauthorized')` inside the wrapper function.

### C11-F03: photo-viewer.tsx has hardcoded English fallback 'Failed to share' [LOW]

**File:** `apps/web/src/components/photo-viewer.tsx:242`

```typescript
toast.error(result.error || 'Failed to share');
```

The server action `createPhotoShareLink` always returns a localized error via `t()`, so `result.error` will be a translated string. However, the fallback `'Failed to share'` is hardcoded English. If `result.error` were somehow an empty string or falsy, the user would see English text.

**Fix:** Replace `'Failed to share'` with `t('viewer.errorSharing')`, which already exists in both `en.json` and `ko.json`.

### C11-F04: login-form.tsx references missing `description` translation key [LOW]

**File:** `apps/web/src/app/[locale]/admin/login-form.tsx:34`

The `LoginForm` component renders `<CardDescription>{t('description')}</CardDescription>` using `useTranslations('login')`, but neither `en.json` nor `ko.json` has a `description` key in the `login` section. With next-intl, a missing key typically renders as the key path (e.g., "login.description") or an empty string depending on configuration.

**Failure scenario:** The login page CardDescription shows "login.description" as visible text to every user visiting the admin login page.

**Fix:** Add `"description"` key to both `en.json` and `ko.json` under the `login` section with appropriate text (e.g., "Sign in to manage your gallery" / "갤러리 관리를 위해 로그인하세요").

### C11-F05: deleteImages audit log omits notFoundCount from metadata [LOW]

**File:** `apps/web/src/app/actions/images.ts:414-418`

```typescript
logAuditEvent(currentUser?.id ?? null, 'images_batch_delete', 'image', foundIds.join(','), undefined, { count: successCount }).catch(console.debug);
```

The audit log records `count: successCount` (images actually deleted) but does not record `notFoundCount` (IDs requested but not found). For audit completeness, both values should be recorded.

**Fix:** Add `requested: ids.length, notFound: notFoundCount` to the audit metadata.

---

## Previously Fixed — Confirmed Resolved

All cycle 1-10 findings remain resolved. No regressions detected in:
- Auth i18n (C9-01)
- Admin action i18n (C9-02, C10-01, C10-02, C10-03)
- Form maxLength (C9-03)
- Batch tag FK validation (C10-F01)
- Tag filter DRY refactoring (C10-F02)
- All prior fixes from cycles 1-8 confirmed intact

---

## Deferred Carry-Forward

All previously deferred items from cycles 5-37 remain deferred with no change in status:

- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03 / C7-F01: `flushGroupViewCounts` re-buffers without retry limit
- C30-04 / C36-02 / C8-01: `createGroupShareLink` insertId validation / BigInt coercion
- C9-F01: original_file_size bigint mode: 'number' precision [MEDIUM]
- C9-F03: searchImagesAction rate limit check/increment window [LOW]
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- C4-F02 / C6-F04: Admin checkboxes use native `<input>` (no Checkbox component)
- C6-F03: No E2E test coverage for upload pipeline
- C7-F03: No test coverage for view count buffering system
- C7-F04: No test for search rate limit rollback logic
- C8-F01: deleteTopicAlias revalidation (informational)

---

## Review Coverage

- All server actions (auth, images, topics, tags, sharing, admin-users, public)
- Middleware (proxy.ts)
- Data layer (data.ts, cache deduplication, view count buffering)
- Image processing pipeline (process-image.ts, image-queue.ts)
- Auth & session management (session.ts, api-auth.ts)
- Rate limiting (rate-limit.ts, auth-rate-limit.ts)
- Upload security (serve-upload.ts, upload-limits.ts)
- DB schema (schema.ts)
- Admin pages (dashboard, db, password, users, categories, tags)
- Public pages (photo, shared group, shared photo, topic, home)
- API routes (health, og, db download)
- Instrumentation & graceful shutdown
- Validation (validation.ts)
- Audit logging (audit.ts)
- i18n & locale paths
- SQL restore scanning (sql-restore-scan.ts)
- Revalidation (revalidation.ts)
- Client components (home-client, photo-viewer, upload-dropzone, image-manager)
- Tests (9 test files reviewed)

## AGENT FAILURES

None — single reviewer completed all angles.

## TOTALS

- **2 MEDIUM** findings (C11-F01, C11-F02)
- **3 LOW** findings (C11-F03, C11-F04, C11-F05)
- **0 CRITICAL** findings
- **5 total** unique findings
