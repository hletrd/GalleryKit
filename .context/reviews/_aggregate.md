# Cycle 16 Aggregate Review

Date: 2026-06-30 KST
Cycle: 16/100
Reviewed HEAD range during review fan-out: `3da74946` -> review-artifact commits through `40dd664a`

## Review Agents

Completed and preserved as provenance:

- `code-reviewer` - `.context/reviews/code-reviewer.md`
- `perf-reviewer` - `.context/reviews/perf-reviewer.md`
- `security-reviewer` - `.context/reviews/security-reviewer.md`
- `critic` - `.context/reviews/critic.md`
- `verifier` - `.context/reviews/verifier.md`
- `test-engineer` - `.context/reviews/test-engineer.md`
- `tracer` - `.context/reviews/tracer.md`
- `architect` - `.context/reviews/architect.md`
- `debugger` - `.context/reviews/debugger.md`
- `document-specialist` - `.context/reviews/document-specialist.md`
- `designer` - `.context/reviews/designer.md`
- `product-marketer-reviewer` - `.context/reviews/product-marketer-reviewer.md`

Agent failures: none. Native subagent concurrency was limited, so fan-out ran in bounded waves rather than all named lanes starting simultaneously.

## Summary

Deduplicated findings this cycle: 39.

Highest-signal implementation candidates are the demo-domain canonical/default-nginx identity issue, DB-backed rate-limit rollback accounting, sitemap/feed freshness bugs, smart-collection AST breadth limits, public scanner false-negative shapes, Lightroom upload attribution, and user-visible UI/accessibility fixes. Several performance/scale and production-topology items remain valid but require larger architecture, production evidence, or explicit operator decisions.

## Merged Findings

### AGG-C16-01 - Demo domain can become a self-hosted deployment identity

- Severity: High
- Confidence: High
- Status: Confirmed
- Sources: `document-specialist`, `product-marketer-reviewer`, related `critic`
- Evidence: `apps/web/src/site-config.json:4`, `apps/web/scripts/ensure-site-config.mjs:12-21`, `apps/web/src/lib/constants.ts:21-24`, `apps/web/src/app/sitemap.ts:18-103`, `apps/web/src/app/robots.ts:24`, `apps/web/nginx/default.conf:21-24`, `README.md:8`, `README.md:148`.
- Failure scenario: a self-hosted operator builds without `BASE_URL` because tracked `site-config.json` already exists; metadata, sitemap, robots, feeds, OG fallbacks, analytics host logic, and nginx virtual-host identity can point at `gallery.atik.kr`.
- Fix direction: reject known demo hosts in production config validation or replace tracked runtime config with a rejected placeholder; make nginx `server_name` neutral/config-driven.

### AGG-C16-02 - Checked-in nginx collapses real client identity behind the documented TLS edge/LB topology

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Sources: `critic`, related `security-reviewer`
- Evidence: `apps/web/nginx/default.conf:1-4`, `:25-29`, repeated proxy header blocks at `:67-70`, `:83-87`, `:100-104`, `:116-120`, `:140-144`, `:157-161`, `:179-183`, `:191-196`; `apps/web/docker-compose.yml:19-21`; `apps/web/src/lib/rate-limit.ts:163-193`; `README.md:152-154`.
- Failure scenario: when nginx sits behind a TLS edge or load balancer, it passes the edge address as trusted client identity, so app and nginx rate limits collapse users behind one address and attribution degrades.
- Fix direction: encode one topology clearly: add trusted real-IP normalization for behind-edge use, or remove the behind-edge claim and document direct-edge-only assumptions.

### AGG-C16-03 - DB-backed rate-limit rollback can subtract attempts that were never persisted

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Sources: `code-reviewer`
- Evidence: `apps/web/src/lib/rate-limit.ts:436-507`; rollback call sites in `apps/web/src/app/actions/public.ts:92-107`, `:146-155`, `:276-303`; `apps/web/src/app/actions/admin-users.ts:130-138`, `:161-178`; `apps/web/src/app/actions/sharing.ts:117-127`, `:150-181`, `:231-240`, `:286-302`.
- Failure scenario: an action continues after a DB increment failure, then a later rollback branch succeeds and decrements a bucket row created by previous requests, weakening the persistent limiter across restarts/processes.
- Fix direction: thread DB-increment success through admission results and only call `decrementRateLimit` when the request actually incremented the DB bucket.

