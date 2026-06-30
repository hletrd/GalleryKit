# Cycle 26 Aggregate Review

Date: 2026-06-30
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD at review start: `d13d66377e6952ae974a6ee3d29ce52f0aa77640`

## Review Fan-Out

Native callable subagent roles in this environment were `default`, `explorer`, and `worker`; the requested named reviewer roles were therefore assigned as reviewer personas to worker agents. The first UI/product worker spawn hit the live thread limit and was retried after a completed worker was closed.

Review files written:

- `code-reviewer.md`
- `architect.md`
- `perf-reviewer.md`
- `debugger.md`
- `security-reviewer.md`
- `tracer.md`
- `test-engineer.md`
- `verifier.md`
- `critic.md`
- `document-specialist.md`
- `designer.md`
- `ui-ux-designer-reviewer.md`
- `product-marketer-reviewer.md`

Agent failures: none. One spawn attempt failed due the environment thread limit, then the UI/product lane succeeded on retry.

## Aggregate Findings

### AGG-C26-01 - Restore maintenance lifecycle can wedge process/queue state

Severity: High
Confidence: High
Sources: `C26-CODE-HIGH-01`, `C26-ARCH-HIGH-01`

Regions:

- `apps/web/src/lib/restore-maintenance-durable.ts:60-78`
- `apps/web/src/app/[locale]/admin/db-actions.ts:482-526`
- `apps/web/src/instrumentation.ts:1-5`

Problem:
Durable restore state spans a process-local flag, marker file, image queue pause/resume state, and MySQL locks, but the helper does not own transitions exception-safely. Marker write happens after process state is set, and marker unlink happens before process state is cleared. Filesystem errors can therefore leave restore maintenance active, skip queue resume, or resurrect stale maintenance on restart.

Failure scenario:
If marker creation fails on a full/read-only bind mount, `restoreDatabase()` can abort after setting process maintenance and before cleanup. If marker unlink fails after restore, process maintenance and queue pause can remain active even though DB restore completed.

Suggested fix:
Refactor begin/end durable restore maintenance so process cleanup and queue resume cannot be skipped by marker I/O exceptions. Add tests for marker write and unlink failures.

### AGG-C26-02 - Failed restore can persist a durable lock with no in-app recovery path

Severity: High
Confidence: High
Sources: `DBG26-01`

Regions:

- `apps/web/src/app/[locale]/admin/db-actions.ts:492-499`
- `apps/web/src/app/[locale]/admin/db-actions.ts:671-680`
- `apps/web/src/app/[locale]/admin/db-actions.ts:716-731`
- `apps/web/src/lib/restore-maintenance-durable.ts:37-44`
- `apps/web/src/app/actions/auth.ts:74-78`

Problem:
When import or post-restore migration fails, the durable marker is intentionally kept. On restart, instrumentation restores maintenance state, and login is blocked with `restoreInProgress`, leaving no narrow in-app recovery path for an operator whose session was invalidated by the failed restore.

Failure scenario:
An operator uploads a bad dump, restore fails, the process restarts, and all admin login/mutations are blocked. Recovery requires shell access to clear the marker or repair DB state.

Suggested fix:
Add a narrow recovery mechanism or clearly scoped CLI/endpoint for restoring again, re-running postconditions, or clearing the marker after verification while normal admin mutations remain blocked.

### AGG-C26-03 - Restore SQL scanner permits cross-schema DDL/DML

Severity: Medium
Confidence: High
Sources: `SEC-26-01`, `TRC-26-01`

Regions:

- `apps/web/src/lib/sql-restore-scan.ts:39-155`
- `apps/web/src/app/[locale]/admin/db-actions.ts:608-664`

Problem:
The restore scanner blocks a denylist of dangerous SQL, but accepts schema-qualified write/DDL targets such as `CREATE TABLE otherdb.pwned`, `INSERT INTO otherdb.audit_log`, `ALTER TABLE otherdb.pwned`, and `UPDATE otherdb.users`. `mysql --one-database` is not a semantic sandbox; MySQL documents it as a `USE`-state filter.

Failure scenario:
On an overprivileged or co-hosted MySQL server, a malicious restore file uploaded by an admin or compromised admin session can write to a sibling schema.

