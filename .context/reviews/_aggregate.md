# Aggregate Review — review-plan-fix cycle 1 (2026-04-24)

## Review agents

Artifacts reviewed for this cycle:
- `.context/reviews/architect.md`
- `.context/reviews/api-reviewer.md`
- `.context/reviews/code-reviewer.md`
- `.context/reviews/critic.md`
- `.context/reviews/debugger.md`
- `.context/reviews/designer.md`
- `.context/reviews/perf-reviewer.md`
- `.context/reviews/quality-reviewer.md`
- `.context/reviews/security-reviewer.md`
- `.context/reviews/style-reviewer.md`
- `.context/reviews/test-engineer.md`
- `.context/reviews/verifier.md`

Requested but not registered in this environment:
- `document-specialist`
- `tracer`

## AGENT FAILURES
- None.

## Dedupe summary

New deduped findings: **33**. Cross-agent agreement is noted where present; findings flagged by multiple agents are higher-signal.

## Merged findings

### AGG1 — `getGalleryConfig()` can still fail the public shell on a transient settings-table outage
- **Severity / confidence:** HIGH / HIGH
- **Signals:** architect, debugger, verifier
- **Citations:** `apps/web/src/lib/gallery-config.ts:33-39, 68-84`; call sites `apps/web/src/app/[locale]/layout.tsx:73-76`, `apps/web/src/components/nav.tsx:6-12`, `apps/web/src/app/[locale]/(public)/page.tsx:106-121`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:122-133`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:89-95`
- **Problem:** the gallery config helper reads `admin_settings` directly and does not catch DB failures or fall back to shared defaults. That makes the root layout and public pages hostage to a noncritical settings read.
- **Failure scenario:** a brief MySQL lock or pool issue on `admin_settings` turns the homepage/topic/share routes into 500s even though the app could have rendered with defaults.
- **Fix direction:** mirror the SEO helper pattern: catch the read failure, log a warning, and return `gallery-config-shared` defaults.

### AGG2 — `lib/data.ts` still mixes read-model queries with process lifecycle state
- **Severity / confidence:** MEDIUM / HIGH
- **Signals:** architect
- **Citations:** `apps/web/src/lib/data.ts:11-109, 594-669`; restore consumer `apps/web/src/app/[locale]/admin/db-actions.ts:21-24, 290-294`
- **Problem:** the same module owns query helpers, buffered view-count state, flush timers, and restore/shutdown plumbing.
- **Failure scenario:** a “just the data layer” refactor accidentally changes queue flush or restore behavior because operational state lives beside read helpers.
- **Fix direction:** split the shared-group view buffer / flush lifecycle into a dedicated module and keep `lib/data.ts` focused on reads.

### AGG3 — `getSharedGroup()` is a query helper with a hidden write contract
- **Severity / confidence:** MEDIUM / HIGH
- **Signals:** architect
- **Citations:** `apps/web/src/lib/data.ts:594-669`; call sites `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:29-35, 89-95, 118-144`
- **Problem:** the helper increments `sharedGroups.view_count` by default unless callers remember to opt out.
- **Failure scenario:** a future metadata/prefetch caller records traffic as real views, or a refactor accidentally uses the write path in a read-only context.
- **Fix direction:** split read vs. record-view APIs, or make the side-effecting path explicitly named.

### AGG4 — `image-queue.ts` is not side-effect-free; importing it boots the queue and timers
- **Severity / confidence:** MEDIUM / MEDIUM
- **Signals:** architect
- **Citations:** `apps/web/src/lib/image-queue.ts:330-411`; importers `apps/web/src/app/actions/images.ts:13-15, 298-306`, `apps/web/src/app/[locale]/admin/db-actions.ts:22-24, 292-304`
- **Problem:** the module auto-calls `bootstrapImageProcessingQueue()` at import time.
- **Failure scenario:** a test or route that only wants queue helpers unexpectedly triggers DB probing, orphan cleanup, and an hourly GC interval.
- **Fix direction:** move bootstrap and maintenance work to an explicit startup path.