### AGG-C16-04 - Sitemap photo `lastModified` ignores image edits

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Sources: `debugger`
- Evidence: `apps/web/src/lib/data.ts:537-543`, `:1627-1637`; `apps/web/src/app/sitemap.ts:76-80`; `apps/web/src/app/actions/images.ts:920-927`.
- Failure scenario: editing a photo title/description updates page metadata and `images.updated_at`, but sitemap still publishes the original `created_at`, so crawlers are not told the photo page changed.
- Fix direction: select and emit `updated_at ?? created_at` for photo sitemap entries and add regression coverage.

### AGG-C16-05 - Tag-only image changes can make Atom feeds return false `304 Not Modified`

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Sources: `debugger`
- Evidence: `apps/web/src/lib/photo-title.ts:67-83`; `apps/web/src/lib/data.ts:828-853`; `apps/web/src/app/feed.xml/route.ts:60-153`; `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:74-153`; `apps/web/src/app/actions/tags.ts:176-197`, `:235-257`, `:322-332`, `:423-448`; `apps/web/src/app/actions/images.ts:1121-1135`.
- Failure scenario: tag-derived feed titles change after tag add/remove, but `images.updated_at` does not, so feed `Last-Modified` can stay stale and conditional readers can receive `304` for changed XML.
- Fix direction: touch affected parent image rows when tag links are inserted/deleted and add feed freshness tests.

### AGG-C16-06 - Smart-collection AST breadth is unbounded

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Sources: `architect`
- Evidence: `apps/web/src/lib/smart-collections.ts:142-178`, `:416-421`; `apps/web/src/app/actions/collections.ts:32-50`, `:83-98`; `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:86-101`; `apps/web/src/app/actions/public.ts:203-218`.
- Failure scenario: a stored collection query can contain thousands of sibling predicates in one group, making unauthenticated public requests parse, compile, and ask MySQL to plan a very large expression.
- Fix direction: add max children per group, max AST node/predicate count, and max JSON byte size in the shared smart-collection parser/validator.

### AGG-C16-07 - Lightroom upload cookie fallback loses uploader/audit attribution

- Severity: Low
- Confidence: High
- Status: Confirmed
- Sources: `security-reviewer`, `critic`
- Evidence: `apps/web/src/app/api/admin/lr/upload/route.ts:67-73`, `:433-441`, `:518-525`, `:547`; `apps/web/src/lib/api-auth.ts:69-83`, `:111-131`.
- Failure scenario: same-origin cookie-authenticated requests to the Lightroom upload endpoint are authorized but record `uploaded_by = null` and audit `userId = null`.
- Fix direction: make the route PAT-only or resolve the cookie-authenticated admin user and use that actor id for image attribution and audit.

### AGG-C16-08 - Public API rate-limit scanner misses local helper mutations

- Severity: Medium
- Confidence: High
- Status: Confirmed gate gap
- Sources: `test-engineer`
- Evidence: `apps/web/scripts/check-public-route-rate-limit.ts:124-127`, `:205-231`; missing fixture coverage in `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`.
- Failure scenario: a future public mutating API route can call a local helper that mutates before the rate-limit branch; the scanner sees no direct pre-gate mutation and passes.
- Fix direction: add failing fixtures and reuse/factor local mutating helper detection from the action-origin scanner, or fail closed on pre-gate local function calls.

### AGG-C16-09 - Public action-origin scanner ignores `catch`/`finally` mutations in exempt public actions

- Severity: Medium
- Confidence: High
- Status: Confirmed gate gap
- Sources: `test-engineer`
- Evidence: `apps/web/scripts/check-action-origin.ts:295-407`, especially `:391-393`; `apps/web/src/app/actions/public.ts:365-455`; fixture gap around `apps/web/src/__tests__/check-action-origin.test.ts:591-604`.
- Failure scenario: a future exempt public analytics action can add DB writes in `catch` or `finally`; scanner only validates the `try` body and still reports OK.
- Fix direction: add negative fixtures and traverse catch/finally blocks conservatively, requiring their own rate-limit dominance before mutation.