Suggested fix:
Move from broad denylist to restore-shape allowlist. Reject qualified schema references outside the configured app DB and reject write/DDL targets outside known app backup tables. Add regression tests for cross-schema and unknown-table cases.

### AGG-C26-04 - Public OG route limiter lacks route-level behavior tests

Severity: Medium
Confidence: High
Sources: `C26-TE-01`

Regions:

- `apps/web/src/__tests__/og-rate-limit.test.ts:16-112`
- `apps/web/src/__tests__/og-route-source-contracts.test.ts:7-18`
- `apps/web/src/__tests__/og-photo-fallback.test.ts:53-74`
- `apps/web/src/app/api/og/route.tsx:74-90`
- `apps/web/src/app/api/og/photo/[id]/route.tsx:45-55`

Problem:
Tests cover helper/source contracts but not observable over-limit behavior in the GET handlers. The public-route rate-limit scanner intentionally excludes GET routes.

Failure scenario:
A refactor bypasses `preIncrementOgAttempt`, returns the wrong 429 shape, or does DB/ImageResponse work before rate-limit rejection while helper/source tests still pass.

Suggested fix:
Add mocked route-level tests for `/api/og` and `/api/og/photo/[id]` asserting 429, `Retry-After: 60`, and no downstream expensive work on over-limit.

### AGG-C26-05 - Shared-link lookup throttling lacks over-limit behavior tests

Severity: Medium
Confidence: Medium-High
Sources: `C26-TE-02`

Regions:

- `apps/web/src/__tests__/shared-route-rate-limit-source.test.ts:9-81`
- `apps/web/src/__tests__/shared-page-title.test.ts:74-130`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:30-34,83-94`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:35-38,89-100`

Problem:
Source-order tests prove limiter placement, but no behavior test proves over-limit paths throw `notFound()` before share-key DB lookups.

Failure scenario:
A future edit swallows the over-limit result or performs DB lookup before `notFound()` while source-order/title tests still pass.

Suggested fix:
Add route-render tests with `preIncrementShareAttempt` returning true for both single-share and group-share pages, asserting `notFound()` and no lookup.

### AGG-C26-06 - Custom modal dialogs expose background content to assistive tech

Severity: High
Confidence: High
Sources: `C26-UX-01`

Regions:

- `apps/web/src/components/search.tsx:365-383,533`
- `apps/web/src/components/lightbox.tsx:451-459`
- `apps/web/src/components/info-bottom-sheet.tsx:185-199`

Problem:
Custom modal surfaces declare `aria-modal="true"` but do not hide/inert background page content from the accessibility tree. Browser review confirmed the search dialog accessibility snapshot still exposed the underlying nav, main content, footer, notification region, and dev tools button.

Failure scenario:
A screen-reader user opens Search, Lightbox, or mobile info bottom sheet and virtual-cursor navigation can still move through and activate background content.

Suggested fix:
Use Radix `Dialog`/`Sheet`, or add a shared modal isolation helper that applies `inert` and `aria-hidden` to app-root siblings while the modal is open. Add regression coverage.

### AGG-C26-07 - Public data failures render a stripped generic error shell

Severity: Medium
Confidence: High
Sources: `C26-DES-01`, `C26-UX-02`

Regions:

- `apps/web/src/app/[locale]/error.tsx:22-57`
- `apps/web/src/app/[locale]/(public)/page.tsx:93,151-167`

Problem:
When DB-backed public routes fail, the client error boundary renders a stripped generic shell with only a small brand link, generic error text, retry, and return link. Normal search/theme/locale/footer affordances disappear.

Failure scenario:
During DB restart, migration drift, first-run misconfiguration, or demos without MySQL, visitors experience a dead-end-looking product failure instead of a gallery-specific degraded state.

Suggested fix:
Preserve normal public IA affordances in the error boundary or catch expected data-read failures and render a localized degraded state inside the normal public layout.

### AGG-C26-08 - Fire-and-forget analytics inserts can cross restore boundary

Severity: Medium
Confidence: Medium
Sources: `DBG26-02`

Regions:

- `apps/web/src/app/actions/public.ts:416-437`
- `apps/web/src/app/actions/public.ts:443-469`
- `apps/web/src/app/actions/public.ts:475-505`
- `apps/web/src/app/[locale]/admin/db-actions.ts:482-489`

