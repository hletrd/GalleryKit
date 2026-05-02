# Aggregate Review — Cycle 3 (RPL loop)

## Review method

Deep code review with multi-perspective analysis (code quality, security, performance,
architecture, UI/UX, documentation). Single-agent review of all 242 TypeScript source
files after 25+ prior cycles. Focus on the recent i18n/search refactor and fresh
cross-cutting scans.

---

## Gate Status (all green)

- eslint: clean
- tsc --noEmit: clean
- lint:api-auth: OK
- lint:action-origin: OK
- vitest: 84 test files, 586 tests, all passing

---

## NEW findings this cycle

### C3-RPL-01: Missing i18n key `viewer.fullscreenUnavailable` (MEDIUM, High confidence)

**File:** `apps/web/src/components/lightbox.tsx:190`
**Code:** `toast.error(t('viewer.fullscreenUnavailable'));`

**Problem:** The i18n key `viewer.fullscreenUnavailable` is used in lightbox.tsx but
does not exist in `apps/web/messages/en.json` or `apps/web/messages/ko.json`. The
key exists only as `aria.fullscreenUnavailable` (different namespace, different purpose).

**Impact:** When fullscreen is unavailable, the toast displays the raw key string
instead of a localized message. User-facing bug in both English and Korean.

**Fix:** Add the missing key to both translation files:
- en.json viewer namespace: `"fullscreenUnavailable": "Fullscreen is not available"`
- ko.json viewer namespace: `"fullscreenUnavailable": "전체 화면을 사용할 수 없습니다"`

**Discovered by:** automated i18n key audit during code-reviewer pass.

---

## Previously fixed findings (confirmed still fixed from cycles 19-25)

- C22-01: `exportImagesCsv` GC hint — FIXED (results.length = 0)
- C21-AGG-01: `clampDisplayText` surrogate-safe — FIXED
- C21-AGG-02: `exportImagesCsv` GROUP_CONCAT separator — FIXED
- C22-AGG-01: isValidTagSlug countCodePoints — FIXED
- C22-AGG-02: original_format slice documented — DOCUMENTED
- C20-AGG-01: password length countCodePoints — FIXED
- C20-AGG-02: getTopicBySlug isValidSlug — FIXED
- C20-AGG-03: updateImageMetadata redundant updated_at — FIXED
- C20-AGG-04/05: tags.ts catch blocks — FIXED
- C19-AGG-01: getImageByShareKeyCached cache caveat — DOCUMENTED
- C19-AGG-02: duplicated topic-slug regex — FIXED
- C19F-MED-01: searchGroupByColumns — FIXED
- C18-MED-01: searchImagesAction re-throw — FIXED

---

## Re-verified (confirmed correct this cycle)

1. **Auth flow**: Dual IP+account rate limiting, Argon2, timingSafeEqual — correct
2. **Upload flow**: TOCTOU prevention, upload-processing contract lock — correct
3. **Sanitization**: Unicode bidi/invisible char rejection, countCodePoints — correct
4. **Privacy guards**: Compile-time guard, GPS exclusion — correct
5. **Rate-limit patterns**: Three rollback patterns, DB-backed counters — correct
6. **Action guards**: requireSameOriginAdmin on all mutating actions — correct
7. **API auth**: withAdminAuth wrapper on all admin routes — correct
8. **File serving**: Symlink rejection, path traversal prevention — correct
9. **Image queue**: Advisory lock, claim check, orphaned file cleanup — correct
10. **DB restore**: Advisory lock, SQL scan, header validation — correct
11. **CSV export**: CHAR(1) separator, formula-injection guard — correct
12. **OG route**: countCodePoints truncation, per-IP rate limit — correct
13. **Session management**: HMAC-SHA256, timingSafeEqual, rotation on password change — correct
14. **CSP**: Nonce-based script-src, frame-ancestors, base-uri — correct
15. **JSON-LD**: safeJsonLd with <, U+2028, U+2029 escaping — correct
16. **Search component**: Unified 'error' status, debounce, ARIA combobox — correct
17. **i18n cleanup**: All 18 removed keys verified as unused — correct

---

## Carry-forward (unchanged — existing deferred backlog)

- A17-MED-01 / C14-LOW-05: data.ts god module
- A17-MED-02 / C14-LOW-06: CSP style-src 'unsafe-inline' in production
- A17-MED-03 / C14-LOW-06: getImage parallel DB queries — pool exhaustion risk
- A17-LOW-04 / C14-LOW-07: permanentlyFailedIds process-local — lost on restart
- C14-LOW-01: original_file_size BigInt precision risk
- C14-LOW-02: lightbox.tsx showControls callback identity instability
- C14-LOW-03: searchImages alias branch over-fetch
- C15-LOW-04: flushGroupViewCounts re-buffers into new buffer
- C15-LOW-05 / C13-03 / C22-02: CSV headers hardcoded in English
- C15-LOW-07: adminListSelectFields verbose suppression pattern
- C14-MED-03 / C30-04 / C36-02 / C8-01: createGroupShareLink BigInt coercion risk on insertId
- C9-TE-03-DEFER: buildCursorCondition cursor boundary test coverage
- C7-MED-04: searchImages GROUP BY lists all columns — fragile under schema changes
- D1-MED: No CSP header on API route responses
- D1-MED: getImage parallel queries / UNION optimization
- D2-MED: data.ts approaching 1500-line threshold
- D4-MED: CSP unsafe-inline
- C25-LOW-01: i18n cross-namespace duplicate values (cosmetic)
- C25-LOW-02: Restore confirmation dialog lost interrogative tone (cosmetic)
- C25-LOW-03: serverActions.invalidTagName / invalidTagNames identical duplicates (cosmetic)
- All other items from prior deferred lists

---

## Convergence assessment

The codebase remains in a highly hardened state. The only new finding this cycle is a
missing i18n key (MEDIUM severity, user-facing but not security-critical). This was
not introduced by the recent i18n cleanup — it pre-existed as a gap that the cleanup
process helped discover. Finding counts continue their decline:
24->12->6->4->3->7->10->7->4->5->9->6->7->14->5->9->5->5->2->4->3->2->0->0->0->0->1