### AGG-C16-10 - Public route rate-limit docs/message under-describe early-return dominance

- Severity: Low
- Confidence: High
- Status: Confirmed documentation/gate-message drift
- Sources: `document-specialist`
- Evidence: `CLAUDE.md:598-602`; `apps/web/scripts/check-public-route-rate-limit.ts:1-18`, `:195-196`, `:331`; `apps/web/src/__tests__/check-public-route-rate-limit.test.ts:297-308`.
- Failure scenario: maintainers follow docs that say "call a helper" and then get a misleading scanner error because the actual contract requires returning early on over-limit before mutation.
- Fix direction: update docs, script header, and failure message to state early-return dominance.

### AGG-C16-11 - Home page degrades to a broken/loading shell when DB is unavailable

- Severity: High
- Confidence: High
- Status: Confirmed in local browser review
- Sources: `designer`
- Evidence: observed `/en` local dev response with DB `ECONNREFUSED`; `apps/web/src/app/[locale]/(public)/page.tsx:18-166`; `apps/web/src/lib/data.ts:933-946`, `:1720-1744`.
- Failure scenario: static public pages render from config fallbacks during DB outage, but home metadata/body data queries throw and the visitor sees an error/loading experience instead of a stable unavailable state.
- Fix direction: catch non-critical OG latest-image failures and render an explicit public unavailable state for listing-query failures while keeping programming/schema errors logged.

### AGG-C16-12 - Search result keyboard highlight can move off-screen

- Severity: Medium
- Confidence: High
- Status: Confirmed source issue
- Sources: `designer`
- Evidence: `apps/web/src/components/search.tsx:390-399`, `:428-444`.
- Failure scenario: `aria-activedescendant` changes while ArrowDown moves the active row below the scroll viewport, so sighted keyboard users lose the visible highlight.
- Fix direction: keep refs for result options and scroll the active option into view with `block: 'nearest'`.

### AGG-C16-13 - Map marker click bypasses the popup preview affordance

- Severity: Medium
- Confidence: Medium
- Status: Confirmed/likely UX issue
- Sources: `designer`
- Evidence: `apps/web/src/components/map/map-client.tsx:97-105`, `:120-141`; `apps/web/src/app/[locale]/(public)/map/page.tsx:59-89`.
- Failure scenario: clicking a marker immediately navigates away even though the marker also defines a popup with preview/open affordance; mouse users cannot inspect the popup from the primary marker interaction.
- Fix direction: let marker click open the popup and reserve navigation for the popup button/list links, or remove the popup and make direct navigation explicit.

### AGG-C16-14 - Batch image deletion repeats full derivative-directory scans

- Severity: Medium
- Confidence: High
- Status: Confirmed performance issue
- Sources: `perf-reviewer`
- Evidence: `apps/web/src/app/actions/images.ts:807-845`; `apps/web/src/lib/process-image.ts:575-664`.
- Failure scenario: deleting 100 images can perform up to 300 full derivative-directory scans after the DB transaction, causing high I/O and slow admin responses on large libraries.
- Fix direction: add a batch cleanup helper that scans each derivative directory once per delete operation and unlinks matched variants with bounded concurrency.

### AGG-C16-15 - GPS stripping materializes large originals in memory

- Severity: Medium
- Confidence: High
- Status: Confirmed performance issue
- Sources: `perf-reviewer`
- Evidence: `apps/web/src/lib/process-image.ts:1738-1822`; `apps/web/src/app/actions/images.ts:381-388`; `apps/web/src/app/api/admin/lr/upload/route.ts:364-378`.
- Failure scenario: `strip_gps_on_upload` reads and rewrites whole 150-200 MB originals in memory after streaming save, risking GC pauses or process restarts on constrained hosts.
- Fix direction: stream/segment scrub where possible, add a specific size/backpressure guard, or serialize GPS stripping through a process-wide limiter.

### AGG-C16-16 - Public map can hydrate/render up to 10k markers and 10k fallback list links

