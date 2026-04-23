# Verifier Review — Cycle 6, Prompt 1

**Scope:** repo-wide correctness review from the verifier specialty

**Method:** built an inventory first, inspected the behavior-bearing app/actions/lib/routes/components/tests/docs, traced cross-file interactions, and finished with a final missed-issues sweep focused on truncation, paging ceilings, sitemap coverage, and admin export surfaces.

**Verification:** `npm test -- --run src/__tests__/public-actions.test.ts` ✅

## Confirmed Issues

### [MEDIUM] Infinite scroll hard-stops after ~10k offset, so larger galleries cannot be fully browsed
- **File / region:** `apps/web/src/app/actions/public.ts:11-28`, with the UI wired from `apps/web/src/components/home-client.tsx:313-320`
- **Status:** Confirmed
- **Confidence:** High
- **Why this is a problem:** `loadMoreImages()` returns `{ images: [], hasMore: false }` once `safeOffset > 10000`. That action is the data source for the public infinite-scroll grid, and the README explicitly advertises “infinite scroll” as a feature. Past that ceiling, the gallery silently becomes incomplete.
- **Concrete failure scenario:** A library with 12,000+ images loads normally until the user has scrolled through roughly ten thousand rows. After that point, `hasMore` flips false and the oldest photos stop appearing in the public browsing flow, even though they still exist in the database.
- **Suggested fix:** Remove the silent offset ceiling and replace it with cursor/keyset pagination backed by the existing sort keys, or at minimum make the functional limit explicit in the UI/docs and choose a higher, justified cap.
- **Evidence note:** `apps/web/src/__tests__/public-actions.test.ts` covers normal paging paths but does not exercise offsets near or beyond the ceiling.

### [MEDIUM] CSV export returns an arbitrary 50k-row slice instead of a deterministic full export
- **File / region:** `apps/web/src/app/[locale]/admin/db-actions.ts:41-104`, surfaced from `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:94-119`
- **Status:** Confirmed
- **Confidence:** High
- **Why this is a problem:** The export query is capped with `.limit(50000)` but has no `orderBy()`. That means the admin “Export CSV” action can return an arbitrary subset when the gallery exceeds 50,000 rows, and repeated exports are not guaranteed to contain the same records. The UI warning only reports truncation after the fact.
- **Concrete failure scenario:** A gallery with 80,000 images produces a CSV containing only 50,000 rows. Because the query has no explicit order, the exact 50,000 included rows can vary across runs, so the CSV is not a stable inventory and cannot be used as a reliable full backup report.
- **Suggested fix:** Add an explicit deterministic ordering before the limit, and either stream/page the full export or make the truncation a deliberate product limit that is clearly surfaced before the download starts.
- **Evidence note:** I did not find a regression test covering export determinism or >50k-row behavior.

### [MEDIUM] Sitemap silently drops images beyond 24k, and there is no index/pagination path for the overflow
- **File / region:** `apps/web/src/app/sitemap.ts:14-55`, `apps/web/src/lib/data.ts:834-844`, with crawler discovery advertised from `apps/web/src/app/robots.ts:13-21`
- **Status:** Confirmed
- **Confidence:** High
- **Why this is a problem:** The sitemap hard-caps image IDs at 24,000 to keep a single file under Google’s 50,000-URL limit after locale expansion. However, there is no sitemap index or partitioning strategy for the remainder, so once the library grows past that threshold, older images disappear from `sitemap.xml` entirely.
- **Concrete failure scenario:** A gallery with 30,000 processed images exposes only the newest 24,000 images to crawlers. The remaining 6,000 never appear in the sitemap, so they lose a primary discovery path even though the app still serves them to users.
- **Suggested fix:** Emit multiple sitemap files plus a sitemap index, chunked by image ID or time window, instead of truncating the dataset inside a single route.
- **Evidence note:** There are no tests covering sitemap overflow or sitemap index generation.

## Likely Issues
- No additional likely issues were left after the final sweep.

## Risks Requiring Manual Validation
- The repo still relies on fixed ceilings in several public-facing flows. I confirmed the three user-visible cases above; I did not find another correctness bug on the final pass, but the current test suite does not yet protect the overflow behavior that would prevent regressions.

## Missed-Issues Sweep
I rechecked the remaining high-risk surfaces for silent truncation, paging limits, sitemap coverage, and admin export behavior. I did not find further confirmed correctness issues beyond the three items above.

## Recommendation
**REQUEST CHANGES**