Problem:
Analytics view insert promises are still fire-and-forget and untracked. Restore drains image queue/shared-group count buffers but does not wait for in-flight row inserts that passed the late maintenance gate.

Failure scenario:
A view action starts its insert just before restore import begins. The write may fail on FK errors or commit into the restored DB with pre-restore analytics data.

Suggested fix:
Track analytics writes with pause/drain semantics and have restore quiesce them before import. A minimal improvement is awaiting inserts so request lifetime tracks the write.

### AGG-C26-09 - Historical CLIP superpowers docs still assert live production activation

Severity: Medium
Confidence: High
Sources: `C26-CRIT-01`, `C26-DOC-01`

Regions:

- `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:4`
- `docs/superpowers/plans/2026-06-15-clip-semantic-search.md:17`
- `CLAUDE.md:159,541-545`
- `README.md:42`
- `apps/web/README.md:71-78`

Problem:
Historical docs say semantic search is shipped and activated in production with a concrete row count, while authoritative docs now say production mode is operator-enabled, disabled by default, and must be verified per target host.

Failure scenario:
An operator or agent follows the historical docs, skips host verification, or misdiagnoses a correctly disabled install as broken.

Suggested fix:
Demote those statements to historical activation notes and link to the current operator runbook.

### AGG-C26-10 - Admin settings copy blends photographer decisions with operator runbook detail

Severity: Medium
Confidence: Medium
Sources: `C26-PMR-01`

Regions:

- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:296-328,741-789`
- `apps/web/messages/en.json:748-781`
- `apps/web/messages/ko.json:748-781`

Problem:
Semantic search and re-encode settings mix outcome copy with implementation/runbook terms such as CLIP, placeholder embeddings, env flags, DB rows, sidecar backfill, and force reencode.

Failure scenario:
A photographer-admin trying to decide whether to enable a feature must parse dense operator language in the primary UI, especially in Korean.

Suggested fix:
Move env flags, sidecar commands, production DB rows, and force-reencode details into an operator details disclosure or docs link; keep primary UI copy outcome-first.

### AGG-C26-11 - Public first-page gallery queries compute exact grouped totals

Severity: Medium
Confidence: High
Sources: `PERF26-01`

Regions:

- `apps/web/src/lib/data.ts:878-907,1446-1461`
- `apps/web/src/app/[locale]/(public)/page.tsx:165-168`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:175-178`
- `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:100-101`

Problem:
First paint listing queries join tags, group, sort, and compute `COUNT(*) OVER()` for the whole matching set just to render about 30 cards.

Failure scenario:
Large galleries and crawlers force temp-table/window-count DB work before first page response.

Suggested fix:
Use `limit + 1` keyset listing for hot public first pages and move exact totals to cached/async counts or an explicit secondary endpoint.

### AGG-C26-12 - GPS stripping buffers full originals

Severity: Medium
Confidence: High
Sources: `PERF26-02`

Regions:

- `apps/web/src/lib/process-image.ts:905-910,1737-1763`
- `apps/web/src/app/actions/images.ts:388-395`
- `apps/web/src/app/api/admin/lr/upload/route.ts:367-378`

Problem:
Upload saving streams files to disk, but GPS stripping reads the full original into memory and writes a scrubbed buffer.

Failure scenario:
Multiple 150-200 MB originals with GPS stripping enabled can allocate full-file buffers plus copies while image processing/backfill/CLIP are active.

Suggested fix:
Implement streaming/bounded-segment scrub paths where possible, or cap whole-file stripping with a clear oversized-original error.

### AGG-C26-13 - Upload-processing contract lock spans slow I/O and CPU work

Severity: Low-Medium
Confidence: High
Sources: `PERF26-03`

Regions:

- `apps/web/src/app/actions/images.ts:175-190,346-418,628-630`
- `apps/web/src/app/api/admin/lr/upload/route.ts:243-275,307-461,548-551`

Problem:
The advisory lock for upload-setting consistency is held while saving originals, extracting metadata, stripping GPS, and cleaning files.

Failure scenario:
A large upload over slow storage holds a pool connection and blocks other uploads/settings changes for seconds to minutes.