- Severity: Medium
- Confidence: Medium-High
- Status: Likely performance issue
- Sources: `perf-reviewer`, related `designer`
- Evidence: `apps/web/src/lib/data.ts:1640-1676`; `apps/web/src/app/[locale]/(public)/map/page.tsx:27-89`; `apps/web/src/components/map/map-client.tsx:76-144`.
- Failure scenario: large GPS-enabled galleries ship a huge marker payload, hydrate a huge fallback list, and instantiate thousands of Leaflet layers.
- Fix direction: use bbox/paged API and clustering, or substantially lower initial cap and virtualize/collapse the fallback list.

### AGG-C16-17 - Semantic/similar search does full decode and full sort for every scanned embedding

- Severity: Low
- Confidence: Medium
- Status: Likely performance issue
- Sources: `perf-reviewer`, related `architect`
- Evidence: `apps/web/src/lib/clip-embeddings.ts:36-44`, `:135-168`; `apps/web/src/app/api/search/semantic/route.ts:261-305`; `apps/web/src/app/api/search/similar/[id]/route.ts:143-177`.
- Failure scenario: raising `SEMANTIC_SCAN_LIMIT` toward the hard cap can create repeated CPU/GC bursts on public requests.
- Fix direction: stream decode/score and maintain a min-heap of size K, or move to a vector index if semantic search becomes primary.

### AGG-C16-18 - Topic delete race can report generic failure instead of "category has images"

- Severity: Low
- Confidence: Medium
- Status: Likely issue
- Sources: `code-reviewer`, `tracer`
- Evidence: `apps/web/src/app/actions/topics.ts:429-466`; `apps/web/src/db/schema.ts:33`.
- Failure scenario: another upload/retopic attaches an image after the empty check but before topic delete; the FK prevents data loss, but the catch block may return generic `failedToDeleteTopic`.
- Fix direction: map FK reference errors to `cannotDeleteCategoryWithImages` or serialize deletion with upload/topic mutation locks.

### AGG-C16-19 - `withAdminAuth` comment documents a token argument that is not passed

- Severity: Low
- Confidence: High
- Status: Confirmed documentation/API-contract drift
- Sources: `code-reviewer`
- Evidence: `apps/web/src/lib/api-auth.ts:22-35`, `:55-89`; actual use in `apps/web/src/app/api/admin/lr/upload/route.ts:67-72`.
- Failure scenario: a future admin API route author expects a final token argument and gets `undefined` or a route context object, causing wrong attribution or runtime failures.
- Fix direction: update comments to require `getAdminAuthToken(request)` or deliberately change wrapper signature and tests.

### AGG-C16-20 - Touch-target audit budgets by counts, so replacement violations can pass

- Severity: Low
- Confidence: High
- Status: Confirmed test design weakness
- Sources: `test-engineer`
- Evidence: `apps/web/src/__tests__/touch-target-audit.test.ts:183-199`, `:229-238`, `:764-788`.
- Failure scenario: one known violation is fixed while a new one lands in the same file; the count remains stable and the audit passes.
- Fix direction: replace count budgets with stable signatures or adjacent named exemption markers.

### AGG-C16-21 - Read-only public server-action rate limits depend on individual tests, not a generic gate

- Severity: Low
- Confidence: Medium
- Status: Likely coverage-policy gap
- Sources: `test-engineer`
- Evidence: exempt public actions in `apps/web/src/app/actions/public.ts:136-148`, `:251-300`; tests such as `apps/web/src/__tests__/public-actions.test.ts:228-239`.
- Failure scenario: a future expensive read-only public action can carry an exemption comment with no rate-limit call and pass the generic origin scanner unless a dedicated test exists.
- Fix direction: add a public server-action rate-limit scanner or parse exemption intent in `check-action-origin.ts`.

### AGG-C16-22 - Upload UI advertises a 2 GiB window while bundled nginx accepts roughly one 200 MiB file per request