### AGG5 — The current deployment model still assumes one process owns queue state, rate limits, and analytics buffers
- **Severity / confidence:** MEDIUM / HIGH
- **Signals:** architect
- **Citations:** `apps/web/src/lib/image-queue.ts:94-123, 164-187, 330-373`; `apps/web/src/lib/data.ts:11-109`; `apps/web/src/lib/rate-limit.ts:22-26, 101-149`; `apps/web/src/lib/restore-maintenance.ts:1-56`
- **Problem:** queue claims, buffered view counts, maintenance state, and in-memory fast-path limits are process-local.
- **Failure scenario:** horizontal scaling or multi-process deployment silently breaks claims, buffering, or rate limiting.
- **Fix direction:** keep the single-process contract explicit, or add shared coordination before scaling out.

### AGG6 — Production CSP still allows inline script execution
- **Severity / confidence:** LOW / HIGH
- **Signals:** security
- **Citations:** `apps/web/next.config.ts:72-75`
- **Problem:** production `script-src` still contains `'unsafe-inline'`.
- **Failure scenario:** any future HTML/script injection bug gains immediate executable payloads instead of being blocked by CSP.
- **Fix direction:** move to nonce/hash-based scripts and remove `'unsafe-inline'`.

### AGG7 — Public tag query parsing is unbounded and can be abused for request amplification / DoS
- **Severity / confidence:** MEDIUM / MEDIUM
- **Signals:** security
- **Citations:** `apps/web/src/lib/tag-slugs.ts:3-19`, `apps/web/src/app/[locale]/(public)/page.tsx:18-33,104-120`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:18-43,95-132`, `apps/web/src/app/api/og/route.tsx:29-40`
- **Problem:** the `tags` query is split into an unbounded array and processed without a total-length or token-count cap.
- **Failure scenario:** a very long comma-separated tag list forces large allocations and repeated matching work on public requests.
- **Fix direction:** cap query length / token count before splitting, or stop after the first N valid tags.

### AGG8 — Production still falls back to the checked-in localhost site config if `BASE_URL` is unset
- **Severity / confidence:** LOW / LOW
- **Signals:** security
- **Citations:** `apps/web/src/site-config.json:1-5`, `apps/web/src/lib/constants.ts:11-14`, `apps/web/src/lib/data.ts:883-890`, `apps/web/src/app/robots.ts:13-21`, `apps/web/src/app/sitemap.ts:8-12,19-55`
- **Problem:** the runtime accepts a localhost-flavored checked-in config as a fallback.
- **Failure scenario:** an operator forgets `BASE_URL` and the app emits localhost canonical URLs, sitemap entries, and OG metadata.
- **Fix direction:** fail closed in production when `BASE_URL` or site config is unsafe.

### AGG9 — Mobile nav state persists after navigation
- **Severity / confidence:** MEDIUM / HIGH
- **Signals:** designer
- **Citations:** `apps/web/src/components/nav-client.tsx:26-156`
- **Problem:** `isExpanded` only resets on viewport breakpoint changes, not on route changes.
- **Failure scenario:** on mobile, opening the menu and navigating to another page leaves the new page rendered under the still-expanded nav.
- **Fix direction:** collapse the menu on pathname changes or link clicks.

### AGG10 — The mobile info bottom sheet is touch-only and never moves focus into the panel
- **Severity / confidence:** HIGH / HIGH
- **Signals:** designer
- **Citations:** `apps/web/src/components/photo-viewer.tsx:269-277, 586-592`; `apps/web/src/components/info-bottom-sheet.tsx:24-176`
- **Problem:** the sheet opens from a button but starts in `peek` state and only exposes touch gestures; the focus trap activates only when expanded.
- **Failure scenario:** mobile keyboard/screen-reader users can trigger the sheet but cannot reliably reach the EXIF content.
- **Fix direction:** make expansion keyboard-accessible and move focus into the sheet on open.

### AGG11 — Lightbox controls can disappear visually while remaining focusable
- **Severity / confidence:** HIGH / HIGH
- **Signals:** designer
- **Citations:** `apps/web/src/components/lightbox.tsx:111-148, 283-355`
- **Problem:** auto-hidden controls keep their tab stops and accessibility exposure even when opacity goes to zero.
- **Failure scenario:** a keyboard user tabs onto an invisible close button after the idle timer hides the overlay.
- **Fix direction:** hide controls from the tab order / accessibility tree when visually hidden, or keep them visible while focused.

### AGG12 — Dropping invalid files gives no validation feedback in the upload flow
- **Severity / confidence:** MEDIUM / HIGH
- **Signals:** designer
- **Citations:** `apps/web/src/components/upload-dropzone.tsx:95-106, 258-269`
- **Problem:** rejected files are ignored; only accepted files are appended.
- **Failure scenario:** a user drops an unsupported file and nothing visible happens, making the uploader feel broken.
- **Fix direction:** surface `fileRejections` inline or via toast.

### AGG13 — The root error shell ignores the active theme
- **Severity / confidence:** MEDIUM / MEDIUM
- **Signals:** designer
- **Citations:** `apps/web/src/app/global-error.tsx:45-75`
- **Problem:** the global error page renders its own shell without the dark-mode class / provider context.
- **Failure scenario:** dark-mode users hit a bright light-only error page that clashes with the rest of the app.
- **Fix direction:** bootstrap the theme class/attribute in the error shell or read the persisted theme before rendering.

### AGG14 — Exact counts are computed on the hot path for both public galleries and admin pagination
- **Severity / confidence:** MEDIUM / HIGH
- **Signals:** perf
- **Citations:** `apps/web/src/lib/data.ts:253-276`, `apps/web/src/lib/data.ts:359-385`, `apps/web/src/app/[locale]/(public)/page.tsx:108-159`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:121-159`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:14-23`
- **Problem:** public pages compute `COUNT(*) OVER()` and the admin dashboard separately counts the full table.
- **Failure scenario:** large libraries turn ordinary page renders into table-wide scans.
- **Fix direction:** cache or denormalize counts, or fetch them asynchronously.

### AGG15 — Single and bulk deletes rescan upload directories once per file
- **Severity / confidence:** MEDIUM / HIGH
- **Signals:** perf
- **Citations:** `apps/web/src/lib/process-image.ts:165-204`, `apps/web/src/app/actions/images.ts:411-419, 517-535`
- **Problem:** delete paths fall into the legacy-variant directory scan path for each image / format.
- **Failure scenario:** bulk deletion of many images triggers repeated directory walks and long server-action runtimes.
- **Fix direction:** scan each derivative directory once per request, not once per file.

### AGG16 — Zoomed photo interaction does layout reads on every pointer move
- **Severity / confidence:** LOW / MEDIUM
- **Signals:** perf
- **Citations:** `apps/web/src/components/image-zoom.tsx:24-39, 86-95`
- **Problem:** each pointer move reads layout and writes a transform immediately.
- **Failure scenario:** drag/zoom interactions stutter on low-end devices.
- **Fix direction:** cache bounds once per gesture or move reads/writes behind animation-frame batching.

### AGG17 — Every admin tag combobox mounts its own filter work and outside-click listener
- **Severity / confidence:** LOW / MEDIUM
- **Signals:** perf
- **Citations:** `apps/web/src/components/tag-input.tsx:45-56, 127-136, 159-220`
- **Problem:** each instance sets up its own filter memoization and document-level click listener.
- **Failure scenario:** pages with many tag inputs do redundant work and duplicate listeners.
- **Fix direction:** centralize shared filtering / click-outside handling where practical.

### AGG18 — Public gallery ordering can change after hydration, so cards may reshuffle on most viewports
- **Severity / confidence:** MEDIUM / HIGH
- **Signals:** critic
- **Citations:** `apps/web/src/components/home-client.tsx:80-107, 174-175, 214-247, 319`
- **Problem:** masonry order is recomputed after hydration and can diverge from the server-rendered order.
- **Failure scenario:** cards jump around after the initial paint, especially on viewport widths that cross the layout threshold.
- **Fix direction:** keep the server/client ordering strategy aligned or defer layout rearrangement until after first stable paint.

### AGG19 — Public photo entry points lose collection context
- **Severity / confidence:** HIGH / HIGH
- **Signals:** critic
- **Citations:** `apps/web/src/components/home-client.tsx`, `apps/web/src/components/search.tsx`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/lib/data.ts`
- **Problem:** next/prev navigation from public entry points can escape the filtered collection context.
- **Failure scenario:** a user opens a filtered gallery, navigates into a photo, and next/prev jumps them out of the intended subset.
- **Fix direction:** carry the collection/filter context through public photo routes and navigation helpers.

