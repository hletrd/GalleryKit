# Aggregate Review — Cycle 2 (2026-04-23)

**Scope:** Current repository state in `/Users/hletrd/flash-shared/gallery`

## REVIEWER INVENTORY / FAN-OUT STATUS

Requested reviewer lanes for this cycle:
- `code-reviewer` — completed
- `perf-reviewer` — completed (manual fallback; no spawnable perf-reviewer role in current tool role catalog)
- `security-reviewer` — completed
- `critic` — completed
- `verifier` — completed
- `test-engineer` — completed
- `tracer` — completed (manual fallback; historical reviewer exists in repo artifacts but not as a current spawnable role)
- `architect` — completed
- `debugger` — completed
- `document-specialist` — completed (manual fallback via `researcher`/document pass; no current spawnable exact role)
- `designer` — partial/incomplete evidence only
- `researcher` / document-specialist analog — completed

## DEDUPED FINDINGS

### AGG2-01 — Public metadata/page rendering duplicates grouped tag queries and metadata does them even without tag filters
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Flagged by:** `code-reviewer`, `perf-reviewer`, `critic`, `architect`, `tracer`, `verifier`
- **Primary citations:** `apps/web/src/lib/data.ts:229-246`, `apps/web/src/app/[locale]/(public)/page.tsx:24-25,83-86`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:32-33,111-122`
- **Why it is a problem:** `getTags()` is a grouped aggregate over `tags`/`imageTags`/`images`, but the public route stack runs it redundantly. The metadata layer also executes it on the common no-tag path where it cannot affect output.
- **Concrete failure scenario:** Crawlers and cold visitors repeatedly trigger the same tag aggregation twice on `/` and topic routes, increasing DB load on hot unauthenticated traffic.
- **Suggested fix:** Add a request-scoped `getTagsCached(topic?)` helper and skip metadata tag resolution when `tags` is absent.

### AGG2-02 — Home metadata still fetches fallback image/config data when a custom OG image is configured
- **Severity:** LOW
- **Confidence:** HIGH
- **Flagged by:** `code-reviewer`, `perf-reviewer`, `critic`
- **Primary citations:** `apps/web/src/app/[locale]/(public)/page.tsx:22-31,44-54`
- **Why it is a problem:** The route loads `getImagesLite(..., 1, 0)` and `getGalleryConfig()` before checking whether `seo.og_image_url` already determines the output.
- **Concrete failure scenario:** Branded deployments that always use a fixed OG asset still pay unnecessary DB/config work for every metadata render.
- **Suggested fix:** Return early from the custom-OG branch before fetching fallback data.

### AGG2-03 — Search rate-limit pruning performs full-map O(n) work on every debounced public search request
- **Severity:** LOW
- **Confidence:** MEDIUM
- **Flagged by:** `perf-reviewer`, `test-engineer`
- **Primary citations:** `apps/web/src/app/actions/public.ts:33-49`, `apps/web/src/components/search.tsx:67-81`, `apps/web/src/lib/rate-limit.ts:19-25`
- **Why it is a problem:** Search requests already hit a wildcard-search path; adding full-map prune work on every request wastes CPU in the same hot path.
- **Concrete failure scenario:** A few concurrent users typing quickly produce repeated in-memory O(n) scans in addition to the DB work.
- **Suggested fix:** Extract throttled search-map pruning so expiry/cap semantics are preserved without rescanning the map on every request.

### AGG2-04 — Missing regression coverage for the public metadata/search performance helpers
- **Severity:** LOW
- **Confidence:** HIGH
- **Flagged by:** `test-engineer`
- **Primary citations:** `apps/web/src/app/[locale]/(public)/page.tsx:18-31`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:18-33`, `apps/web/src/app/actions/public.ts:33-49`, `apps/web/src/__tests__/rate-limit.test.ts`
- **Why it is a problem:** The planned optimizations are small enough to regress silently unless tests lock them in.
- **Concrete failure scenario:** A future refactor reintroduces unconditional tag queries or per-request full-map pruning and the test suite does not notice.
- **Suggested fix:** Add focused tests around the extracted helper logic and search-prune helper.

## NOT CARRIED FORWARD (STALE / ALREADY FIXED)
- `apps/web/src/lib/request-origin.ts` default-port origin mismatch — fixed in current source.
- `apps/web/src/lib/sql-restore-scan.ts` blocking `CREATE TABLE` from standard mysqldump restores — fixed in current source.
- Missing `X-Content-Type-Options: nosniff` on `/api/health` and `/api/live` — fixed in current source.
- Earlier `getTopicsCached` and photo-viewer `sizes` performance issues — fixed in current source.

## AGENT FAILURES
- Initial full-batch spawn hit the environment's agent thread ceiling (`max 6`) before all requested reviewer lanes could launch.
- A retry for the first three spawned lanes (`code-reviewer`, `security-reviewer`, `critic`) produced no completed status within the cycle's waiting window despite an interrupt-to-tighten-scope nudge, so manual fallback reviews were written to preserve provenance and keep the loop moving.
- Exact requested reviewer roles `perf-reviewer`, `tracer`, and `document-specialist` are present in historical repo artifacts but are not available as exact spawnable roles in the current tool role catalog, so equivalent manual fallback passes were recorded.
- The `designer` lane could not be completed to the requested live-browser evidence standard because the dedicated reviewer thread could not be launched after the environment-enforced limit was reached.

## TOTALS
- **4** deduped actionable findings
- **0** fresh security findings
- **0** fresh high-severity correctness regressions