- Severity: Medium
- Confidence: High
- Status: Confirmed product/UX mismatch
- Sources: `product-marketer-reviewer`
- Evidence: `apps/web/src/lib/upload-limits.ts:1-5`, `:19-21`; `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:41`; `apps/web/messages/en.json:157-158`; `apps/web/src/components/upload-dropzone.tsx:143-178`; `apps/web/nginx/default.conf:90-94`, `:123-134`.
- Failure scenario: UI accepts multiple large files under the 2 GiB app window, but bundled nginx rejects the multipart request before app-localized errors can run.
- Fix direction: upload one file per request or change UI/docs to explain the per-request proxy cap versus rolling app quota.

### AGG-C16-23 - Lightroom wording can still imply a bundled/client integration

- Severity: Low
- Confidence: High
- Status: Confirmed product-copy drift
- Sources: `product-marketer-reviewer`
- Evidence: `README.md:40`, `README.md:151`; `apps/web/README.md:48`; `apps/web/src/app/api/admin/lr/upload/route.ts:1-19`; `apps/web/messages/en.json:808-810`; `apps/web/src/lib/admin-tokens.ts:24-25`.
- Failure scenario: operators read "Lightroom publishes" and expect a ready Lightroom Classic plugin/setup flow, but the repo ships the server endpoint and tokens only.
- Fix direction: standardize wording on external upload clients / PAT-authenticated upload API, with Lightroom mentioned only as compatible with a separately supplied client.

### AGG-C16-24 - "High-performance" product copy is plausible but under-proven

- Severity: Low
- Confidence: Medium
- Status: Likely product-copy risk
- Sources: `product-marketer-reviewer`
- Evidence: `README.md:8`; `CLAUDE.md:5`, `:228`, `:398-411`; `apps/web/README.md:58-66`.
- Failure scenario: evaluators treat "high-performance" as a benchmark claim but docs provide caveats rather than a simple sizing envelope.
- Fix direction: add a tested sizing/benchmark section or soften the phrase to "optimized self-hosted photo gallery."

### AGG-C16-25 - "HDR-capable" can be read as HDR delivery

- Severity: Low
- Confidence: Medium
- Status: Likely product-copy/UI risk
- Sources: `product-marketer-reviewer`
- Evidence: `apps/web/messages/en.json:366-368`, `:162`, `:739-740`; `apps/web/src/components/color-details-section.tsx:548-558`; `apps/web/src/app/actions/images.ts:353-365`; `apps/web/src/lib/data.ts:375-404`.
- Failure scenario: an admin sees or screenshots the "HDR-capable" pill and interprets it as delivered HDR output even though the pipeline currently delivers SDR.
- Fix direction: rename to "HDR source" or "HDR source - SDR delivery."

### AGG-C16-26 - Login errors are announced twice

- Severity: Low
- Confidence: Medium
- Status: Confirmed/likely accessibility issue
- Sources: `designer`
- Evidence: `apps/web/src/app/[locale]/admin/login-form.tsx:28-31`, `:97-100`.
- Failure scenario: a failed login produces both a toast and inline `role="alert"` with the same text, causing duplicate screen-reader announcements and competing visual feedback.
- Fix direction: use inline alert for form validation and reserve toast for infrastructure/non-field failures.

### AGG-C16-27 - RTL support remains only partially future-proofed

- Severity: Low
- Confidence: High
- Status: Future-locale risk
- Sources: `designer`
- Evidence: `apps/web/src/app/[locale]/layout.tsx:94-110`; physical-direction patterns in `apps/web/src/components/nav-client.tsx:90-178`, `apps/web/src/components/home-client.tsx:442-455`, `apps/web/src/components/photo-navigation.tsx:156-244`.
- Failure scenario: adding an RTL locale flips document direction while major controls and previous/next affordances remain visually LTR.
- Fix direction: before adding RTL locale, convert exposed physical positioning/margins to logical/locale-aware variants and add RTL layout tests.

### AGG-C16-28 - Timeline/year queries use non-sargable date functions

- Severity: Low
- Confidence: High shape / data-size-dependent impact
- Status: Manual-validation performance risk
- Sources: `perf-reviewer`
- Evidence: `apps/web/src/lib/data-timeline.ts:125-145`, `:152-214`.
- Failure scenario: large image tables can make `YEAR(capture_date)` / `MONTH(capture_date)` scans visible despite `processed = true` narrowing.
- Fix direction: validate with production `EXPLAIN`/slow logs; switch to range predicates or generated indexed columns if needed.

