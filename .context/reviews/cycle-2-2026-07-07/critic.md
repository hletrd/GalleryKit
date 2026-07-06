# Multi-Perspective Critic Review — 2026-07-07

Reviewer: critic (correctness, product coherence, operator risk, attacker surface, future
maintainer, reviewer-of-reviews). Repo `/Users/hletrd/flash-shared/gallery`, main app `apps/web`.
HEAD reviewed: `642c5091` (== `origin/master`, clean tree except untracked review dirs).
Mode: read-only, static. No source modified. Findings validated from code, not from CLAUDE.md/comments.

## Method / where I deliberately looked

The run-10 cycle-1 aggregate (`cycle-1-2026-07-06/_aggregate.md`, findings C1-01..C1-36) was
essentially all CLOSED by the commit run `7e401f3d`..`642c5091` (rate-limit fast path, restore
mutation-barrier + dump-completeness, claim-exhaustion, topic temp-file age gate, lean count,
a11y, route gaps, import-cycle extract, drizzle-kit repin, nginx XFF doc). Those fixes are the
freshest, least-reviewed code in the repo, so I audited **the fixes themselves** and then swept
surfaces the 100-cycle history under-covers (sitemap, map, feed, page-vs-route rate-limit
boundary). I deliberately did NOT re-file known/deferred items (embeddings single-version PK,
COUNT-OVER already fixed, the general test-ossification claim — see CRIT-05 for the fresh instance).

## Findings

| ID | Severity | Confidence | File:line | Title |
|----|----------|-----------|-----------|-------|
| CRIT-01 | Medium | High | `apps/web/nginx/default.conf:201`; all `(public)/**/page.tsx` | Public SSR pages have zero rate limiting at any layer; the `revalidate=0` DB surface is unthrottled |
| CRIT-02 | Low | High | `apps/web/src/app/sitemap.ts:44-49,90-112` | Sitemap URL budget omits the feed + per-topic-feed rows, so at scale the file exceeds Google's 50,000-URL cap |
| CRIT-03 | Medium (process) | High | `apps/web/scripts/check-public-route-rate-limit.ts` | Rate-limit lint gate cannot see `page.tsx`, so protection accretes on cheap API routes while the costly SSR surface (CRIT-01) stays invisible to the loop |
| CRIT-04 | Low | High | `apps/web/src/app/[locale]/admin/db-actions.ts:530-597`; `admin-mutation-barrier.ts` | Restore drains foreground mutations by holding the slot through post-DB file cleanup — a slow bulk-delete on NAS makes restore abort after 30s with no corruption risk left |
| CRIT-05 | Low | High | commit `642c5091`; `apps/web/src/app/api/health/route.ts:8,37` | Scanner-ossification made concrete: a production comment was reworded (`orchestrator's`->`orchestrator`) to dodge a regex-scanner bug |

---

### CRIT-01 — Public SSR pages have no rate limiting at any layer; the loop hardened the cheap API surface and left the expensive page surface open
- Severity: Medium. Confidence: High. Perspective: operator / attacker. Classification: DoS surface / false-sense-of-coverage.
- Evidence:
  - `apps/web/nginx/default.conf`: `limit_req_zone` defines only `login` (10 r/m) and `admin` (30 r/m). Every `limit_req` directive sits inside an `admin`/login `location`. The catch-all `location / { proxy_pass http://nextjs; }` (`:201`) has **no** `limit_req`.
  - `apps/web/src/proxy.ts` (Next middleware) does i18n routing + admin-cookie auth only — `grep -n 'rate|limit|preIncrement|429'` returns a single unrelated comment. No page-level limiter.
  - The app-layer limiters (`@/lib/rate-limit`, `auth-rate-limit`) and the `check-public-route-rate-limit` gate cover **API routes and server actions** only. Public *pages* — `/`, `/[topic]`, `/p/[id]`, `/map`, `/timeline`, `/year/[year]`, `/c/[slug]` — are RSCs (not routes/actions), each `revalidate = 0` (live DB per hit, per CLAUDE.md "Public route freshness").
  - Each hit fires multiple live queries: homepage runs `getImagesLitePage` + parallel `getImageCount` + `getTopics` + `getSeoSettings`; `/map` runs `getMapImages` (up to `MAP_MAX_MARKERS = 10000` rows, `data.ts:1714`) shipping a ~MB payload.
