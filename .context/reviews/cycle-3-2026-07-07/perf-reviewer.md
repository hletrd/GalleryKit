# GalleryKit Performance Review — run-10 cycle-3

- **Reviewer:** perf-reviewer (r10-c3)
- **Date:** 2026-07-07
- **Range under review:** `642c5091..e08b6f97` (cycle-2 fixes), on top of a full-repo pass.
- **Method:** direct diff-level verification of all seven cycle-2 perf commits (Priority 1), followed by three exhaustive delegated sweeps (client components + pages; API routes + actions + middleware + nginx/docker/scripts; the full `src/lib` + `src/db` + service-worker layer), with every load-bearing agent claim re-verified against source by this lane (SW warm-path ordering, per-image config SELECT, memo prop stability, i18n payload size, nginx zone scope, lock ordering in tags.ts).
- **No source files were modified.**

Overall verdict: **all seven cycle-2 perf commits are correct and delivered their intended wins; none introduced a meaningful regression.** The one genuine cost the cycle added is a per-processed-image `admin_settings` SELECT in the queue's embedding gate (PERF3-01, a deliberate correctness trade from C2-10 that can be made cheap). The rest of this cycle's findings are LOW-grade: an i18n client-payload weight issue that predates the cycle, an edge-throttling question on the new nginx zone, and a handful of micro/edge items. No CRIT, no HIGH.

---

## Part 1 — Priority-1 verification of cycle-2 perf commits

### bf5a4da9 — SW: stop rewriting cached image bodies on 304-confirmed views (PERF-01/C2-11) — VERIFIED, correct
- The 304 and same-ETag branches (`public/sw.template.js:340-364`) now return the cached `Response` directly after a fire-and-forget `touchMeta` — no body tee, no `cache.put`. `cached` comes fresh from `imageCache.match()` with an unconsumed body and only headers are read before return, so returning it directly is safe.
- **Warm-path meta-op count re-checked:** on the hot 304/same-ETag path, `evictExpiredCachedImage` (which now reads the meta blob at `:244`) is **not reached** — it sits after the ETag-probe block and only runs on fall-through (no ETag, probe timeout/failure, or anomalous 200). Each cached view therefore performs exactly ONE meta-blob operation (via `touchMeta` on the fresh path, or the evict check on the fall-through path), not two. Compared to the pre-change flow (full image-body rewrite + meta touch per view), this is strictly cheaper: per confirmed-fresh tile, MBs of Cache-storage write replaced by a ~tens-of-KB JSON read-modify-write.
- **PERF-14 quantification (as tasked):** the C2-11 change did NOT make the single-JSON-blob meta store materially worse; it made the display path net cheaper. The deferral (C2-55) stands unchanged.
- The `sw-cache.ts` mirrors (`touchMeta`, `resolveCachedEntryAge`, `evictIfExpired`) match the template logic; contract tests updated; `sw.js` regenerated. One edge case found in the shared logic — see PERF3-03.

### 9bd2daf3 — lean topics on hot pages; sitemap budget + SEO fallback (PERF-03/C2-13, C2-29, C2-42) — VERIFIED, correct
- `getTopics()` (`src/lib/data.ts:515-523`) is now subquery-free; the correlated `MAX(updated_at)` lives only in `getTopicsWithLatestUpdate()` (`data.ts:533-548`), and a repo-wide grep confirms its ONLY consumer is `src/app/sitemap.ts` (ISR 3600). `getTopicsCached` wraps the lean accessor. The per-render O(total processed images) probe is gone from every `revalidate = 0` surface. Pinned by `__tests__/data-topics-lean-sql.test.ts`.
- Sitemap budget: the reservation now folds in the global feed row + per-topic-per-locale feed rows, and the final `.slice(0, MAX_SITEMAP_URLS)` (`sitemap.ts:129-135`) clamps defensively. The clamp cuts from the array tail, i.e. feed entries drop first and page/image URLs survive — a sensible priority order.
- `buildSeoSettingsFallback` is a pure object build (no DB); no perf surface.