### AGG-C16-29 - Feed conditional GETs build feed before returning 304

- Severity: Low
- Confidence: Medium
- Status: Manual-validation performance risk
- Sources: `perf-reviewer`
- Evidence: `apps/web/src/app/feed.xml/route.ts:29-167`; `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:49-167`.
- Failure scenario: feed-reader traffic still pays settings/config/feed-row/XML composition before conditional response.
- Fix direction: if feed traffic grows, add a cheap `MAX(updated_at)`/ETag precheck before XML composition.

### AGG-C16-30 - Photo metadata/body may duplicate image lookup across Next render boundaries

- Severity: Low
- Confidence: Low-Medium
- Status: Manual-validation performance risk
- Sources: `perf-reviewer`
- Evidence: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:54-59`, `:142-149`; `apps/web/src/lib/data.ts:1690`.
- Failure scenario: if React `cache()` does not dedupe metadata/body boundaries after framework changes, photo pages can perform duplicate image queries.
- Fix direction: validate with query logging after framework upgrades; add a lighter metadata accessor if duplicate queries appear.

### AGG-C16-31 - Backup download reopens a validated path by pathname after `realpath()`

- Severity: Low
- Confidence: Medium
- Status: Manual-validation/host-trust risk
- Sources: `verifier`
- Evidence: `apps/web/src/app/api/admin/db/download/route.ts:43-76`; `apps/web/src/app/[locale]/admin/db-actions.ts:138-147`; `apps/web/src/__tests__/backup-download-route.test.ts:103-170`.
- Failure scenario: a same-UID local process with write access to `data/backups` replaces the validated pathname between `realpath()` and `createReadStream()`.
- Fix direction: stream from a file descriptor opened with no-symlink-following where supported and add a TOCTOU regression test.

### AGG-C16-32 - Process-local coordination assumes the documented single web instance

- Severity: High if topology changes / Low for current documented deployment
- Confidence: High
- Status: Manual-validation topology risk
- Sources: `architect`, `tracer`, related `security-reviewer`
- Evidence: `CLAUDE.md:228`; `apps/web/docker-compose.yml:11-16`; `apps/web/src/lib/restore-maintenance.ts:1-56`; `apps/web/src/lib/upload-tracker-state.ts:7-78`; `apps/web/src/lib/image-queue.ts:76-90`; `apps/web/src/lib/rate-limit.ts:112-121`; `apps/web/src/lib/data.ts:24-71`.
- Failure scenario: horizontal scaling splits restore maintenance, upload tracking, queue status, buffered analytics, and some rate-limit state across processes.
- Fix direction: keep single-instance invariant explicit; externalize to DB/Redis/distributed queue before scaling.

### AGG-C16-33 - Semantic search remains bounded brute force in the web request path

- Severity: Medium if caps/data grow
- Confidence: Medium
- Status: Manual-validation architecture risk
- Sources: `architect`, related `perf-reviewer`
- Evidence: `apps/web/src/lib/clip-embeddings.ts:36-44`; `apps/web/src/app/api/search/semantic/route.ts:261-305`; `apps/web/src/app/api/search/similar/[id]/route.ts:143-176`; `apps/web/src/lib/clip-model.ts:53-70`.
- Failure scenario: increasing corpus/caps/concurrency can degrade regular gallery traffic through request-path vector scans and local model inference.
- Fix direction: profile before raising caps; move ranking to vector index/service or precomputed nearest-neighbor backend when needed.

### AGG-C16-34 - Dockerfile native package pins can drift from package-lock versions

- Severity: Low
- Confidence: Medium
- Status: Manual-validation/build risk
- Sources: `architect`
- Evidence: `apps/web/Dockerfile:50-56`; `apps/web/package.json:35-43`.
- Failure scenario: dependency upgrades can leave explicit native package installs in Dockerfile stale, causing container-only native binary mismatch.
- Fix direction: add a lockfile-vs-Dockerfile pin check or derive versions from the lockfile during Docker build.

### AGG-C16-35 - Durable analytics writes are intentionally best-effort

- Severity: Low
- Confidence: Medium
- Status: Manual-validation product semantics risk
- Sources: `tracer`
- Evidence: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:163-165`; `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:163-164`; `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:132-137`; `apps/web/src/app/actions/public.ts:357-452`.
- Failure scenario: request abort/runtime teardown can under-record image/topic/shared-group views.
- Fix direction: keep if analytics are approximate; otherwise await writes or move to a tracked durable side-effect queue.