- Why it matters: The single MySQL writer (10-conn pool) is the documented bottleneck, and C1-07 was scheduled precisely because crawler/burst load on these dynamic pages is a real cost. C1-07 only made each query *cheaper* — it did not throttle requests. A single IP can sweep home + every topic + every photo id + `/map` + `/timeline` in a tight loop with **no 429 anywhere**, pinning pool connections behind SSR latency during the very burst the rate-limit machinery is meant to blunt. The per-IP limiter suite + the lint gate create a reasonable-but-false impression that "public surfaces are rate-limited"; the biggest surface is the exception.
- Failure scenario: A scraper (or an actor who read this CLAUDE.md, which advertises `revalidate = 0` on all gallery pages) hammers `/map` and `/` from one IP; each `/map` hit runs the 10k-row GPS query; interactive admin/API requests queue behind pool holds. No app or nginx layer sheds it; only an operator-supplied CDN/WAF would.
- Suggested fix: (a) add a coarse `limit_req zone=public` to nginx `location /` in the shipped config (burst-tolerant so real users are unaffected, single-IP flood capped), or (b) rate-limit public GET pages at the Next middleware, or at minimum (c) document in CLAUDE.md's Security section that SSR pages are intentionally **unthrottled at the app layer** and need an operator CDN/WAF — so the gap is a stated boundary, not implied-covered. This is the honest counterpart to C1-01/C1-07.
- Caveat: partly an operator-boundary decision for a personal gallery. The finding is the *mismatch* between advertised protection and the unprotected largest surface, not a demand that a personal gallery ship a WAF.

### CRIT-02 — Sitemap URL budget reserves for homepage + topics but not for the feed / per-topic-feed rows, so a large gallery emits a sitemap over Google's 50,000-URL limit
- Severity: Low. Confidence: High. Perspective: end-user (SEO) / maintainer. Classification: off-by-budget / spec-contract drift.
- Evidence (`apps/web/src/app/sitemap.ts`):
  - `MAX_SITEMAP_URLS = 50000` (`:22`), `LOCALES.length = 2` (`constants.ts:2`).
  - `reservedLocalizedUrls = LOCALES.length * (1 + topics.length)` (`:44`) reserves only homepage (`2`) + topic pages (`2*T`). `imageBudget = floor((50000 - reserved) / 2)` (`:45-48`); `getImageIdsForSitemap(imageBudget)` returns up to `imageBudget` images (`data.ts:1692`, `.limit(safeLimit)` fills it), each emitting `2` URLs.
  - The final array (`:114-120`) THEN appends `feedEntry` (**1** URL, `:90`) and `topicFeedEntries` (**2*T** URLs, `:103`), never subtracted from the budget.
  - When images fill the budget: `total ~= 50000 + 1 + 2*T`. With ~50 topics that is ~101 URLs over the 50,000 cap.
- Why it matters: A single `sitemap.ts` returning `> 50000` entries is one oversized file (Next does not auto-split without `generateSitemaps`). Google processes the first 50,000 and reports the remainder as an error in Search Console; the lowest-priority (oldest) image URLs at the tail silently fall off the index. The code's own comment ("Google recommends max 50,000 URLs per sitemap file") states the exact contract it violates at scale.
- Failure scenario: A prolific gallery crosses ~25k processed images with a few dozen topics; the sitemap quietly ships ~50,100 URLs; Search Console flags "URLs exceed limit"; tail images stop getting crawled.
- Suggested fix: Fold the feed rows into the reservation: `reservedLocalizedUrls = LOCALES.length * (1 + topics.length + topics.length) + 1` (homepage + topic page + topic feed per locale, plus the single root feed), or clamp the final array to `MAX_SITEMAP_URLS`. Cheap, deterministic.

