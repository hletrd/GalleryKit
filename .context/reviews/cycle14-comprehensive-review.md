# Comprehensive Code Review — Cycle 14 (2026-04-19)

**Reviewer:** Multi-angle deep review (code quality, security, performance, i18n, architecture)
**Scope:** Full repository — all server actions, data layer, middleware, UI components, security modules, i18n

---

## Methodology

Every source file under `apps/web/src/` was examined, including:
- All 7 server action modules (`actions/*.ts`)
- Data layer (`lib/data.ts`), schema (`db/schema.ts`)
- Security modules (`session.ts`, `rate-limit.ts`, `auth-rate-limit.ts`, `validation.ts`, `sql-restore-scan.ts`, `serve-upload.ts`, `api-auth.ts`)
- Image processing pipeline (`process-image.ts`, `image-queue.ts`, `process-topic-image.ts`)
- All React components
- All unit test files
- i18n message files (`en.json`, `ko.json`)
- Middleware (`proxy.ts`), admin DB actions, instrumentation
- Public pages (home, topic, shared group, photo viewer)

Previous cycle findings (C1 through C13) were checked for regressions — none found. All deferred items were reviewed for relevance.

---

## Findings

### C14-01 (MEDIUM — Confidence: HIGH): Photo page passes `tags={[]}` to PhotoViewer despite `getImage` returning tags

**File:** `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:210`

**Problem:** The main photo page calls `getImageCached(imageId)` which returns the image object including tags (fetched via a separate query in `getImage`). However, the `PhotoViewer` component is rendered with `tags={[]}`, discarding the actual tags. This means tags are never displayed in the desktop sidebar or mobile bottom sheet for the main photo page.

In contrast:
- `s/[key]/page.tsx:84` correctly passes `tags={image.tags ?? []}`
- `g/[key]/page.tsx:106` correctly passes `tags={selectedImage.tags ?? []}`

The `getImage` function in `data.ts:300-405` correctly fetches tags via `Promise.all` and returns them. The `PhotoViewer` component correctly renders tags when provided (lines 326-334 and lines 197-205 in `info-bottom-sheet.tsx`). This is purely a data-passing bug in the page component.

**Concrete impact:** Tags are never displayed in the photo viewer sidebar or bottom sheet when viewing a photo from the main `/p/[id]` route. Users see an empty tag area despite the photo having associated tags.

**Fix:** Change line 210 from `tags={[]}` to `tags={image.tags ?? []}`.

---

### C14-02 (LOW — Confidence: HIGH): Hardcoded English strings in public page metadata

**File:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `generateMetadata`

**Problem:** The shared group page's `generateMetadata` function returns localized strings via `getTranslations`, which is correct. However, the OG/Twitter metadata strings are already using translation keys like `t('ogTitle')`, `t('ogDescription')`, etc. This was a finding from a prior review that has been partially addressed.

**Reclassification:** After re-examination, the metadata IS already localized via `getTranslations`. The `generateMetadata` function calls `const t = await getTranslations('sharedGroup')` and uses `t('ogTitle')`, `t('ogDescription')`, etc. Not an issue.

**Reclassified to: Not an issue.**

---

### C14-03 (LOW — Confidence: MEDIUM): Share rate limit uses post-increment pattern — safe by Node.js execution model

**File:** `apps/web/src/app/actions/sharing.ts:38-48`

**Problem:** The `checkShareRateLimit` function uses a pattern where it increments the counter and then checks the limit. In the "new window" branch (`!entry || entry.resetAt <= now`), it sets count to 1 without checking if concurrent requests might also be in the same branch. Multiple concurrent requests arriving when there's no existing entry would all independently set count to 1, losing the increments.

However, since Node.js is single-threaded and `checkShareRateLimit` is entirely synchronous (no awaits), and Node.js executes synchronous code atomically between event loop ticks, this race cannot actually happen in practice.

**Assessment:** Safe by Node.js's single-threaded execution model. The pattern is inconsistent with the auth rate limit's defensive approach, and would become a real bug if the function were ever made async. Low priority consistency item.

---

## Previously Fixed — Confirmed Resolved in This Cycle

