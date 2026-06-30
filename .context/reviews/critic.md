# Cycle 29 Critic Review

Reviewer: critic subagent
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `b4fa1f64`
Date: 2026-06-30
Mode: Prompt 1 review only; no product-code edits.

## Process and Inventory

I read `AGENTS.md` and `CLAUDE.md` first, then inventoried review-relevant repository surface with `rg --files`, `git ls-files`, targeted `find`, and line-numbered reads. The active non-generated inventory was 812 files after excluding build/vendor output; `apps/web/src` contains 524 source/test files; tracked review history contains 1678 files and tracked plan history contains 101 files.

Covered categories: project instructions (`AGENTS.md`, `CLAUDE.md`), root/app READMEs, package and lock files, Next.js/proxy/CSP config, Docker/compose/nginx/deploy scripts, public/admin routes, server actions, auth/origin/rate-limit helpers, data/privacy selectors, search/CLIP paths, upload/image/storage/queue paths, scripts/backfills, DB schema/migrations/journal, tests/e2e/lint scripts, `.context` review/plan history, and `.omc` history.

Validation commands run during review:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run typecheck --workspace=apps/web` passed.
- `npm run lint --workspace=apps/web` passed.

## Confirmed Issues

### C29-CRIT-01 - `.context/plans/` is documented as committed history but is still ignored

Severity: Medium
Confidence: High
Perspectives: operations, maintainability, process reliability

Evidence:

- `AGENTS.md:40-42` says `.context/reviews/` and `.context/plans/` are committed review/plan history.
- `.gitignore:19-21` ignores `.context/*` and only unignores `.context/reviews/` plus `.context/reviews/**`.
- `git check-ignore -v .context/plans/new-cycle-plan.md` reports `.gitignore:19:.context/*`, while `git check-ignore -v .context/reviews/new-review.md` reports the review unignore at `.gitignore:21`.

Concrete failure scenario: a future review-plan-fix cycle writes a new plan or deferred decision under `.context/plans/`, the local workflow appears successful, but the plan stays untracked by default. A later agent or human reviewing committed history sees an incomplete audit trail and may repeat already-rejected work or miss a deferred risk.

Suggested fix: unignore `.context/plans/` and `.context/plans/**` the same way `.context/reviews/` is unignored. Add a small hygiene check that fails when expected review/plan artifacts are ignored.

### C29-CRIT-02 - Runtime and transient artifacts remain tracked despite ignore policy

Severity: Low, rising to Medium if logs ever include environment or host-sensitive output
Confidence: High
Perspectives: operations, privacy, maintainability

Evidence:

- `.gitignore:16` ignores `.omc`, but `git ls-files .omc` shows tracked `.omc/plans/plan-cycle12-fixes.md`.
- `.gitignore:22-29` re-ignore transient logs and scratch files under `.context/reviews/`, yet `git ls-files .context/reviews | rg '\.(log|pid)$'` shows tracked examples such as `.context/reviews/archive/dev-server.log`, `.context/reviews/logs-cycle2-current/critic.pid`, `.context/reviews/logs-cycle2-current/debugger.log`, and `.context/reviews/logs-cycle4/architect.log`.
- `.omc/plans/plan-cycle12-fixes.md:1-63` is a completed historical OMX plan under an otherwise ignored runtime directory.
- `git ls-files .context/reviews | rg '\.(png|log|pid|json)$' | wc -l` reports 118 tracked review-side artifact files.

Concrete failure scenario: stale PID/log files are treated as current runtime evidence during a later review, or logs accidentally capture host paths, environment-dependent output, or service details and remain in the permanent repository. The repository also grows with screenshots and logs that do not carry durable review value.

Suggested fix: decide which historical screenshots or JSON artifacts are intentionally durable, then `git rm --cached` transient `.log`, `.pid`, scratch, and runtime `.omc` files. Add a CI or local hygiene script that checks `git ls-files` for forbidden runtime extensions/paths while allowing explicitly documented archival artifacts.

### C29-CRIT-03 - App README still tells operators to upload before making the GPS retention decision

Severity: Medium
Confidence: High
Perspectives: privacy, product, operations

Evidence:

- `README.md:118` now correctly tells operators to review Settings before first upload, especially GPS stripping and output sizes.
- `apps/web/README.md:7-24` still says that after the dev server starts, the operator should create a category, upload one photo, and confirm the public homepage renders it.
- `apps/web/src/lib/gallery-config-shared.ts:92-98` defaults `strip_gps_on_upload` to `'false'`.
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:661-680` disables the GPS strip switch when images already exist and shows the upload contract as locked.
- `apps/web/src/components/upload-dropzone.tsx:77` and `apps/web/src/components/upload-dropzone.tsx:386-390` show a warning only at upload time when GPS stripping is off and no images exist.
- `apps/web/messages/en.json:172` warns that originals will retain location metadata if first uploads contain GPS.

Concrete failure scenario: an operator starts from `apps/web/README.md`, uploads a geotagged first test photo, and only then reviews Settings. Because the setting is locked once images exist, the original file may retain GPS metadata until the operator deletes/reprocesses/reuploads or does manual host cleanup.

Suggested fix: mirror the root README wording in `apps/web/README.md`: review Settings before first real upload, especially GPS stripping and output sizes. A stronger product fix would make the first-run privacy decision explicit before the upload UI accepts files, or default GPS stripping on unless deliberately disabled.

### C29-CRIT-04 - Public map still renders up to 10,000 markers and a 10,000-item fallback list in one request

Severity: Medium
Confidence: High
Perspectives: product, reliability, frontend performance

Evidence:

- `apps/web/src/lib/data.ts:1649-1658` documents `MAP_MAX_MARKERS = 10000` and says larger galleries need viewport filtering or clustering.
- `apps/web/src/lib/data.ts:1667-1685` returns all opted-in GPS rows up to that cap for the public map.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:37-56` awaits `getMapImages()` and serializes all returned rows into client markers.
- `apps/web/src/app/[locale]/(public)/map/page.tsx:83-95` renders a fallback list item for every marker.
- `apps/web/src/components/map/map-client.tsx:86-90` computes bounds by mapping every latitude/longitude and spreading the arrays into `Math.min`/`Math.max`.
- `apps/web/src/components/map/map-client.tsx:119-140` renders one Leaflet `<Marker>` per marker.

Concrete failure scenario: a topic with several thousand map-visible GPS photos makes `/map` ship a large payload, allocate full lat/lng arrays, mount thousands of Leaflet markers, and render thousands of fallback links. On a mobile browser or low-memory device this can freeze the page or trigger tab reloads, even though the SQL query itself is capped.

Suggested fix: lower the initial public cap and add progressive loading: clustering/canvas markers, server-side viewport bounding-box queries, or paginated/virtualized fallback list rendering. Keep the current privacy join, but avoid sending the whole marker set on first paint.

### C29-CRIT-05 - Semantic and similar search perform synchronous vector scoring on the request thread

Severity: Medium
Confidence: High
Perspectives: reliability, performance, operations

Evidence:

- `apps/web/src/lib/clip-embeddings.ts:36-44` allows `SEMANTIC_SCAN_LIMIT` to rise as high as 25,000 vectors.
- `apps/web/src/app/api/search/semantic/route.ts:270-279` selects up to `SEMANTIC_SCAN_LIMIT` embeddings for a public semantic request.
- `apps/web/src/app/api/search/semantic/route.ts:292-311` decodes and scores every scanned embedding synchronously, then runs `topK`.
- `apps/web/src/app/api/search/similar/[id]/route.ts:168-177` selects up to the same scan limit for similar-search.
- `apps/web/src/app/api/search/similar/[id]/route.ts:186-201` synchronously filters, decodes, scores, and ranks the rows.

Concrete failure scenario: an operator increases `SEMANTIC_SCAN_LIMIT` to improve recall on a large gallery. Several concurrent semantic or similar requests then spend long CPU spans decoding/scoring vectors on the Node event loop. Even with per-IP rate limits and model-inference queueing, unrelated SSR, admin actions, upload polling, and queue timers can be delayed.

Suggested fix: bound request-thread CPU with smaller hard caps, chunked scoring that yields between batches, a worker-thread/vector-index path, or a global concurrency gate around vector scoring. Treat ANN/vector index adoption as a separate larger improvement, but add an event-loop-friendly cap first.

### C29-CRIT-06 - Rate-limit bucket cleanup deletes by an unindexed suffix column in one statement

Severity: Medium
Confidence: High
Perspectives: reliability, operations, database maintainability

Evidence:

- `apps/web/src/db/schema.ts:212-219` defines `rate_limit_buckets` with primary key `(ip, bucketType, bucketStart)` and no `bucketStart`-leading index.
- `apps/web/src/lib/rate-limit.ts:515-517` purges old buckets with one `DELETE ... WHERE bucket_start < cutoff` statement.

Concrete failure scenario: public traffic creates many distinct `(ip, bucketType, bucketStart)` rows. The hourly or periodic purge cannot use the primary key efficiently for `bucket_start < cutoff` because `bucketStart` is the third column, so cleanup can scan and lock a growing table. During the purge, public rate-limit checks may see avoidable DB latency.

Suggested fix: add a migration for a `bucket_start`-leading index, likely `(bucket_start, bucket_type)` or at minimum `(bucket_start)`, and consider chunked deletes for large existing tables. Add a regression check that the schema contains a cleanup-supporting index.

## Likely Issues

No likely issue was promoted without enough repository evidence. Items that initially looked suspicious were either confirmed above or rejected in the clean-check section below.

## Risks Needing Manual Validation

### C29-CRIT-07 - Public GET rate-limit coverage depends on manual diligence

Severity: Medium
Confidence: High that the guardrail gap exists; current expensive GET routes have direct tests
Perspectives: reliability, security, maintainability

Evidence:

- `apps/web/scripts/check-public-route-rate-limit.ts:1-11` explicitly scans only public mutating handlers and says GET handlers are not scanned.
- `apps/web/scripts/check-public-route-rate-limit.ts:344-346` marks files with no mutating handlers as passing.
- The gate output during this review passed and reported expensive GET-only routes such as OG and similar-search routes as "no mutating handlers".
- Current coverage exists for known expensive GET routes: `apps/web/src/__tests__/og-route-rate-limit-behavior.test.ts:47-74` verifies OG GET rate limits before expensive work, and `apps/web/src/__tests__/similar-route.test.ts:236-244` verifies similar-search 429 behavior.

Concrete failure scenario: a future public GET route that imports `ImageResponse`, `sharp`, DB-heavy search, or file generation can pass `lint:public-route-rate-limit` without calling a pre-increment helper or carrying a conscious exemption. Existing route-specific tests do not protect future files.

Suggested fix: extend the lint gate with a GET audit for public routes that use expensive markers such as `ImageResponse`, image libraries, DB queries, semantic helpers, or filesystem access. Require either a rate-limit helper or an explicit `@public-no-rate-limit-required` rationale for those GET files.

### Manual validation - operational restore and production secrets

Severity: Low
Confidence: Medium
Perspectives: operations, privacy

Evidence:

- The review covered source and committed config, but intentionally did not inspect gitignored production files such as `.env.deploy`, `.env.local`, live upload data, or remote database state.
- Restore and deploy safety depends partly on host grants, SSH config, MySQL permissions, Docker disk state, and gitignored environment values that are outside current HEAD.

Concrete failure scenario: committed restore/deploy code is correct, but production grants or env values drift and cause restore downtime, leaked backups, or failed deploy cleanup.

Suggested fix: keep this as an operator-runbook validation item: periodically run restore drills and deploy dry-run checks against a non-production clone using the gitignored environment shape, not committed sample files.

## Checked Clean / Not Re-filed

- Admin API auth wrapper gate passed.
- Mutating server-action origin gate passed.
- Public mutating route rate-limit gate passed.
- Typecheck and ESLint passed.
- The prior critic concern that original uploads might be publicly routable is not re-filed. Current storage code routes `original/*` to the private original upload directory and denies public URLs for originals.
- The migration journal has historical non-monotonic timing that the project docs already call out through the migrator post-condition behavior; I did not find a new migration skip bug in this pass.
- A suspected CSP/image-base mismatch was rejected after inspection: the CSP builder defaults to `process.env.IMAGE_BASE_URL` when no argument is supplied.
- The public map topic toggle label is now explicit enough to avoid re-filing the old under-disclosure issue: `apps/web/messages/en.json` names "Publish GPS on public map" and has an aria label for public GPS map visibility.

## Final Missed-Issues Sweep

Final sweep covered:

- Instructions and knowledge base: `AGENTS.md`, `CLAUDE.md`, root/app READMEs.
- App source: public pages, admin pages, route handlers, server actions, UI components, lib helpers, upload/image/storage/search/queue modules.
- Security and privacy surfaces: auth wrappers, origin checks, rate limiting, CSP, image URL handling, public data selectors, GPS exposure paths, privacy-sensitive omit lists.
- Reliability/operations surfaces: Dockerfile, compose, nginx, deploy helper, migration scripts, DB schema, backup/restore actions, queue scripts, backfills.
- Test and tooling surfaces: Vitest tests, Playwright e2e directory, lint/typecheck scripts, custom static-analysis scripts.
- Repository history/process: `.context/reviews`, `.context/plans`, `.omc`, ignore rules, tracked transient artifacts.

Excluded from source review: `node_modules`, build output, gitignored secrets, live production upload data, live databases, and remote host state.

Stop condition: the review found and documented confirmed issues plus manually validated risks with exact file regions and current validation evidence. No product implementation or planning was performed.