### CRIT-03 — The rate-limit lint gate is blind to `page.tsx`, which is exactly why protection keeps landing on cheap routes and never on the expensive SSR pages (reviewer-of-reviews)
- Severity: Medium (process). Confidence: High. Classification: guardrail shape drives where fixes go.
- Evidence:
  - `check-public-route-rate-limit.ts` scans `apps/web/src/app/api/**` route files (and public `route.*` handlers). It does not — and by design cannot easily — scan RSC `page.tsx` modules, which export no HTTP method to hook.
  - Ledger consequence: cycle-97 (`6f40f66d`) ADDED `preIncrementFeedAttempt` to both `feed.xml` routes and REMOVED their `@public-no-rate-limit-required` exemption — the loop diligently rate-limited an Atom feed already capped at `FEED_LIMIT = 50` and CDN-cacheable (`s-maxage=1800`), the *cheapest* public read. The uncacheable, multi-query, up-to-10k-row SSR pages (CRIT-01) were never touched, because the gate never points at them.
- Why it matters: This is the mechanism behind CRIT-01. A source-shaped gate does not just add edit friction (last cycle's ARCH-04/CRIT-04) — it *steers the loop's attention* to the files it can parse. After ~100 cycles the API-route surface is exhaustively limited and the page surface has zero — not because pages are cheaper (they are far more expensive) but because they are invisible to the tool that defines "done." "All public routes rate-limited" is being read as "public surface protected."
- Suggested fix: Extend the gate's scope to public `page.tsx` under `(public)/` — flag any `revalidate = 0` page whose module reaches a DB / `getMapImages` / `getImages*` helper and require an explicit `@public-page-no-rate-limit: <reason>` acknowledgement, mirroring the route exemption. At minimum, schedule CRIT-01 so the ledger stops implying pages are covered.

### CRIT-04 — Restore's foreground-mutation drain is conservative to the point of aborting restores that carry no corruption risk
- Severity: Low. Confidence: High (barrier logic is otherwise correct). Perspective: operator. Classification: availability tradeoff / over-broad fence.
- Evidence: `acquireAdminMutationSlot()` (`admin-mutation-barrier.ts:76`) is held for the WHOLE action body via `using`. In `deleteImages` (`images.ts:772`) the slot spans the DB transaction AND the post-commit on-disk derivative cleanup (`IMAGE_CLEANUP_CONCURRENCY`, up to thousands of files, latency-bound on NAS). `drainAdminMutationsForRestore()` (`db-actions.ts:544`) waits `ADMIN_MUTATION_DRAIN_TIMEOUT_MS = 30_000` for `inFlight` to hit 0, then the restore ABORTS (`:545-548`).
- Why it matters: The corruption hazard the barrier prevents ends the instant the delete's DB transaction commits — everything after is pure filesystem I/O on files the restore does not touch (restore is SQL-only; CLAUDE.md is explicit it does not roll back `public/uploads`). But the slot stays held through that I/O, so a large delete on slow storage forces a spurious 30-second restore abort. On a busy admin this reads as a flaky restore (`restoreFailed`) with no correctness reason. Safe (abort > corrupt, as designed) but an availability papercut.
- Suggested fix: Dispose the mutation slot at the DB-commit boundary for the delete paths (release explicitly once the transaction resolves, before the file-cleanup loop) rather than at function scope. Keeps the fence tight to the actual hazard.
- Validated SAFE (so the next reviewer need not re-derive): the barrier's release discipline is otherwise correct — `drainAdminMutationsForRestore` sets `exclusiveActive` only on paths that reach the inner `try` whose `finally` (`db-actions.ts:563`) unconditionally calls `releaseAdminMutationExclusive()`; the earlier lock/maintenance early-returns never call drain, so no path sets the exclusive flag without clearing it (no process-wide mutation-wedge). Restore's contract-lock-first ordering (timeout-0 `acquireUploadProcessingContractLock` at `:442`) also means an in-flight *upload* fails the restore fast rather than causing a 30s drain-abort.

### CRIT-05 — Fresh, dated instance of scanner ossification: a production comment was reworded to satisfy a regex, not a reader
- Severity: Low. Confidence: High. Classification: test/scanner-architecture tax (reinforces last cycle's ARCH-04 / CRIT-04 with a concrete new datapoint).
- Evidence: commit `642c5091` ("stop scanner string-stripping from crossing newlines") fixed a real bug in `check-public-route-rate-limit.ts` (single/double-quote strip regexes now stop at `\n`), AND in the same commit changed `api/health/route.ts` comments `orchestrator's` -> `orchestrator` (`:8`, `:37`) so an apostrophe inside a comment could not pair with a later string quote and mis-scan the file. It also shuffled a helper in `image-queue.ts` purely to appease import-order.
- Why it matters: The ossification thesis made literal — the codebase now edits English prose in production files to keep a source-text regex happy. Each accommodation is invisible debt: a future comment with an apostrophe re-triggers the class, and the reflex is another prose edit rather than trusting a parser. It confirms the loop is spending real commits on the scanner's fragility.
- Suggested fix: The scanner already has AST access (`bodyContainsExpensiveGetWork`) — tokenize string literals rather than regex-stripping them; then comments are never confused with strings and no production prose bends around it. Same direction as last cycle's ARCH-04.

---

## Validated SAFE (so the next reviewer does not re-derive)

- **C1-07 lean-count fix (`data.ts:885-920`, `1482-1513`) is correct.** `getImageCount` and `getImagesLitePage` both build the tag filter via the shared `buildTagFilterCondition` (`data.ts:619`) — an `IN(subquery)` with `HAVING COUNT(DISTINCT tags.slug) = validTagSlugs.length` (AND semantics). The page query filters via that same subquery in the WHERE (the LEFT JOIN is only for `tag_names` aggregation), and `GROUP BY images.id` collapses to distinct images, so the parallel `count(*)` equals the retired `COUNT(*) OVER()` group count. Only residual: the two run as separate queries (not one snapshot), so the header total can lag the page by a row under concurrent writes — a harmless display race on header copy.
- **C1-02 dump-completeness (`db-restore.ts`, `db-actions.ts`) is sound** — one latent operator trap: the completeness gate fires only when the header matches `-- MySQL dump` / `-- MariaDB dump`. A `mysqldump --compact` dump (no header, no trailer) bypasses it as "operator SQL." Acceptable, but worth a one-line doc note that `--compact` dumps get no truncation protection.
- **Map privacy (`getMapImages`, `data.ts:1714-1731`)** is well-guarded: `INNER JOIN topics ON map_visible = true` + runtime `topic_map_visible` assertion + `MAP_MAX_MARKERS = 10000` cap + deterministic ORDER BY. No GPS leak, bounded payload.
- **i18n parity for the new error keys** (`truncatedSqlDump`, `disallowedSql`, `invalidSqlDump`, `restoreInProgress`, `restoreFailed`) — present in BOTH `en.json` and `ko.json`.
- **Masonry quantize (`home-client.tsx`, `7a2e3f92`)** uses the correct React bail-out idiom (`setViewportWidth(prev => prev === q ? prev : q)`); column count still derives from raw width, so breakpoints are unchanged.

## Files / areas examined
- Recent fixes: `lib/admin-mutation-barrier.ts`, `lib/db-restore.ts`, `app/[locale]/admin/db-actions.ts` (full), `app/actions/{images,tags,settings}.ts` (barrier wiring), `lib/data.ts` (`getImageCount`, `getImagesLitePage`, `getImagesForSmartCollection`, `buildTagFilterCondition`, `getImageIdsForSitemap`, `getMapImages`), `components/home-client.tsx`, `api/health/route.ts`, `scripts/check-public-route-rate-limit.ts`.
- Under-reviewed surfaces: `app/sitemap.ts`, `app/[locale]/(public)/map/page.tsx`, `app/[locale]/(public)/[topic]/feed.xml/route.ts` + `app/feed.xml/route.ts`, `nginx/default.conf`, `proxy.ts`.
- Process: `.context/reviews/_aggregate.md`, `cycle-1-2026-07-06/{_aggregate,critic,architect,code-reviewer}.md`, `git log --stat -20`, i18n key checks.
- Deliberately skipped (owned/known): Dockerfile workspace-nested `node_modules` build failure (excluded by task); color/HDR encoder matrix + migration-drift runbook (stable, exhaustively covered); `image_embeddings` single-version PK (deferred C94-10); general source-shape test brittleness (last cycle CRIT-04/ARCH-04 — CRIT-05 here is only the fresh concrete instance).

## Caveats
- Static review only: no build/lint/typecheck/test/e2e run; no live DB. CRIT-02's overflow is arithmetic-certain but only reachable at ~25k images; CRIT-01's severity depends on deployment (CDN/WAF presence) the repo cannot observe. CRIT-04 is a safe-by-design tradeoff, filed as an availability papercut, not a correctness bug.
