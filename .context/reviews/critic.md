# Cycle 31 Critic Review

Reviewer: critic
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `f1dd39eb`
Date: 2026-06-30 KST
Scope: multi-perspective critique only. No product code was edited.

## Review Frame

GalleryKit's current HEAD is not failing at the broad product premise: the app still presents as a self-hosted finished-photo gallery, and the recent cycle-30 changes improved restore coordination, map privacy testing, route guard documentation, and public search copy. The remaining risks are narrower: request ownership in search, public route guard boundaries, and public feed cost control.

Inventory and inspection covered current HEAD, not older review assumptions: 595 source/script/e2e files were inventoried, HEAD's 19 changed files were checked, and adjacent public route/action/data/test paths were inspected for cross-file behavior.

## Findings

### C31-CRIT-01 - Search mode changes can show results from the mode the user just left

Severity: Medium
Confidence: High

Exact citations:

- `apps/web/src/components/search.tsx:151-158`
- `apps/web/src/components/search.tsx:167`
- `apps/web/src/components/search.tsx:195`
- `apps/web/src/components/search.tsx:222`
- `apps/web/src/components/search.tsx:240-248`
- `apps/web/src/components/search.tsx:278-287`
- `apps/web/src/components/search.tsx:503-507`
- `apps/web/src/__tests__/search-semantic-toggle-source.test.ts:14-16`

Failure scenario:

A visitor searches, flips the semantic-search switch, and briefly sees stale results from the previous mode because the toggle resets visible state but does not invalidate the in-flight request until the next debounced search begins. This is most visible on a slow semantic request: the switch says one thing, the results are from another retrieval mode.

Critic impact:

Search is a trust surface. The new generic error copy is more honest, but a stale cross-mode result is worse than a failed search because it silently presents mismatched evidence.

Concrete fix:

Make the toggle handler invalidate request ownership synchronously by calling `clearSearchState()` or an extracted invalidation helper that increments `requestIdRef` and aborts semantic fetches. Update the toggle source-contract test so "effect owns the next search" also means "the old search is cancelled/invalidated immediately."

### C31-CRIT-02 - The public-route guard still treats exemptions as a file-level escape hatch

Severity: Medium
Confidence: High

Exact citations:

- `apps/web/scripts/check-public-route-rate-limit.ts:505-516`
- `apps/web/scripts/check-public-route-rate-limit.ts:527-536`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:197-212`

Failure scenario:

A future route combines a legitimately exempt webhook-style `POST` and a DB-backed public `GET`. The exemption comment satisfies the file, and the checker returns before evaluating the expensive GET. That means one reasonable local exception can accidentally bless an unrelated public read path.

Critic impact:

The project has many source-contract gates, but this one currently encodes the wrong granularity. The safety invariant is per public surface, not per file. File-level exceptions encourage unrelated handlers to share trust decisions.

Concrete fix:

Require handler-scoped exemptions, or fail closed when a file-level exemption coexists with any additional protected surface, including expensive GET handlers. Add the missing POST-plus-expensive-GET regression.

### C31-CRIT-03 - Feed routes are public DB surfaces but not part of the route-guard inventory

Severity: Medium
Confidence: Medium

Exact citations:

- `apps/web/src/app/feed.xml/route.ts:29-40`
- `apps/web/src/app/feed.xml/route.ts:144-153`
- `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:50-64`
- `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:146-155`
- `apps/web/scripts/check-public-route-rate-limit.ts:25`
- `apps/web/scripts/check-public-route-rate-limit.ts:557`
- `CLAUDE.md:619-623`

Failure scenario:

Feed readers poll root and topic feeds with `If-Modified-Since`. The app still does settings/config/topic/image work before deciding the feed is not modified. Since the lint gate only walks `src/app/api`, these route handlers are not forced to be rate-limited or explicitly exempted.

Critic impact:

Feeds are meant to be boring and cheap. Current behavior makes them quiet public DB endpoints whose cost profile is hidden from the main public-route guard. That is a maintainability problem even if CDN caching hides most live traffic.

Concrete fix:

Inventory all public route handlers with expensive work, not only `/api`. For feeds specifically, add a cheap freshness path before full entry composition or document and test an intentional exemption.

## Positive Evidence

- Restore maintenance now resumes the image queue after a partial prepare failure when the queue was already quiesced.
- Map GPS publication has both SQL and runtime privacy fences.
- Current public API route lint passes.
- Targeted source-contract tests for reviewed areas pass: 4 files, 69 tests.
- No product-code edits were made in this review lane.

## Final Missed-Issue Sweep

I rechecked the cycle-30 changed files, public route scanner behavior, search request ownership, restore flow, map privacy path, feed route handlers, and current source-contract tests. I did not find additional confirmed findings in the reviewed slice. Remaining residual risk: this was a static/source review with targeted tests, not a full browser or production-log investigation.