All cycle 1-13 findings verified as resolved. Key fixes confirmed in source code:
- D-01 (SQL conditional comment bypass): `stripSqlCommentsAndLiterals` extracts inner content from `/*!ddddd ... */`
- D-02 (Advisory lock with pooled connections): `restoreDatabase` uses `connection.getConnection()`
- S-01 (GPS validation out-of-range): `convertDMSToDD` has `Math.abs(dd) > maxDegrees` check
- S-02 (Object URL recreation): `upload-dropzone.tsx` uses ref-based incremental URL management
- S-03 (Infinite claim retry): `MAX_CLAIM_RETRIES = 10` with escalating backoff
- S-04 (No live touch-drag): `info-bottom-sheet.tsx` has `handleTouchMove` with live tracking
- S-05 (document.title not restored): `photo-viewer.tsx` captures `previousTitle` and restores in cleanup
- S-06 (Native confirm()): `admin-user-manager.tsx` uses AlertDialog
- S-07 (Temp file permissions): `process-topic-image.ts` uses `{ mode: 0o600 }`
- S-08 (Duplicated maxInputPixels): Separate `MAX_INPUT_PIXELS_TOPIC` export
- C-02/C-03 (Tags discarded on shared pages): Both pass `tags={image.tags ?? []}`
- C-08 (Dead \r in CSV regex): Regex is `/^[=+\-@\t]/`
- D-04 (updateTag 0 rows): Checks `result.affectedRows === 0`
- D-05 (deleteTopicAlias error handling): Has try/catch
- D-07 (batchUpdateImageTags transactional): Uses `db.transaction()`
- D-08 (CSV export truncation): Includes `warning` field
- D-09 (revokePhotoShareLink 0 rows): Checks `result.affectedRows === 0`
- R-03 (Octet-stream fallback): Returns 404 for unknown extensions
- A-01 (Rate limit TOCTOU): Pre-increment pattern with rollback
- A-02 (Credential oracle): Generic error message
- A-04 (Password change rate limit): Separate Map with rate limiting
- FS-02 (Unbounded revalidatePath): Large batches use layout-level revalidation

**Corrected finding from initial cycle 14 review:** The search rate limit (`searchImagesAction` in `public.ts`) already has rollback logic on lines 83-94 for DB increment failures, and on lines 69-74 for when the DB check determines the user is limited. The initial review's C14-01 about missing rollback was incorrect — the code already handles this.

---

## Areas Reviewed With No New Issues Found

- **Session management** (`session.ts`): HMAC-SHA256 signing, timing-safe comparison, 24-hour expiry
- **Path traversal prevention** (`serve-upload.ts`, `validation.ts`): SAFE_SEGMENT regex, whitelist, containment check, symlink rejection
- **SQL injection prevention** (`sql-restore-scan.ts`): Dangerous SQL pattern scanning with conditional comment handling
- **Rate limiting**: Login/password change have pre-increment + rollback; search has rollback on DB failure
- **Image processing pipeline**: Sharp limitInputPixels, ICC bounds checking, queue claim mechanism
- **Safe JSON-LD**: `<` escaped to `\u003c` preventing XSS
- **Data privacy**: GPS coordinates excluded from public API, filename_original excluded
- **CSV injection prevention**: Formula character prefix, CR/LF stripping
- **Argon2 timing-safe user enumeration**: Dummy hash for non-existent users
- **Upload tracker**: Pre-increment + post-adjust pattern, hard cap on keys
- **View count buffering**: Hard cap, re-buffer on failure, graceful shutdown flush, exponential backoff
- **Admin auth guard**: Cookie format check before redirect
- **DB backup security**: Advisory lock on dedicated connection, SQL scanning
- **Schema design**: Composite indexes well-aligned with query patterns

---

## Deferred Carry-Forward

All previously deferred items from cycles 5-13 remain deferred with no change in status:
1. U-15 connection limit docs mismatch (very low priority)
2. U-18 enumerative revalidatePath (low priority, current approach works)
3. /api/og throttle architecture (edge runtime, delegated to reverse proxy)
4. Font subsetting (Python brotli dependency issue)
5. Docker node_modules removal (native module dependency)
6. C5-04 searchRateLimit in-memory race (safe by Node.js single-thread guarantee)
7. C5-05 original_file_size from client value (acceptable for display metadata)
8. C5-07 prunePasswordChangeRateLimit infrequent pruning (hard cap sufficient)
9. C5-08 dumpDatabase partial file cleanup race (negligible risk)
10. C6-10 queue bootstrap unbounded fetch (by-design, paginated limit if >10K pending)
11. C7-07 NULL capture_date prev/next navigation (legacy-only, reasonable UX)
12. C7-08 rate limit inconsistency in safe direction (no fix needed)
13. C8-04 searchImages query length guard (defense in depth, caller truncates)
14. C8-05 audit log on race-deleted image (control flow already guards)
15. C8-10 batchUpdateImageTags added count accuracy (negligible UX inaccuracy)
16. C13-03 CSV export column headers hardcoded in English (LOW, convention)

---

## TOTALS

- **1 MEDIUM** finding requiring implementation (C14-01)
- **0 CRITICAL/HIGH** findings
- **1 total** actionable finding