### ea712cfc — bulk embedding decode (PERF-04 decode half / C2-14) — VERIFIED, correct; one advisory (PERF3-04)
- `bufferToEmbedding` (`src/lib/clip-embeddings.ts`) is endianness-probed once at module load; aligned buffers take a zero-copy `Float32Array` view, misaligned ones a single `Uint8Array.set` bulk copy; the big-endian fallback keeps the portable loop. Value-equivalence, misalignment, and NaN-bit tests pin it.
- **Lifetime safety re-checked at the call sites:** both search routes decode inside a single synchronous `.map()` (semantic route `:293-311`) with no `await` between decode and scoring, so a zero-copy view over mysql2's wire buffer can never observe a rewrite. Safe as shipped.
- Advisory: the commit MESSAGE says "copy chosen over zero-copy," but the code deliberately takes the zero-copy view when aligned (the in-code comment documents the correct analysis). Cosmetic mismatch — but the underlying transient-use constraint is load-bearing for the deferred C2-14b matrix cache; see PERF3-04.

### eb3a7ad9 — single join-UPDATE for tag rename/delete touch-stamps (PERF-07/C2-17) — VERIFIED, correct; one LOW note (PERF3-08)
- Both `updateTag` and `deleteTag` now issue one `UPDATE images JOIN image_tags … WHERE tag_id = ?` (`src/app/actions/tags.ts:100-105`, `:167-172`), riding the `image_tags(tag_id)` index; the multi-MB `IN (...)` packet and the unbounded pre-SELECT are gone. `deleteTag` correctly stamps BEFORE deleting the join rows.
- Minor behavior note (harmless): `deleteTag` now runs the join-UPDATE even when the tag doesn't exist — it matches zero rows, costing one indexed no-op statement.

### e5504bc8 — memoized MasonryCard (PERF-09/C2-19) — VERIFIED, correct
- Prop-stability audit against `home-client.tsx`: `image` keeps referential identity across appends (`setAllImages(prev => [...prev, ...newImages])`, `home-client.tsx:151-152`); `onLinkClick` is `saveScrollPosition`, a `useCallback` keyed only on `scrollKey` (`:164-166`); `imageSizes` is either the module-level `DEFAULT_IMAGE_SIZES` constant or a server-prop array whose reference is stable for the client component's lifetime; `estimatedCardWidth` / `isAboveFold` / `topicLabel` are primitives. `t`/`locale` are consumed via context inside the card (provider at root layout, effectively static), not via props. The default shallow comparator therefore bails correctly on appends, `showBackToTop` flips, and off-card viewport changes. Markup/aria preserved verbatim; `content-visibility: auto` still backs paint containment.

### ffc4a06e — ref-based swipe transforms in photo navigation (PERF-19/C2-18) — VERIFIED, correct
- All per-move work now writes styles imperatively via `applySwipeVisuals`; React state holds only the reduced-motion preference. The four touch listeners are added/removed symmetrically in one effect with correct deps. The resting JSX `style` literals never change value between renders, so React performs no style writes on unrelated parent re-renders and cannot clobber mid-drag imperative styles. Dismissal thresholds and post-navigation behavior are unchanged from the pre-change semantics.
- Bonus verified: the same idiom landed for the info bottom sheet in fc21007a (`info-bottom-sheet.tsx:130-141` — imperative `style.transform` per touchmove, `setSheetState` only on touchend), which **closes PERF-08** from the cycle-2 report.

### 02bea8d6 — image-queue budgets, retries, config reads (C2-08/10/32/33/34) — VERIFIED, correct; one finding (PERF3-01)
- `QUEUE_CONCURRENCY` now derives from the imported `POOL_CONNECTION_LIMIT` — drift closed. Processing-failure retries use an escalating unref'd `setTimeout` (5 s × min(retries,5), max 25 s); the delayed re-enqueue is protected by the `state.enqueued` dedupe set and the per-image advisory claim, so a delete or duplicate enqueue during the delay window resolves safely. The defensive state re-init now clears an orphaned hourly GC interval. The embedding bootstrap walk is capped at `SEMANTIC_SCAN_LIMIT` per invocation with a continuation log, and rows embedded during a call drop out of the `isNull` filter so later invocations continue naturally — correct cursor-free design.
- The C2-10 correctness fix (uncached config reads in detached contexts) introduces the only real new cost of the cycle: PERF3-01 below.