Suggested fix:
Shrink the critical section to immutable settings snapshot, quota reservation, lock-once checks, and DB row creation, or move the lock to a dedicated connection with documented contention budget.

### AGG-C26-14 - Infinite masonry keeps every loaded photo mounted

Severity: Medium
Confidence: High
Sources: `PERF26-04`

Regions:

- `apps/web/src/components/home-client.tsx:124-130,286-424`
- `apps/web/src/components/load-more.tsx:41-61,116-132`

Problem:
Infinite load-more appends every page to `allImages` and keeps all loaded cards mounted.

Failure scenario:
Visitors scrolling thousands of photos accumulate DOM and React state until mobile tabs become janky or are evicted.

Suggested fix:
Virtualize/window the masonry grid or cap automatic loading and switch to explicit pagination.

### AGG-C26-15 - Public map can mount 10,000 markers and list rows

Severity: Medium
Confidence: High
Sources: `PERF26-05`

Regions:

- `apps/web/src/lib/data.ts:1649-1685`
- `apps/web/src/app/[locale]/(public)/map/page.tsx:31-89`
- `apps/web/src/components/map/map-client.tsx:86-140`

Problem:
The public map cap is finite but too high for one initial route payload and hydration pass.

Failure scenario:
Ten thousand React-Leaflet markers, popups, arrays, and list rows can freeze mobile or lower-end browsers.

Suggested fix:
Use viewport-bounded marker fetches, clustering/canvas rendering, and a virtualized/paginated accessible list.

### AGG-C26-16 - CSV export duplicates large data in memory

Severity: Medium
Confidence: High
Sources: `PERF26-06`

Regions:

- `apps/web/src/app/[locale]/admin/db-actions.ts:80-160`
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:103-124`

Problem:
CSV export materializes DB rows, line arrays, a joined string, server-action payload, and browser Blob.

Failure scenario:
Large galleries with long metadata can cause Node/browser allocations and GC pauses.

Suggested fix:
Move CSV export to an authenticated streaming route or background file export.

### AGG-C26-17 - Timeline/year routes use non-sargable date predicates

Severity: Low-Medium
Confidence: High
Sources: `PERF26-07`

Regions:

- `apps/web/src/lib/data-timeline.ts:97-116,129-142,186-207`
- `apps/web/src/db/schema.ts:116-120`

Problem:
Archive pages use `MONTH()`, `DAY()`, and `YEAR()` predicates while only `(processed, capture_date, created_at)` exists.

Failure scenario:
Crawler traffic over archive pages grows with the processed image slice because MySQL must evaluate date functions per row.

Suggested fix:
Use range predicates for year/month filters. For day-of-year and distinct years, add generated/indexed columns or a small rollup.

### AGG-C26-18 - Public nav pays for sitemap-only topic timestamps

Severity: Low
Confidence: Medium
Sources: `PERF26-08`

Regions:

- `apps/web/src/lib/data.ts:509-529`
- `apps/web/src/components/nav.tsx:8-20`
- `apps/web/src/app/sitemap.ts:40-72`
- `apps/web/src/db/schema.ts:116-120`

Problem:
`getTopics()` computes correlated latest image timestamps needed by sitemap, but public nav only needs lightweight topic fields.

Failure scenario:
Normal public renders pay sitemap metadata cost as topic/image counts grow.

Suggested fix:
Split `getTopicsForNav()` from `getTopicsForSitemap()`.

### AGG-C26-19 - Cached image display waits on per-tile synchronous HEAD probes

Severity: Low-Medium
Confidence: Medium
Sources: `PERF26-09`

Regions:

- `apps/web/public/sw.template.js:34-38,250-286`
- `apps/web/public/sw.js:34-38,250-286`

Problem:
The service worker waits up to 300 ms for a HEAD probe before serving each cached image.

Failure scenario:
A warm masonry page with many cached derivatives adds placeholder delay and origin load on high-latency networks.

Suggested fix:
Serve stale immediately and revalidate in the background, or replace N per-image probes with a manifest/version token.

## No-New-Finding Reports

The verifier role found no direct implementation contradiction beyond the test coverage findings recorded by test-engineer.

## Count

New aggregate findings: 19