### AGG-C16-36 - Deploy command override is a trusted arbitrary-shell escape hatch

- Severity: Low
- Confidence: Medium
- Status: Manual-validation operational risk
- Sources: `critic`
- Evidence: `scripts/deploy-remote.sh:61-72`; `.env.deploy.example:13-14`.
- Failure scenario: if `.env.deploy` is generated from untrusted input or writable by an untrusted local process, `npm run deploy` executes arbitrary shell under the developer account.
- Fix direction: document `chmod 600 .env.deploy`, warn when `DEPLOY_CMD` is set, or replace it with narrower override fields.

### AGG-C16-37 - Admin SQL restore safety depends on regex scanning and should stay covered by restore drills

- Severity: Low
- Confidence: Medium
- Status: Manual-validation operational risk
- Sources: `critic`
- Evidence: `apps/web/src/app/[locale]/admin/db-actions.ts:491-519`; `apps/web/src/lib/sql-restore-scan.ts:113-155`.
- Failure scenario: future dump syntax/conditional comments/encodings can create parser gaps or false positives in a destructive restore path.
- Fix direction: keep scanner tests and add periodic restore drills into disposable DBs with production-shaped dumps and malicious edge fragments.

### AGG-C16-38 - DB backups and MySQL child credentials rely on host-level trust

- Severity: Low
- Confidence: High
- Status: Manual-validation operational risk
- Sources: `security-reviewer`
- Evidence: `apps/web/src/app/[locale]/admin/db-actions.ts:140-172`, `:540-550`; `apps/web/src/app/api/admin/db/download/route.ts:22-87`.
- Failure scenario: plaintext SQL backups and transient `MYSQL_PWD` child environments are exposed to privileged local host users.
- Fix direction: validate single-tenant/disk-encrypted host; add encrypted backups or alternative credential delivery if threat model requires it.

### AGG-C16-39 - Full integration validation remains gated for LR upload, DB restore, real CLIP, and admin e2e

- Severity: Medium validation risk
- Confidence: High
- Status: Manual-validation coverage risk
- Sources: `test-engineer`, `designer`, `product-marketer-reviewer`, `debugger`
- Evidence: `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-15`; `apps/web/src/__tests__/db-restore.test.ts:42-65`; `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`; `apps/web/src/__tests__/clip-semantic-integration.test.ts:7-31`; `apps/web/e2e/admin.spec.ts:6-12`; local designer browser blocker from DB `ECONNREFUSED` and HMR errors; debugger's dirty-review-artifact full-suite blocker.
- Failure scenario: default local/CI gates can pass while multipart PAT upload, destructive restore, real model weights, or authenticated browser flows remain unexercised.
- Fix direction: add opt-in/disposable integration lanes and keep local review artifacts free of tracked-secret assignment patterns before running the whole suite.

## Validation Evidence From Review Phase

Across reviewer lanes:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run typecheck --workspace=apps/web` passed in security/verifier/debugger lanes.
- `npm run lint --workspace=apps/web` passed in verifier/debugger lanes.
- `npm test --workspace=apps/web` passed in verifier and critic lanes; debugger's later full-suite run was blocked by dirty review-artifact prose tripping `tracked-secrets.test.ts`, not by current HEAD application code.
- `npm run build --workspace=apps/web` passed in verifier/debugger lanes.
- Designer started a local dev server on `127.0.0.1:3001` and used `agent-browser` snapshots/screenshots for `/en/privacy` and `/en/admin`; data-backed runtime coverage was blocked by unavailable local MySQL and dev HMR handshake errors.

## AGENT FAILURES

None.
