# Cycle 31 Code Reviewer Review

Reviewer: code-reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `f1dd39eb`
Date: 2026-06-30 KST
Scope: review only. No product code was edited.

## Inventory Summary

I built the inventory from current HEAD before reviewing implementation details.

- Current branch: `master...origin/master`, clean before review edits.
- Current HEAD: `f1dd39eb fix(cycle-30): harden restore and public route guards`.
- HEAD changed 19 files, centered on restore locking, public search copy, map query tests, and the public API route rate-limit checker.
- Source inventory inspected with `rg --files`: 595 files across `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, and `apps/web/e2e`.
- Primary review surfaces: `AGENTS.md`, `CLAUDE.md`, cycle-30 plan/deferred register, changed HEAD files, public route handlers, public server actions, map privacy path, restore flow, search UI/request ownership, feed route handlers, and related tests.

Files inspected in detail:

- `apps/web/scripts/check-public-route-rate-limit.ts`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`
- `apps/web/src/components/search.tsx`
- `apps/web/src/__tests__/search-stale-response.test.ts`
- `apps/web/src/__tests__/search-semantic-toggle-source.test.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/feed.xml/route.ts`
- `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
- `apps/web/src/app/api/search/semantic/route.ts`
- `apps/web/src/app/api/search/similar/[id]/route.ts`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/__tests__/restore-upload-lock.test.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/app/[locale]/(public)/map/page.tsx`
- `apps/web/src/components/map/map-client.tsx`
- `apps/web/src/__tests__/map-get-images-behavior.test.ts`

## Findings

### C31-CODE-01 - Search mode toggle can commit stale results during the debounce gap

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

Issue:

`clearSearchState()` is the only helper that synchronously increments `requestIdRef` and aborts an in-flight semantic request. The semantic toggle handler only calls `setUseSemanticSearch(checked)`, clears visible results/status, and waits for the `useEffect` debounce to start the next search 300 ms later. During that window, the previous in-flight keyword or semantic request still owns the current `requestIdRef` value, so its response can pass the existing stale-response checks and repopulate results from the mode the user just left.

Failure scenario:

A visitor has a semantic request in flight, toggles semantic search off, and the old semantic response returns before the debounced keyword search starts. Because the toggle did not invalidate `requestIdRef` or abort the fetch, the semantic branch can execute `setResults(semanticResults)` even though the UI now shows keyword mode. The reverse keyword-to-semantic transition has the same request-id gap for server-action results.

Concrete fix:

Invalidate ownership synchronously in `onCheckedChange`: call `clearSearchState()` before or immediately after `setUseSemanticSearch(checked)`, or extract a lighter `invalidateSearchRequests()` that increments `requestIdRef` and aborts `semanticAbortRef` without changing query text. Add a source-contract test that the semantic toggle handler invalidates request ownership, not just that it avoids directly calling `performSearch()`.

### C31-CODE-02 - A file-level public-route exemption can hide an expensive GET in the same route file

Severity: Medium
Confidence: High

Exact citations:

- `apps/web/scripts/check-public-route-rate-limit.ts:505-516`
- `apps/web/scripts/check-public-route-rate-limit.ts:527-536`
- `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:197-212`

Issue:

The checker handles a reasoned `@public-no-rate-limit-required` as file-level. It only rejects ambiguity when there is more than one mutating handler, then returns immediately whenever `mutatingHandlers.length > 0 && hasExemption`. That return bypasses the expensive-GET check entirely. The existing ambiguous-exemption test covers `POST` plus `DELETE`, but it does not cover `POST` plus an expensive `GET`.

Failure scenario:

A future public route file adds a signature-gated `POST` with a valid exemption comment and also exports a DB-backed `GET` in the same file. The checker reports the file as OK because of the POST exemption, while the expensive GET remains unmetered. I validated this with `checkPublicRouteSource()` using a minimal route containing one exempt `POST` and one `GET` that calls `db.select()`: the report passed with no failures.

Concrete fix:

Treat exemptions as handler-scoped or fail closed whenever a file-level exemption coexists with more than one protected surface, counting both mutating handlers and expensive GET handlers. Do not return before evaluating `expensiveGetHandlers`. Add a regression fixture for `POST` with exemption plus unmetered expensive `GET`.

### C31-CODE-03 - Atom feeds do full public DB work before 304 handling and are outside the public-route rate-limit gate

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

Issue:

Both Atom feed route handlers execute SEO/config/topic/image queries before checking `If-Modified-Since` and returning 304. The public-route lint gate only discovers files under `src/app/api`, so these route handlers are not forced to rate-limit or carry an explicit exemption even though they perform public DB work on every request. Cache headers help downstream caches, but a direct client or cache miss still pays the full query/compose cost even for a not-modified poll.

Failure scenario:

An RSS crawler, misconfigured monitor, or simple script repeatedly requests `/feed.xml` or `/{locale}/{topic}/feed.xml` with a valid `If-Modified-Since`. The app still resolves settings/config and fetches up to 50 feed rows before returning 304. Topic feeds also resolve the topic before the conditional check. Under abuse or many subscribed topics, this becomes an unmetered public DB path that the current lint gate never inventories.

Concrete fix:

Either extend the public-route scanner to include dotted route handlers under `src/app/**/route.ts(x)` that perform DB/image/filesystem work, or add explicit source-contract coverage and documented exemptions for feed routes. For runtime behavior, split feed freshness into a cheap indexed freshness query before composing entries, then return 304 before fetching full rows when possible; otherwise add a small per-IP feed limiter or CDN-only operational exemption with clear reasoning.

## No-Finding Areas

- Restore coordination: current HEAD sets `imageQueueQuiesced = true` immediately after `quiesceImageProcessingQueueForRestore()` and before `drainBackgroundDbWritesForRestore()`, then resumes when maintenance exits. This addresses the cycle-30 queue resume gap.
- Map privacy: `getMapImages()` uses an inner join on `topics.map_visible = true`, requires non-null GPS fields, applies a deterministic 10k cap, and asserts `topic_map_visible` before returning rows.
- Search generic copy: the current messages now describe temporary unavailability rather than blaming user input. I did not find a copy regression in the changed locale keys.
- Public API route rate-limit gate: the configured lint command is green for current `src/app/api/**` route files.

## Verification Evidence

- `npm run lint:public-route-rate-limit --workspace=apps/web`: passed.
- `npm test --workspace=apps/web -- search-stale-response search-semantic-toggle-source check-public-route-rate-limit feed-sized-derivative`: 4 files passed, 69 tests passed.
- Minimal `checkPublicRouteSource()` repro confirmed C31-CODE-02.
- Final missed-issue sweep covered changed HEAD files, adjacent route/action/data paths, source-contract tests, public API routes, feed handlers, restore locking, map privacy, and search request ownership.

## Recommendation

Request changes for C31-CODE-01 before more search UI work, because it is a user-visible stale-state bug. C31-CODE-02 should be fixed with the route-gate hardening work because it weakens a security/performance invariant. C31-CODE-03 can be handled as a bounded public-surface hardening task unless production logs show feed traffic is already hot.