### AGG20 — `PhotoViewer` does not resync local state when `initialImageId` changes
- **Severity / confidence:** MEDIUM / HIGH
- **Signals:** critic
- **Citations:** `apps/web/src/components/photo-viewer.tsx`
- **Problem:** the component seeds local state once and does not fully re-sync it when the prop changes.
- **Failure scenario:** route transitions that reuse the component can show stale selection state.
- **Fix direction:** derive the active image from props more directly or add a prop-change synchronization effect.

### AGG21 — Tag-filtered metadata still uses raw slugs instead of canonical display names
- **Severity / confidence:** MEDIUM / HIGH
- **Signals:** critic
- **Citations:** `apps/web/src/components/home-client.tsx`, `apps/web/src/lib/tag-slugs.ts`, `apps/web/src/lib/data.ts`
- **Problem:** metadata / labels for tag-filtered views can expose slug values instead of the canonical tag names.
- **Failure scenario:** users see inconsistent titles/labels between the gallery UI and the page metadata.
- **Fix direction:** always map through the canonical tag-name source when building metadata.

### AGG22 — Public infinite scroll is built on offset pagination, so it can duplicate/skip items and hits a hard ceiling
- **Severity / confidence:** HIGH / HIGH
- **Signals:** code-reviewer, verifier, critic
- **Citations:** `apps/web/src/app/actions/public.ts:23-40`, `apps/web/src/lib/data.ts:318-385`, `apps/web/src/components/load-more.tsx:29-41`, `apps/web/src/app/[locale]/(public)/page.tsx:118-120`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:130-133`, `README.md:31`
- **Problem:** offset/limit pagination is used against a mutable feed, and the helper also caps the range at 10k.
- **Failure scenario:** uploads/deletes between requests shift offsets, causing duplicate or skipped cards; older content also stops loading once the offset ceiling is reached.
- **Fix direction:** move public browsing to keyset/cursor pagination anchored to the sort tuple.

### AGG23 — No-op admin updates are misreported as “not found”
- **Severity / confidence:** HIGH / HIGH
- **Signals:** debugger, verifier
- **Citations:** `apps/web/src/app/actions/images.ts:592-621`, `apps/web/src/app/actions/tags.ts:74-87`, `apps/web/src/app/actions/topics.ts:241-270`
- **Problem:** the handlers already pre-read the row but still treat `affectedRows === 0` as a missing-record failure.
- **Failure scenario:** a valid save that normalizes to the same data returns `imageNotFound` / `tagNotFound` / `topicNotFound`.
- **Fix direction:** trust the pre-read existence check or use matched/changed-row semantics instead of `affectedRows`.

### AGG24 — The `group_concat_max_len` bootstrap is fire-and-forget
- **Severity / confidence:** MEDIUM / HIGH
- **Signals:** verifier
- **Citations:** `apps/web/src/db/index.ts:28-51`
- **Problem:** the pool connection hook starts an async `SET group_concat_max_len = 65535` but does not wait for it before the connection becomes usable.
- **Failure scenario:** the first query on a new pooled connection can still run with the default 1024-byte `GROUP_CONCAT` limit.
- **Fix direction:** make the session initialization synchronous from the pool user’s point of view.

### AGG25 — Non-integer `image_sizes` values can produce invalid responsive descriptors
- **Severity / confidence:** MEDIUM / HIGH
- **Signals:** verifier
- **Citations:** `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-url.ts`, `apps/web/src/components/photo-viewer.tsx`
- **Problem:** the config path accepts values that are not guaranteed to be integers.
- **Failure scenario:** malformed sizes lead to bad derivative naming or invalid `srcset` descriptors.
- **Fix direction:** validate size values as integers before persisting / consuming them.

### AGG26 — E2E seeding can use the wrong upload roots and image sizes
- **Severity / confidence:** MEDIUM / HIGH
- **Signals:** quality
- **Citations:** `apps/web/scripts/seed-e2e.ts:1-24`, `apps/web/src/lib/upload-paths.ts:11-37`
- **Problem:** the seed script evaluates env-derived constants before loading `.env.local`.
- **Failure scenario:** local overrides for upload roots or image sizes are ignored, producing broken or flaky E2E seeds.
- **Fix direction:** load dotenv before env-dependent imports or move the constants behind a post-config initializer.

### AGG27 — `PhotoViewer` restores `document.title` from a stale mount snapshot
- **Severity / confidence:** MEDIUM / HIGH
- **Signals:** quality
- **Citations:** `apps/web/src/components/photo-viewer.tsx:79-105`
- **Problem:** the component captures `document.title` once on mount and restores that snapshot in cleanup.
- **Failure scenario:** client-side navigation can briefly overwrite the next page’s title or restore an out-of-date title.
- **Fix direction:** let route metadata own the title, or track previous titles per navigation instead of restoring a mount snapshot.

### AGG28 — `timerShowInfo` is effectively dead state
- **Severity / confidence:** LOW / MEDIUM
- **Signals:** quality
- **Citations:** `apps/web/src/components/photo-viewer.tsx:61,106,145-171,312-320`
- **Problem:** the flag is read in `showInfo` but nothing sets it to `true`.
- **Failure scenario:** maintainers can infer a timed info-panel path that never actually activates.
- **Fix direction:** delete the dead branch or restore the missing code path.

### AGG29 — The locale switcher hardcodes a two-locale flip instead of using the shared locale source of truth
- **Severity / confidence:** MEDIUM / HIGH
- **Signals:** style
- **Citations:** `apps/web/src/components/nav-client.tsx:45-63, 149-155`; `apps/web/src/lib/constants.ts:1-4`
- **Problem:** the switcher assumes only `en` and `ko` exist.
- **Failure scenario:** adding another supported locale leaves the navbar switcher out of sync with the actual locale list.
- **Fix direction:** derive the next locale from `LOCALES` and the shared label source.

### AGG30 — Default image sizes are duplicated in two formats
- **Severity / confidence:** MEDIUM / HIGH
- **Signals:** style
- **Citations:** `apps/web/src/lib/gallery-config-shared.ts:38-44, 71-73`
- **Problem:** the same default sizes exist as both a comma string and an array.
- **Failure scenario:** one representation changes and the other does not, so the UI and runtime defaults drift.
- **Fix direction:** centralize the default list in one representation and derive the other from it.

### AGG31 — The homepage metadata builder repeats almost the same object shape in multiple branches
- **Severity / confidence:** LOW / HIGH
- **Signals:** style
- **Citations:** `apps/web/src/app/[locale]/(public)/page.tsx:18-101`
- **Problem:** `openGraph` and `twitter` metadata blocks are duplicated across the branch that uses a custom OG image and the fallback branch.
- **Failure scenario:** one branch gets updated while the other lags behind, causing metadata drift.
- **Fix direction:** extract a helper for the shared payload and pass the image variant in.

### AGG32 — The search overlay combines too many concerns in one component
- **Severity / confidence:** LOW / MEDIUM
- **Signals:** style
- **Citations:** `apps/web/src/components/search.tsx:20-33, 40-123, 142-259`
- **Problem:** the component owns debounce timing, request sequencing, keyboard shortcuts, scroll locking, focus restoration, and result rendering.
- **Failure scenario:** future search-shape changes or keyboard tweaks require editing one dense file with many responsibilities.
- **Fix direction:** extract named types and helpers so async/control-flow logic is separated from dialog rendering.

### AGG33 — `globals.css` mixes layers, utilities, and component-specific rules in one flat file
- **Severity / confidence:** LOW / MEDIUM
- **Signals:** style
- **Citations:** `apps/web/src/app/[locale]/globals.css:13-165`
- **Problem:** base tokens, utilities, component-specific rules, and responsive overrides are interleaved.
- **Failure scenario:** a future tweak unintentionally wins or loses in the cascade because the file does not group concerns clearly.
- **Fix direction:** group the stylesheet into clear sections and keep formatting consistent.

## API / cache behavior

### AGG34 — Download failures can be cacheable when they should not be
- **Severity / confidence:** MEDIUM / MEDIUM
- **Signals:** api-reviewer
- **Citations:** `apps/web/src/app/api/admin/db/download/route.ts`
- **Problem:** failure paths do not clearly set `no-store` behavior.
- **Failure scenario:** an auth/download failure or transient error response becomes eligible for caching.
- **Fix direction:** ensure failure responses on the backup download route are explicitly non-cacheable.

### AGG35 — Probe endpoints can be cached even though they are health checks
- **Severity / confidence:** LOW / MEDIUM
- **Signals:** api-reviewer
- **Citations:** `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/api/health/route.ts`
- **Problem:** the probe routes do not clearly opt out of caching.
- **Failure scenario:** stale health/live responses are served to clients or monitoring.
- **Fix direction:** mark probe endpoints `no-store` / non-cacheable.

### AGG36 — The OG image route can cache 500s for too long
- **Severity / confidence:** MEDIUM / MEDIUM
- **Signals:** api-reviewer
- **Citations:** `apps/web/src/app/api/og/route.tsx`
- **Problem:** error responses are cacheable for a nontrivial period.
- **Failure scenario:** a transient OG-generation failure continues to serve cached 500s.
- **Fix direction:** keep successful image responses cacheable, but prevent error responses from sticking.

## Test / verification gaps

### AGG37 — The existing visual E2E check does not actually assert a baseline
- **Severity / confidence:** MEDIUM / HIGH
- **Signals:** test-engineer
- **Citations:** `apps/web/e2e/nav-visual-check.spec.ts:4-33`
- **Problem:** the test only creates screenshots, so it does not fail on unintended nav/layout changes.
- **Failure scenario:** visual regressions pass because the test never compares against a reference or semantic invariant.
- **Fix direction:** add semantic assertions or baseline comparison to make the check meaningful.

### AGG38 — The origin-guard E2E can produce a false positive because it never authenticates the request
- **Severity / confidence:** HIGH / HIGH
- **Signals:** test-engineer
- **Citations:** `apps/web/e2e/origin-guard.spec.ts:27-60`
- **Problem:** the test exercises a request path that does not actually prove the guard is blocking the intended authenticated surface.
- **Failure scenario:** the test passes while the real guarded request path remains unverified.
- **Fix direction:** make the test hit the real authenticated branch and assert the exact status / rejection behavior.

### AGG39 — Critical auth/action surfaces lack runtime regression tests
- **Severity / confidence:** HIGH / HIGH
- **Signals:** test-engineer
- **Citations:** `apps/web/src/app/actions/auth.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/actions/admin-users.ts`
- **Problem:** the highest-risk branches are not covered by direct runtime regression tests.
- **Failure scenario:** rollback/auth/error handling regresses without a test failure.
- **Fix direction:** add focused behavior tests for the critical action paths.

### AGG40 — Share-link lifecycle, backup/restore/CSV orchestration, and admin gallery/SEO write paths are only covered indirectly
- **Severity / confidence:** MEDIUM / HIGH
- **Signals:** test-engineer
- **Citations:** `apps/web/src/app/actions/sharing.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/seo.ts`
- **Problem:** the current coverage exercises helper slices, not the full action flows.
- **Failure scenario:** cross-step regressions in those workflows slip past the test suite.
- **Fix direction:** add one or two end-to-end action tests for each of the most critical workflows.

## Manual validation / remaining risk

### AGG41 — The repo still assumes a single-process owner for queue / maintenance behavior
- **Severity / confidence:** MEDIUM / HIGH
- **Signals:** architect
- **Citations:** `apps/web/src/lib/image-queue.ts:94-123, 164-187, 330-373`; `apps/web/src/lib/data.ts:11-109`; `apps/web/src/lib/rate-limit.ts:22-26, 101-149`; `apps/web/src/lib/restore-maintenance.ts:1-56`
- **Validate:** confirm the deployment and runbooks continue to enforce a single-process model, or plan a shared coordination layer before scaling out.

### AGG42 — Deployment/config fallback behavior still needs operator validation
- **Severity / confidence:** LOW / LOW
- **Signals:** security
- **Citations:** `apps/web/src/site-config.json:1-5`, `apps/web/src/lib/constants.ts:11-14`, `apps/web/src/lib/data.ts:883-890`, `apps/web/src/app/robots.ts:13-21`, `apps/web/src/app/sitemap.ts:8-12,19-55`
- **Validate:** ensure production startup fails closed when `BASE_URL` or the site config is unsafe.

## Final sweep
No relevant review-relevant source area was skipped in the current cycle. The main cross-file pressure points remain config fallback, hidden write/read contracts in `lib/data.ts`, queue bootstrap side effects, public gallery navigation correctness, and the currently weak test / caching guardrails.
