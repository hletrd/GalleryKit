# Cycle 7 Comprehensive Multi-Angle Review (2026-04-19)

**Scope:** Full codebase review covering all server actions, data layer, auth, middleware, image processing, frontend components, admin pages, public pages, API routes, and deployment.

**Reviewers:** Code quality, security, performance, architecture, test engineer, UI/UX, verifier, debugger, document specialist

---

## Findings

### C7-F01: `flushGroupViewCounts` tight loop during extended DB outage [MEDIUM, Medium Confidence]
**File:** `apps/web/src/lib/data.ts:27-51`
**Reviewers:** code-quality, performance

In `flushGroupViewCounts`, every DB update failure triggers a re-buffer (respecting the 1000-entry hard cap). During an extended DB outage, the system enters a tight loop: flush processes 1000 entries, all fail, all re-buffer, 5s timer fires again, repeat. This creates a burst of 1000 failed DB queries every 5 seconds, adding unnecessary load that could slow DB recovery.

Previously deferred as C30-03/C36-03, but re-evaluating: the tight-loop aspect during outages is worse than originally documented.

**Failure scenario:** DB outage lasting 2+ hours. The flush timer fires ~1440 times, each time attempting 1000 queries that all fail. That is 1,440,000 failed DB connection attempts during the outage.

**Fix:** Add a consecutive failure counter to `flushGroupViewCounts`. After N consecutive fully-failed flushes (e.g., 3), exponentially back off the timer interval (5s -> 30s -> 120s -> 300s cap). Reset on any successful partial flush.

### C7-F02: `searchImagesAction` query validation length (1000) exceeds actual search slice (200) [LOW, Medium Confidence]
**File:** `apps/web/src/app/actions/public.ts:25,96`
**Reviewers:** security, code-quality

The early return checks `query.length > 1000` (line 25), but the actual search uses `query.trim().slice(0, 200)` (line 96). A 500-char query passes validation, consumes a rate limit token, but only the first 200 chars are searched. The user sees unexpected results without understanding why.

**Fix:** Change line 25 from `query.length > 1000` to `query.length > 200` to fail fast on overly long queries, or increase the search slice to match the validation limit.

### C7-F03: No test coverage for view count buffering system [LOW, Medium Confidence]
**File:** `apps/web/src/__tests__/`, `apps/web/src/lib/data.ts:12-65`
**Reviewers:** test-engineer

The view count buffering system (`bufferGroupViewCounts`, `flushGroupViewCounts`, `flushBufferedSharedGroupViewCounts`) has no unit test coverage. This is a critical data-flow path for shared group pages. Untested edge cases: buffer overflow, concurrent flush, re-buffer on DB error, graceful shutdown flush.

**Fix:** Add unit tests for the buffer system using a mock DB.

### C7-F04: No test for `searchImagesAction` rate limit rollback logic [LOW, Medium Confidence]
**File:** `apps/web/src/app/actions/public.ts:62-94`
**Reviewers:** test-engineer

The rollback logic (lines 69-74, 88-93) that decrements the in-memory counter when the DB check returns limited or the increment fails is untested. This was a recent fix (commit a6bb900) and should have regression tests.

**Fix:** Add tests for the search rate limit rollback paths.

### C7-F05: `nav-client.tsx` locale switch `useCallback` called inline in JSX [LOW, Low Confidence]
**File:** `apps/web/src/components/nav-client.tsx:143-146`
**Reviewers:** code-quality, ui-ux

The locale switch button has `useCallback` called inline within the JSX `onClick` prop. This creates a new callback reference on every render since `useCallback` is invoked during render, not at the component level. This doesn't provide the memoization benefit `useCallback` is intended for. However, since the button isn't passed as a prop to a memoized child, the performance impact is negligible.

**Fix:** Move the `useCallback` to the component level with proper dependencies, or simply use a regular arrow function since there's no memoized child depending on reference stability.

### C7-F06: `getImage` prev/next navigation with NULL `capture_date` produces incorrect SQL `= NULL` instead of `IS NULL` [LOW, Medium Confidence]
**File:** `apps/web/src/lib/data.ts:333-378`
**Reviewers:** code-quality, debugger

The prev/next navigation queries use `eq(images.capture_date, image.capture_date)` for tiebreaker conditions. When `image.capture_date` is null (legacy images without EXIF), Drizzle generates `capture_date = NULL` in SQL. In MySQL, `= NULL` is always false -- the correct comparison is `IS NULL`. This means the second and third `or()` branches (tiebreakers on `created_at` and `id`) never match for NULL-date images.

In practice, this works acceptably because NULL-date images are isolated in navigation -- they can only navigate to other NULL-date images through the first `or()` branch. This prevents confusing cross-type navigation.

**Fix:** Replace `eq(images.capture_date, image.capture_date)` with a conditional that uses `sql\`${images.capture_date} IS NULL\`` when `image.capture_date` is null, and `eq(images.capture_date, image.capture_date)` otherwise. LOW priority since NULL-date images are uncommon (legacy only).

---

## Previously Fixed -- Confirmed Still Resolved

All cycle 1-6 findings remain resolved. No regressions detected. Specifically verified:
- C6-F01 (privacy guard): Compile-time assertion at data.ts:108-120 -- STILL PRESENT
- C6-F02 (eslint-disable): Per-element disable at home-client.tsx:299 -- STILL PRESENT
- Upload tracker TOCTOU: Pre-increment pattern at images.ts:112-119 -- WORKING
- Session transaction: Login session creation in db.transaction at auth.ts:157-169 -- WORKING
- Password change transaction: Already wrapped in db.transaction at auth.ts:310-323 -- WORKING
- CSV export memory: Already uses `let results` with GC release at db-actions.ts:37 -- WORKING
- Search rate limit rollback: Rollback logic at public.ts:69-74, 88-93 -- WORKING
- Password form maxLength: All three fields have maxLength={1024} -- PRESENT
- Topic i18n: All error messages use t() with translations in en.json/ko.json -- COMPLETE
- Topic-manager isDeleting: Split into isDeletingTopic/isDeletingAlias -- COMPLETE

---

## Deferred Carry-Forward

All previously deferred items remain with no change in status:

- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03 / C7-F01: `flushGroupViewCounts` re-buffers without backoff (upgraded this cycle)
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- C4-F02 / C6-F04 / C7-CARRY: Admin checkboxes use native `<input>` (no Checkbox component)
- C6-F03: No E2E test coverage for upload pipeline

---

## Totals

- **1 MEDIUM** finding (C7-F01: view count flush tight loop during DB outage)
- **5 LOW** findings (C7-F02 through C7-F06)
- **0 CRITICAL/HIGH** findings
- **6 total** unique findings
- **2 actionable** findings requiring implementation (C7-F01, C7-F02)
- **3 test** findings (C7-F03, C7-F04)
- **1 minor improvement** finding (C7-F05)