---

## Part 2 — New findings

### PERF3-01 — Every processed image now pays one (sometimes two) `admin_settings` SELECTs in queue side-effects
- **Severity:** LOW (MED during bootstrap storms at large backlog) · **Confidence:** High · **Status:** confirmed
- **Where:** `apps/web/src/lib/image-queue.ts:826` (embedding gate, runs per successfully processed image), `:708` (per legacy/snapshot-less job), `:450` (once per bootstrap invocation — fine); resolver cost at `apps/web/src/lib/gallery-config.ts:34-40` (`SELECT key,value FROM admin_settings WHERE key IN (<17 keys>)`).
- **Why:** the C2-10 fix correctly replaced request-scoped `getGalleryConfig()` (React `cache()` is a no-op outside a request store) with `getGalleryConfigUncached()` in detached queue tasks. But the `:826` call runs for EVERY processed image purely to read `semanticSearchMode`, and in the default `disabled` deployment the entire 17-row fetch is discarded after one field check. Legacy rows without a `processing_settings_json` snapshot pay a second SELECT at `:708`.
- **Scenario:** re-enqueue bootstrap of a 10k-image restored gallery → ~10-20k wasted pool round-trips over the run. Mitigating: the SELECTs are paced by the queue (one per multi-second Sharp encode at concurrency 1-2), each is a sub-ms PK-range read, so this is waste, not pressure — hence LOW.
- **Fix:** a module-level short-TTL (1-5 s) micro-cache inside `getGalleryConfigUncached` (same pattern as `serve-upload.ts`'s settings-hash SWR cache, including inflight dedupe), or resolve `semanticMode` once per bootstrap batch and thread it through the job like the quality snapshot already is. Either preserves the C2-10 live-flip semantics within an accepted skew window.

### PERF3-02 — nginx `public` zone: RSC prefetch bursts and public-static files share the page-navigation budget
- **Severity:** LOW · **Confidence:** Low-Medium · **Status:** needs-validation
- **Where:** `apps/web/nginx/default.conf:245-266` (`location /`, `limit_req zone=public burst=40 nodelay`, zone `10m rate=10r/s` at `:10`); exclusions for `_next/static`, `_next/image`, `/uploads/...` verified present.
- **Why:** everything not carved out lands in `location /`: `sw.js`, `manifest`, favicon/PWA icons, `robots.txt`, `sitemap.xml`, `/feed.xml`, AND Next App-Router viewport-entry RSC prefetches for every `<Link>`. A cold first visit to a link-dense masonry home (30+ photo links entering the viewport, plus ~5-8 public static sub-resources, plus the navigation itself) can plausibly approach the 40-token bucket from one legitimate IP; prefetch 429s degrade gracefully (fall back to on-click navigation), but a spillover 429 on a real navigation or `sw.js` fetch would be user-visible.
- **Mitigating:** Next throttles prefetch concurrency; the config comment itself argues normal browsing stays clear; the file is operator-applied (config-only, not deployed automatically).
- **Fix (when validated):** raise `burst` (e.g. 80), or exempt the small fixed set of `public/`-served static files and/or requests with the `Next-Router-Prefetch` header from the `public` zone. Validate first with `limit_req_status` log sampling (look for 429s with `$http_next_router_prefetch`) on the deploy host before changing anything.

### PERF3-03 — SW `touchMeta` can record size-0 LRU entries, silently under-counting the 50 MB image-cache cap
- **Severity:** LOW · **Confidence:** Medium (mechanism confirmed; trigger is edge-conditioned) · **Status:** confirmed mechanism
- **Where:** `apps/web/public/sw.template.js:189` and the lockstep mirror `apps/web/src/lib/sw-cache.ts:219` (`size: existing && existing.size ? existing.size : knownSize`); callers pass `knownSize = Number(cached.headers.get('Content-Length')) || 0` (`sw.template.js:339,342,360`); cap accounting sums `entry.size` in `recordAndEvict` (`:120-124`).
- **Why:** if a cached response exists WITHOUT a meta record (pre-C2-11 entry, or meta lost to independent browser quota eviction) AND lacks `Content-Length`, the 304-touch re-inserts it into meta with `size: 0`. Such entries occupy real Cache-storage bytes but never count toward `MAX_IMAGE_BYTES`, so the LRU can drift past its intended 50 MB cap; they are also never evicted by the size walk (removing them frees 0 accounted bytes).
- **Scenario:** long-lived returning visitor whose meta blob was quota-evicted once: every image they re-confirm via 304 re-enters meta at size 0 → the cap stops constraining until entries age out via the staleness path.
- **Fix:** when no prior size is known and `knownSize` is 0, fall back to `(await cached.blob()).size` (the template's existing `responseSize` helper) before recording — or skip creating the meta entry and let the next full revalidation's `recordAndEvict` set the real size. Mirror in `sw-cache.ts` + contract test.

### PERF3-04 — Zero-copy embedding views must never be retained (constraint for the deferred C2-14b matrix cache)
- **Severity:** LOW (advisory / landmine documentation) · **Confidence:** High · **Status:** confirmed
- **Where:** `apps/web/src/lib/clip-embeddings.ts` (`bufferToEmbedding` aligned branch: `new Float32Array(buf.buffer, buf.byteOffset, EMBEDDING_DIM)`).
- **Why:** the aligned-path view aliases mysql2's wire-packet `ArrayBuffer` — retaining the 2 KB view pins the entire underlying socket-read buffer alive. Fine today (both search routes use the arrays transiently inside one synchronous `.map()`, verified). But the deferred **C2-14b** item proposes caching the decoded embedding matrix across requests: implementing it by storing `bufferToEmbedding` results verbatim would pin up to thousands of wire buffers (potentially far more than 4 MB of nominal vector data) for the cache TTL. Whoever picks up C2-14b must copy into cache-owned storage (one contiguous `Float32Array` matrix is both safer and faster to scan).
- Also: the commit message of ea712cfc states "copy chosen over zero-copy view" while the shipped code takes the zero-copy view when aligned; the in-code comment is the accurate record. Worth a one-line doc correction whenever the file is next touched, so future readers trust the right artifact.

### PERF3-05 — Full i18n catalog (including ~21 KB of admin-only strings) is serialized into every dynamic page's client payload
- **Severity:** LOW-MED · **Confidence:** High (mechanism; byte impact measured on source JSON) · **Status:** confirmed
- **Where:** `apps/web/src/app/[locale]/layout.tsx:88,129` (`getMessages()` → `<NextIntlClientProvider messages={messages}>`); `src/i18n/request.ts:13` loads the whole `messages/{locale}.json` (en 52 KB / ko 62 KB on disk; 46 KB serialized for en).
- **Why:** the root locale layout hands the ENTIRE catalog to the client provider, so it is embedded in the RSC/flight payload of every full-document render — and every public page is `revalidate = 0` (dynamic), so anonymous visitors pay it per HTML navigation (client-side navigations reuse the layout). Measured namespace weights in `en.json`: `serverActions` 9.6 KB (server-side only — used via `getTranslations`, never needed client-side), `settings` 8.8 KB + `imageManager` 2.7 KB (admin-only surfaces) — ≈ 21 KB raw (~5-8 KB gzipped) shipped to every anonymous visitor for no possible use, on top of the legitimately-needed public namespaces.
- **Scenario:** image-dominated LCP keeps this from being user-visible today; it is steady per-page-view bandwidth and hydration-parse cost that grows with every added admin feature string.
- **Fix:** pass a namespace-filtered subset to `NextIntlClientProvider` in the public shell (next-intl supports `messages={pick(messages, ['common','viewer','nav',…])}`), keeping the full catalog only under the admin layout; or split admin namespaces into a separate file loaded by the admin layout's own provider. Requires an inventory of client-side `useTranslations()` namespaces (grep-able) to avoid runtime missing-key errors.

### PERF3-06 — Middleware rebuilds the full CSP string (including an `IMAGE_BASE_URL` `new URL(...)` parse) on every request
- **Severity:** LOW · **Confidence:** High · **Status:** confirmed (pre-existing; NOT introduced by a4a2d250, which only added the once-per-process failure log + fail-open)
- **Where:** `apps/web/src/proxy.ts` → `apps/web/src/lib/content-security-policy.ts:98` (`imageBaseUrl = parseCspImageBaseUrl(process.env.IMAGE_BASE_URL?.trim())` as a default parameter, evaluated per call) plus per-request source-array assembly and `.join(' ')`.
- **Why:** `IMAGE_BASE_URL` and the policy skeleton are process-constant; only the nonce varies per request. Microseconds per request on the hot SSR path — strictly wasted, but immaterial at current scale.
- **Fix:** memoize the parsed URL and the two invariant policy halves at module level; per request, only splice the nonce. Pure micro-optimization; take it opportunistically when the file is next touched.

### PERF3-07 — `serve-upload.ts` re-`realpath`s the constant upload root and uses `open()`-to-stat on HEAD/304 fast paths
- **Severity:** LOW · **Confidence:** High · **Status:** confirmed
- **Where:** `apps/web/src/lib/serve-upload.ts:176` (per-request `realpath(UPLOAD_ROOT)`), `:186-191` (`realpath` + `open()` + `fileHandle.stat()` where the HEAD (`:271`) and 304 (`:239`) branches need only mtime/size).
- **Why:** the route is the target of the SW's per-tile HEAD revalidation probe (deferred PERF-15), so each warm masonry tile costs an extra open/close syscall pair and a redundant constant-root `realpath`. Sub-ms each; only worth touching because the probe multiplies it by tile count.
- **Fix:** memoize `realpath(UPLOAD_ROOT)` once per process (it cannot change without a restart); use plain `stat()`/`lstat()` on branches that never stream the body, keeping `open()`+`fstat` only for the streaming path (which needs the fd-race safety).
- Interaction: if the PERF-15 probe-cooldown deferral is ever picked up, that change dominates this one.

### PERF3-08 — `updateTag` vs `deleteTag` acquire row locks in opposite order (rare InnoDB deadlock, self-resolving)
- **Severity:** LOW · **Confidence:** High (mechanism) / likelihood very low · **Status:** confirmed shape
- **Where:** `apps/web/src/app/actions/tags.ts` — `updateTag` locks the `tags` row first (`:91`) then `images`+`image_tags` rows via the join-UPDATE (`:100-105`); `deleteTag` locks `images`+`image_tags` rows first (`:167-172`) then `image_tags` (`:173`) and `tags` last.
- **Why:** introduced structurally by eb3a7ad9 (deleteTag must stamp before deleting join rows, so its images-first order is forced). Two admins concurrently renaming and deleting the SAME heavily-used tag can deadlock; InnoDB detects and rolls one transaction back, surfacing a generic action error to one admin. No hang, no corruption.
- **Fix (optional):** in `deleteTag`, take the `tags` row lock first with a `SELECT … FOR UPDATE` (or an early no-op `UPDATE tags SET id=id WHERE id=?`) so both actions acquire `tags → images` in the same order. Only worth doing if a deadlock error is ever actually observed; a retry-once wrapper would be equally effective.

### PERF3-09 — SQL restore scan reprocesses a 1 MB carry-over tail through the full regex battery per streamed chunk
- **Severity:** LOW (informational) · **Confidence:** High · **Status:** confirmed, accepted-by-design candidate
- **Where:** `apps/web/src/lib/sql-restore-scan.ts:267-278` (`appendSqlScanChunk` re-strips up to `SQL_SCAN_TAIL_BYTES` = 1 MB of tail through 4 strip variants × ~8 security regexes per chunk).
- **Why:** O(chunks × 1 MB) regex CPU during a restore — for a 250 MB dump at 4 MB chunks, ~60 × 1 MB redundant regex passes. Restore-only, single-shot, admin-gated, under the maintenance marker, and the regexes are security-critical — recorded so nobody "optimizes" the tail away without understanding it, and so a future very-large-dump slowdown has a known suspect.
- **Fix if ever needed:** track a high-water offset so only the un-scanned suffix re-enters the battery.

---

## Part 3 — Deferred/tracked items: status against this cycle's evidence

- **None of the deferred items are re-reported.** C2-12 (map markers), C2-14b (matrix cache — but see the PERF3-04 constraint that must ride along with it), C2-15 (view-record round trips), C2-16 (on-this-day scan), C2-20 (GPS strip read), C2-21 (updated_at filesort), C2-28 (admin table listeners), and the C2-55 long-tail (PERF-14/15/16/17/18/20/21/22/23) were all re-observed unchanged; no new evidence invalidates any deferral or its exit criterion.
- **PERF-14 explicitly re-quantified** (tasked): the C2-11 SW change did not worsen the JSON-blob meta store; the display path is net cheaper (one light meta rewrite replaces a full image-body re-put per confirmed-fresh view). Deferral stands.
- **PERF-08 is CLOSED:** the info bottom sheet's drag is now imperative (`info-bottom-sheet.tsx:130-141`, landed with fc21007a); `setSheetState` fires only on touchend.
- **PERF-01/03/04(decode)/07/09/19 are CLOSED** by the verified commits in Part 1.
- Non-perf cycle-2 commits checked for perf side-effects and found clean: 3b8d05c8 (CSP on `/api` is a static `next.config.ts:84-86` header rule — zero per-request work), a4a2d250 (once-per-process log flag), e39ad990 (single-writer guard: one dedicated non-pool connection, fire-and-forget from instrumentation — no boot-path stall, no pool shrink), b4e986c3 (one tiny `SELECT MAX` per deploy), b24572b0 (log level only), fa35fc78/9d6675ee (extra reads only inside the settings MUTATION when a byte-impacting key changes — never on render), 911cb0f5 (404 layouts share the React-`cache()`-deduped lookups with their pages — no added query on the valid path; single query + short-circuit on 404), 9ce5cf96 (tighter ISOBMFF bounds — marginally cheaper, never costlier), 7c1c0a03 (build-time only), 2c82a69c/fc21007a (focus-restore effects run on open/close transitions only).

## Part 4 — Coverage statement and verified non-findings

- **Priority 1:** all seven named commits verified at diff level, with call-site/flow re-verification for the four riskiest claims (SW meta-op count on the warm path; zero-copy buffer lifetime through the synchronous scoring map; MasonryCard prop identity through `home-client.tsx`; retry-timer dedupe safety in the queue).
- **Full-repo pass:** three delegated exhaustive sweeps covered (a) every file under `src/components` (incl. `map/`, `ui/`), all public/admin `page.tsx`/`layout.tsx`, and the client hooks; (b) all 8 API routes, all 13 action files + `db-actions.ts`, both feed routes, sitemap/robots, both uploads route handlers, `proxy.ts` + CSP/nonce/origin/auth/barrier libs, nginx config, Dockerfile/compose/deploy.sh, and `scripts/`; (c) every file in `src/lib` plus `src/db/index.ts`, `src/db/schema.ts`, `public/sw.template.js`, and `sw-cache.ts`. Agent-reported candidates were independently re-verified by this lane before inclusion (all line references above re-checked against source).
- **Verified clean (highlights):** semantic/similar scan ORDER BY rides the `(model_version, updated_at)` composite index — no filesort; health/live routes bounded (2 s race, unref'd timer) and the Docker healthcheck hits `/api/live` (no DB); OG routes keep the ETag short-circuit before Satori; `admin-mutation-barrier`, `queue-shutdown`, `clip-model`, `rate-limit`/`bounded-map`, `view-retention`, `audit` purges, `upload-tracker`, `admin-backfill-runner`, and `background-db-writes` all retain their bounded/chunked/unref'd discipline; all module-level timers found are `.unref?.()`'d and cleared on shutdown/settle; masonry `content-visibility` containment intact; no new N+1 introduced by the cycle's data-layer changes (topics split verified single-consumer by grep).
- Not deep-audited this cycle (unchanged, bounded, previously audited): `color-detection.ts`/`icc-*`/`gain-map-detection.ts` internals beyond the 9ce5cf96 diff, `gps-exif-strip.ts` internals (C2-20 owns it), e2e/test fixtures.

REVIEW COMPLETE: 9 findings
