# Causal Trace Review — GalleryKit (apps/web), run-10 cycle-3

Scope: `git log 642c5091..e08b6f97` (23 commits, cycle-2's shipped fixes). Traced
the six flows requested plus two additional self-selected flows. Predecessor
context consulted: `.context/reviews/cycle-2-2026-07-07/tracer.md`,
`.context/plans/cycle-2-2026-07-07-deferred.md`,
`.context/plans/cycle-1-2026-07-06-deferred.md`. No absent-new-evidence
re-reports below — every finding traces to code that changed in this range,
or to a gap that a cycle-2 fix left open.

**Verified fixed, not re-reported as findings** (confirmed by reading the
actual diffs + new tests, listed here only so the reader doesn't wonder why
they're missing): cycle-2 TRC-02 (queue concurrency now imports
`POOL_CONNECTION_LIMIT` from `@/db`, `image-queue.ts:6,145`) and TRC-04
(`getGalleryConfigUncached` correctly bypasses React `cache()` for the three
detached queue call sites, `gallery-config.ts:202`) are both cleanly closed by
`02bea8d6`. Cycle-2 TRC-05 (identical `restoreInProgress` message masking the
real blocker) is cleanly closed by `fa35fc78` — three distinct message keys,
tested branch-by-branch in `restore-blocker-messages.test.ts`. Cycle-2 TRC-01
(unfenced byte-impacting settings) gets a well-designed soft-warn fix in
`9d6675ee` (`requiresBackfill` derived from the authoritative
`DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS` list, not a hand-maintained subset).
Restore-maintenance marker lifecycle (flow 6) has zero commits touching
`restore-maintenance*.ts` or `instrumentation.ts` in this range — cycle-2's
trace of that flow stands unchanged, not re-traced here.

Also ruled out during tracing (documented so a future pass doesn't re-open
these as live leads): `MAX(created_at)` in `__drizzle_migrations` is a
`bigint` column (raw epoch-ms, not a MySQL DATETIME), so mysql2's default
`parseLengthCodedInt` returns a plain JS `Number` for `cursor` in
`migrate.js:807-810` — no `dateStrings`/BigInt string-coercion hazard.
`ea712cfc`'s zero-copy embedding decode (`clip-embeddings.ts:130-155`) is
correctness-safe even where a decoded view outlives an `await` (see
`similar/[id]/route.ts:160,201` — `targetEmbedding` survives a second DB
round-trip before use): traced through `mysql2`'s `packet_parser.js`
(`executeStart`/`executePayload`) and confirmed each TCP read or
reassembled multi-chunk payload gets its own freshly-allocated `Buffer`
(`Buffer.allocUnsafe` at `packet_parser.js:127` for the fragmented case, a
fresh per-`data`-event Node.js socket buffer for the common case) — nothing
in the driver recycles that memory for a later, unrelated packet, so a
long-lived zero-copy `Float32Array` view stays valid.

---

## TRC3-01 — Embedding-bootstrap scan cap (C2-34) resets its scan cursor to 0 on every invocation, so a permanently-un-embeddable backlog exceeding `SEMANTIC_SCAN_LIMIT` starves newer rows forever

**Severity:** Medium | **Confidence:** Medium-High

**File:line chain:**
- `apps/web/src/lib/image-queue.ts:447-517` `bootstrapMissingActiveEmbeddings` — `cursorId` is a **local** variable (`:460`), reinitialized to `0` on every call. The cap introduced by `02bea8d6` (C2-34) is `scanned >= SEMANTIC_SCAN_LIMIT` (`:470`, default 2000, `clip-embeddings.ts:44`), checked at the top of the `for(;;)` loop **before** issuing the next 50-row page.
- Within one invocation, `cursorId` does advance monotonically by id (`:515` `cursorId = lastRow.id`) regardless of whether any row in that page was successfully embedded — so a single invocation cannot infinite-loop on a stuck prefix.
- Across invocations there is **no persisted cursor**: `bootstrapMissingActiveEmbeddings` is re-invoked from scratch (cursor 0) on every `bootstrapImageProcessingQueue()` call — which fires after every processing failure (`:927-929` resets `bootstrapped`/`bootstrapCursorId` and calls `scheduleBootstrapRetry`, 30 s later) and after every continuation batch (`scheduleBootstrapContinuation`, `:983-997`, driven by `queue.onIdle()`).
- The design intentionally relies on rows dropping out of the `isNull(imageEmbeddings.imageId)` join filter (`:479-487`) once embedded, per the commit's own comment (`:463-469`, "no persisted cursor needed across invocations") — this is correct **only if every scanned row within the cap eventually gets an embedding written**. If a row's write never succeeds (`storeImageEmbeddingForMode` throws every time, or `resolveOriginalUploadPath` returns `null` at `:498-499` so the function returns without ever calling the write), that row stays `isNull` forever and is rescanned from `cursorId=0` on **every subsequent invocation**, consuming part of the 2000-row budget each time.

**Hypotheses considered:**
1. Self-healing, no real issue — stuck rows get rescanned but harmlessly skipped each time, and legitimate new rows are far below the 2000-row cap in practice. (True at today's documented ~445-photo production scale.)
2. Once permanently-stuck rows accumulate to ≥ `SEMANTIC_SCAN_LIMIT`, every invocation's cap trips **before** the id-ordered scan ever reaches rows added after the stuck prefix — those never get embedded until the stuck backlog shrinks below the cap (which it never does, since nothing removes a stuck row from `isNull`).

**Evidence for (2):** Confirmed by direct read: the id-ascending `orderBy(asc(images.id))` (`:488`) plus a cursor that restarts at 0 every invocation means a low-id stuck prefix is scanned FIRST on every call, unconditionally, before any higher-id row is ever reached once the prefix's size crosses the cap. There is no separate "known-bad row" skip list for the embedding path (the image-processing queue has one — `permanentlyFailedIds`, `:312-318` — but `bootstrapMissingActiveEmbeddings` has no equivalent).

**Evidence against:** Requires either (a) a gallery with ≥ 2000 processed images that have permanently-unresolvable originals (e.g., missing `data/uploads/original/` files for old rows), or (b) a systemic encoder failure (broken ONNX weights, `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` pointed at a bad model) causing every row's write to fail — at which point the entire processed-image count effectively becomes "stuck," which only needs to exceed 2000 to trigger starvation. Neither condition is documented as currently true in production (~445 photos).

**Concrete failure scenario:** An admin enables `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` with a `CLIP_MODELS_ROOT` pointed at the wrong path (a seeding/deploy mistake — CLAUDE.md's own runbook warns the seed and runtime paths must agree). Every `embedImageReal` call throws. Once the gallery has 2000+ processed images, `bootstrapMissingActiveEmbeddings` scans the same first ~2000 (by id) rows, fails all of them, hits the cap, warns, and exits — every 30 seconds (via `scheduleBootstrapRetry`) or on every processing-queue idle transition — forever. No image, old or new, ever gets an embedding, and the semantic search route (gated on rows existing for the active model version) stays degraded/empty even after the model path is fixed and new uploads start succeeding, because the STUCK OLD rows keep consuming the entire scan budget ahead of the now-fixable newer ones in id order.

**Suggested fix:** Persist `cursorId` (and ideally a small in-memory "recently failed this invocation" set, mirroring `permanentlyFailedIds`) across `bootstrapMissingActiveEmbeddings` invocations in `ProcessingQueueState`, advancing past a fully-scanned prefix instead of restarting at 0 — or bound retries per-row (skip a row after N failed embedding attempts, symmetric with the image-processing queue's own `permanentlyFailedIds` pattern) so a stuck prefix cannot perpetually crowd out later rows once the backlog exceeds `SEMANTIC_SCAN_LIMIT`.

**Remaining uncertainty / next probe:** Whether any production row is actually "stuck" today needs a runtime check (`SELECT COUNT(*) FROM images LEFT JOIN image_embeddings ... WHERE image_embeddings.image_id IS NULL` filtered to rows whose original file is confirmed missing) — not verifiable from static tracing alone.

---

## TRC3-02 — Service-worker `touchMeta` write, now the PRIMARY staleness signal (C2-11), is fire-and-forget and not `waitUntil`-protected — SW termination can drop the recency touch, causing premature eviction of legitimately fresh entries

**Severity:** Medium | **Confidence:** Medium (SW process-lifetime timing is inherently platform-variable, not reproducible in a unit test)

**File:line chain:**
- `apps/web/public/sw.template.js:339-343` (304 branch) and `:357-362` (same-ETag 200 branch) — both call `touchMeta(request.url, cachedSize).catch(() => {})` **without `await`**, then immediately `return cached;`.
- `apps/web/public/sw.template.js:456-474` `self.addEventListener('fetch', ...)` — the fetch handler's ONLY lifetime-extension is `event.respondWith(staleWhileRevalidateImage(request))` (`:474`). `event.respondWith()` extends the event's lifetime until the promise passed to it settles; it does **not** cover promises the handler starts but doesn't return/await (the fire-and-forget `touchMeta` call). No `event.waitUntil()` wraps the fetch path anywhere in this file (contrast `install`/`activate`, `:428-454`, which correctly use `waitUntil`).
- `apps/web/src/lib/sw-cache.ts:236-248` `resolveCachedEntryAge` — confirms the meta timestamp is now checked FIRST, header-derived age is fallback-only ("stops advancing once an entry has been touched without rewriting the response, so treating it as authoritative whenever meta already exists would age out entries the server keeps confirming as fresh" — `sw.template.js:234-242` carries the identical rationale).
- Before `bf5a4da9`, the 304/same-ETag branches called `await refreshCachedImageTimestamp(...)` (removed by this commit — see the diff at `sw.template.js` lines around the old `refreshCachedImageTimestamp` helper), which DID await a `cache.put` before returning — i.e. the THEN-primary freshness signal (the `sw-cached-at` response header) was durably written before the fetch handler's promise resolved. `touchMeta` was already being called in parallel back then too (also fire-and-forget), but it was redundant/secondary at that time.

**Hypothesis:** `bf5a4da9` correctly eliminates a real inefficiency (rewriting an unchanged cached body on every confirmed-fresh view), but in doing so it PROMOTES `touchMeta`'s already-existing fire-and-forget write from a redundant secondary signal to the sole primary recency source for `evictExpiredCachedImage` — without adding any lifetime protection for that write. If the browser terminates the service worker shortly after `respondWith()`'s promise resolves (a normal, documented SW lifecycle behavior, especially aggressive on iOS Safari and under Android/Chrome memory pressure), the `touchMeta` cache.put for the meta blob can be abandoned mid-flight.

**Evidence for:** Directly confirmed by reading the file: no `waitUntil` call exists anywhere in the fetch-handling code path (`staleWhileRevalidateImage`, `networkFirstHtml`, or the `fetch` listener itself); `touchMeta`'s only completion signal is its own internal `withMetaMutation` promise chain (`:178-194`), which nothing external observes.

**Evidence against:** This "detached async work after respondWith resolves" pattern is a REPO-WIDE pre-existing characteristic, not unique to this commit — the "true SWR" fallback path (`sw.template.js:372-375`, `startRevalidate(); return cached;`) has relied on the same un-protected continuation since at least R4C9 (predates this cycle entirely). Most real-world browsers keep an idle SW alive for tens of seconds after the last event settles (not milliseconds), so a same-tick cache.put racing termination is a relatively narrow window in practice. The failure mode is self-correcting (a spuriously-evicted-but-still-fresh entry just costs one extra revalidate fetch, not data corruption).

**Concrete failure scenario:** A visitor on iOS Safari (known for aggressive background SW suspension) revisits a gallery page after backgrounding the browser tab for a while. The cached image's 304 revalidation resolves, `event.respondWith` returns the cached tile immediately, and Safari suspends the SW before the detached `touchMeta` write's `cache.put` on the META_CACHE completes. The meta record's timestamp for that URL is never refreshed. On the NEXT visit, `evictExpiredCachedImage` (`sw.template.js:243-256`) reads the STALE meta timestamp (last successfully touched — an unknown time in the past, potentially already close to `IMAGE_MAX_STALE_MS` = 1 h), evicts a cache entry the server has been confirming as fresh via 304 on every intervening view, and forces a full re-fetch + re-`put` + `recordAndEvict` LRU rewrite — precisely the write-amplification cost this commit set out to eliminate, now triggered by a SPURIOUS eviction instead of a legitimate one.

**Suggested fix:** Wrap the `touchMeta` (and, ideally, the existing `startRevalidate()` background continuation) calls in `event.waitUntil()` so the SW's process lifetime is held open until the meta write actually lands, rather than relying on hope. This requires plumbing the `event` (or a `waitUntil`-compatible callback) into `staleWhileRevalidateImage`, which currently only receives `request`.

**Remaining uncertainty / next probe:** Not reproducible via the existing Vitest reference-module tests (`sw-cache.test.ts` tests the pure meta-mutation functions directly, with no simulated SW process-termination timing). Would need a real browser/Playwright-driven test that forcibly suspends the SW between `respondWith` resolution and the next tick to observe the drop, or field telemetry on eviction frequency vs. 304-confirmation frequency.

---

## TRC3-03 — Real 404s (911cb0f5) now ship the site's default, fully-indexable metadata instead of the previous distinct not-found title + explicit noindex

**Severity:** Medium | **Confidence:** High

**File:line chain:**
- `apps/web/src/app/[locale]/layout.tsx:17-59` `generateMetadata` — sets `robots: { index: true, follow: true }` (`:54-57`) and `title: { default: seo.title, template: ... }` (`:24-27`) **unconditionally**, with no branch for a not-found descendant.
- `apps/web/src/app/[locale]/(public)/layout.tsx` — no `generateMetadata`/`metadata` export (grep-confirmed empty).
- `apps/web/src/app/[locale]/not-found.tsx:1-46` — no `generateMetadata`/`metadata` export at all; renders only UI (nav/main/footer with a localized "Page not found" heading).
- The four routes that now throw `notFound()` from `generateMetadata` — `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx` (diff: `notFound()` replacing `return { title: t('notFoundTitle') }`), `[topic]/page.tsx` (replacing `return { title, description }`), `c/[slug]/page.tsx` (replacing `return { title, robots: {index:false, follow:false} }`), `year/[year]/page.tsx` (replacing `return { title: tTopic('notFoundTitle'), robots: {index:false, follow:false} }`) — all four previously returned metadata with the not-found title, and TWO of them (`c/[slug]`, `year/[year]`) explicitly set `robots: {index:false, follow:false}`.
- Confirmed by the follow-up test commit `faa6f0e5`: `photo-og-metadata.test.ts` and `client-source-contracts.test.ts` only assert that `notFound()` is thrown (a rejection with the Next.js `NEXT_HTTP_ERROR_FALLBACK;404`/`NEXT_NOT_FOUND` digest) — neither asserts anything about the FINAL rendered `<title>`, `<meta name="description">`, or `<meta name="robots">` that ships on the resulting page. `e2e/not-found-status.spec.ts` likewise only checks `res.status()`.

**Hypothesis:** Next.js App Router metadata resolution merges parent-to-child across the segment tree; when a segment (page or layout) throws `notFound()`, resolution stops at that point and Next renders the nearest `not-found.tsx` for the BODY, but the metadata actually served is whatever was already resolved from ancestor layouts — nothing from the segment that threw, and nothing from `not-found.tsx` unless it exports its own metadata (it doesn't here). So the final `<head>` for every 404'd page is now exactly the root layout's default: site title, site description, OG tags for the whole site, and `robots: index:true, follow:true`.

**Evidence for:** Directly confirmed by reading every file in the chain: no intermediate metadata override exists anywhere between the root layout and the four routes' own (now-aborted) `generateMetadata`. This is standard, well-documented Next.js App Router behavior (metadata resolution short-circuits on `notFound()`/`redirect()`/thrown errors, falling back to whatever ancestor metadata already resolved), not a hypothesis requiring further confirmation.

**Evidence against:** The PRIMARY SEO signal — the actual HTTP status code — is now correctly 404 for all four route classes (the stated goal of the fix, and the dominant signal major crawlers like Googlebot use for indexing decisions, generally outweighing on-page meta robots tags). So the regression here is a secondary/defense-in-depth layer, not the core problem the commit was fixing.

**Concrete failure scenario:** A crawler or SEO auditing tool (or a less consequential-but-real case: a social media unfurler hitting a stale/mistyped photo link) requests `/en/p/99999999`. It correctly receives HTTP 404. But the response body's `<title>` reads the SITE'S name (not "Photo not found"), the OG/Twitter card metadata describes the whole gallery (not the missing photo), and the `<meta name="robots">` tag says `index, follow` — i.e., a real 404 page that visually/structurally claims to be indexable, generic site content. Any tool or crawler pass that inspects meta robots independently of (or in addition to) the status code will see conflicting signals; the previously-shipped explicit `noindex` on 2 of these 4 routes is now gone entirely.

**Suggested fix:** Give `apps/web/src/app/[locale]/not-found.tsx` its own `generateMetadata`/`metadata` export setting `robots: { index: false, follow: false }` and a translated not-found title (e.g., reusing the existing `notFound.description`/similar keys already used in the page body) — this restores the previous SEO signal while keeping the now-correct HTTP status, and doesn't require touching the four route-level `generateMetadata` functions at all since a `not-found.tsx` metadata export applies to any route that resolves to it.

**Remaining uncertainty / next probe:** None needed to confirm the gap — worth an e2e assertion (extending `not-found-status.spec.ts`) checking the response body's `<title>` and `<meta name="robots">` content once the fix lands, to prevent regression.

---

## TRC3-04 — migrate.js's FDR-01 fix (b4e986c3) only fully solves the PURE "new migrations pending" case; a MIXED case (genuine legacy drift below the cursor co-occurring with a new migration above it) still silently baselines the new migration without executing its SQL — now merely accompanied by a console.warn

**Severity:** Medium | **Confidence:** High (mechanism, directly confirmed by reading the exact diff); Low-Medium (real-world trigger likelihood)

**File:line chain:**
- `apps/web/scripts/migrate.js:764-838` `prepareLegacyDatabaseIfNeeded`. The new logic (`:807-816`) computes `cursor` via `SELECT MAX(created_at)` and takes the "leave unbaselined, let drizzle apply" fast path (`:812-816`) **only when `missing.every((m) => Number(m.folderMillis) > Number(cursor))`** — i.e., only when EVERY missing journal entry sits strictly above the cursor.
- If even ONE missing entry is at-or-below the cursor (the drift case this repo has hit before — see CLAUDE.md's migration runbook on non-monotonic `when` timestamps), the `every(...)` check fails and control falls through to the reconcile+baseline-all path (`:836-837`), UNCHANGED from before this commit for that path.
- The new warning (`:827-835`) correctly identifies and NAMES any above-cursor entries caught in this fallthrough (`swallowedTail`, `:828`) — but only **logs** them; `baselineAllJournalMigrations(connection, migrations)` at `:837` still inserts hash rows for **every** entry in `migrations` not yet recorded, including the swallowed-tail ones, exactly as before this fix. Their `.sql` never executes; only `reconcileLegacySchema`'s idempotent DDL mirror runs.
- The `runMigrations` post-condition (`:840-861`) only checks `recordedHashes.has(m.hash)` (`:850-851`) — hash presence, not SQL execution — so it PASSES for a swallowed-tail entry exactly as the pre-fix code's "structurally unreachable" bug described, just with an earlier warning line that could be missed in deploy log noise.
- Confirmed untested: `apps/web/src/__tests__/migrate-pending-migrations.test.ts:106-122` ("still routes true drift... to reconcile + baseline") only exercises a 2-entry journal with ONE missing hash below the cursor — no test constructs a 3-entry journal with a missing hash both below AND above the cursor simultaneously, which is the exact scenario that reproduces the swallowed-SQL bug.

**Hypothesis:** The fix correctly handles the common/expected case (a healthy DB, cursor tracking correctly, and a brand-new migration added on top) but the "mixed" precondition — some historical drift still present in `__drizzle_migrations` at the same time a genuinely new migration is added — reproduces the original defect this commit's message describes, merely with a printed warning instead of total silence.

**Evidence for:** Directly confirmed by static reading of the exact control flow and the exact post-condition check; not speculative.

**Evidence against:** Requires a specific compound precondition: `__drizzle_migrations` already has rows (cursor is non-null) AND some already-committed-and-recorded migration row is somehow missing/never-recorded at-or-below that cursor (out-of-band DB surgery, an interrupted prior baseline run, or a very old install that predates ALL current hash-tracking) AND a brand-new migration is added in the SAME deploy. Narrower than the pure case this commit targets; the repo's OWN documented history (CLAUDE.md's migration runbook) shows this compound scenario has precedent (the original non-monotonic-timestamp incident), so it's not purely theoretical, but it is a corner case rather than the routine path.

**Concrete failure scenario:** An operator's production DB has legacy drift from before the per-entry-hash-baseline mechanism existed (or from a partially-completed prior repair). A new migration ships with a DML backfill (e.g., populating a new column for existing rows) in the same deploy that also needs to repair that drift. `prepareLegacyDatabaseIfNeeded` sees the mixed missing-hash set, takes the reconcile+baseline-all path, prints the warning naming the new migration as "baselined without executing," and baselines it anyway. `runMigrations`'s post-condition passes (the hash IS present). The deploy reports success. The new migration's DML backfill silently never runs on this specific database, and unless an operator is watching deploy logs closely for a `WARNING:` line buried among the rest of the migration/reconcile output, this goes unnoticed — identical operator experience to the bug this commit was written to close.

**Suggested fix:** In the mixed case, still let drizzle apply the swallowed-tail (above-cursor) entries' actual SQL instead of baselining them: e.g., baseline only the at-or-below-cursor drift entries, leave the above-cursor entries' hashes unrecorded (matching the pure-case fast path), and let `runMigrations`'s subsequent `migrate(db, ...)` call apply them for real. This requires splitting `baselineAllJournalMigrations`'s input to exclude the swallowed-tail set rather than baselining `migrations` (all of them) unconditionally.

**Remaining uncertainty / next probe:** None needed to confirm the gap exists; the fix would benefit from a new test mirroring `migrate-pending-migrations.test.ts:106` but with a 3-entry journal (missing below AND above cursor) asserting the above-cursor entry is NOT baselined even in the mixed case.

---

## TRC3-05 — The new nginx public-page rate limiter (af3b2f7d) inherits the same LB-fronted blind spot as the pre-existing login/admin zones, and extends its blast radius from a narrow auth surface to all public traffic

**Severity:** Medium-High (contingent on unconfirmed topology) | **Confidence:** High (mechanism); ties to the still-open C1-11 operator-confirmation item

**File:line chain:**
- `apps/web/nginx/default.conf:1-10` — `limit_req_zone $binary_remote_addr zone=login:10m rate=10r/m;` / `zone=admin:10m rate=30r/m;` (pre-existing) and the NEW `zone=public:10m rate=10r/s;` (`:10`, added by `af3b2f7d`), applied at the catch-all `location /` (`:265` `limit_req zone=public burst=40 nodelay;`).
- `nginx/default.conf:39-51` — the existing "X-Forwarded-For TOPOLOGY CONTRACT" comment (from cycle-1's C1-11 remediation, `WP9`) documents that every location OVERWRITES `X-Forwarded-For` with `$remote_addr`, and that an LB-fronted topology requires switching to `$proxy_add_x_forwarded_for` plus adjusting `TRUSTED_PROXY_HOPS`. This comment's remediation is scoped to the APP's own per-IP tracking (it says "EVERY per-IP rate limit in the app collapses into one shared bucket").
- **What that remediation does NOT fix:** `$remote_addr` and `$binary_remote_addr` (used directly in all three `limit_req_zone` directives) are governed by nginx's `ngx_http_realip_module` (`set_real_ip_from` / `real_ip_header`), a COMPLETELY SEPARATE mechanism from `proxy_set_header X-Forwarded-For`. Grep-confirmed: `nginx/default.conf` has no `set_real_ip_from` or `real_ip_header` directive anywhere. Switching the `proxy_set_header` lines to `$proxy_add_x_forwarded_for` (the documented C1-11 fix) changes what the APP receives in the `X-Forwarded-For` header; it does **nothing** to nginx's own view of `$remote_addr`, which remains the LB's IP regardless.
- `apps/web/src/lib/request-origin.ts` (read in full) confirms the app-side header-trust logic is entirely separate from nginx's rate-limit key selection — there is no code path anywhere that could compensate for nginx's own limiter using the wrong IP.

**Hypothesis:** If the (still operator-unconfirmed, per cycle-1 C1-11) production topology has a TLS-terminating load balancer connecting to this nginx instance from its own IP (rather than nginx being the true public edge or a PROXY-protocol-aware LB), then `$binary_remote_addr` at nginx is the LB's single IP for every visitor. All three `limit_req_zone` buckets — login, admin, and now public — collapse every distinct visitor sharing that LB into ONE shared rate-limit bucket, independent of and unfixable by the documented C1-11 remediation.

**Evidence for:** Directly confirmed by reading the nginx config (no `real_ip_header`), and by nginx's own documented behavior that `$remote_addr`/`$binary_remote_addr` are TCP-peer-derived unless `ngx_http_realip_module` directives are configured to recompute them from a trusted header. This is an nginx architecture fact, not a hypothesis needing runtime confirmation.

**Evidence against:** Depends entirely on the still-unconfirmed edge topology (same caveat cycle-1's C1-11 carries; if nginx IS the true public edge or sits behind a PROXY-protocol-aware LB — which preserves the real source IP at the TCP level, before nginx ever sees the connection — this doesn't apply at all). Also: even in the worst case, the failure mode is 429s for legitimate shared-IP traffic (availability degradation), not a security bypass or data exposure.

**Concrete failure scenario (if LB-fronted):** Post-deploy, an operator applies `af3b2f7d`'s nginx config (a manual step — deploys don't touch host nginx, per the commit message). If an LB fronts this nginx instance, EVERY visitor to the site — not just would-be attackers — now shares one `10r/s + burst 40` budget for the ENTIRE public page surface (home, topic, photo, map, timeline, year-in-review, smart collections). A handful of concurrent visitors browsing normally (each triggering their own same-page RSC/prefetch fetches, as the comment at `:265-280` itself acknowledges: "same-URL RSC/prefetch fetches Next issues for that page") can plausibly exhaust the shared burst budget, causing OTHER unrelated visitors to receive edge-level 429s for ordinary page loads — a more consequential and more probable manifestation of the same root cause than the pre-existing tight `login` zone (10r/m + burst 5), which mainly punished repeated failed-login attempts from one apparent source.

**Suggested fix:** Resolve the C1-11 topology question first (operator confirmation, as already tracked). If LB-fronted, the fix needs BOTH halves: (a) the already-documented `$proxy_add_x_forwarded_for` + `TRUSTED_PROXY_HOPS` change for the app layer, AND (b) `set_real_ip_from <LB source IP/CIDR>; real_ip_header X-Forwarded-For;` (or the LB's actual forwarded-for equivalent / PROXY protocol support) so nginx's OWN `$remote_addr` — and therefore all three `limit_req_zone` buckets — reflects the real client IP too. Consider documenting this second half explicitly in the topology-contract comment so a future reader doesn't assume the existing remediation is complete.

**Remaining uncertainty / next probe:** Same as cycle-1 C1-11 — requires operator confirmation of the actual edge topology; not observable from the repository alone.

---

## TRC3-06 (minor/nit) — `PROCESSING_RETRY_DELAY_MS` backoff comment claims "escalating up to 25s" but `MAX_RETRIES = 3` caps the achievable delay at 10s

**Severity:** Low | **Confidence:** High

**File:line chain:** `apps/web/src/lib/image-queue.ts:601` `const MAX_RETRIES = 3;` vs. `:865` `const delay = PROCESSING_RETRY_DELAY_MS * Math.min(retries, 5); // escalating up to 25s`. With `MAX_RETRIES = 3`, `retries` only ever reaches 1 then 2 before permanent failure at attempt 3 (`retries < MAX_RETRIES` gates the retry path) — so the realized delay sequence is 5000ms then 10000ms; the `Math.min(retries, 5)` ceiling (and the "up to 25s" comment) is copy-pasted verbatim from the claim-retry path (`:611-612` `MAX_CLAIM_RETRIES = 10`, where `retries` genuinely can reach 5+ and 25s is reachable).

**Evidence for:** Directly confirmed by reading both constants and the retry-gating condition; not speculative.

**Evidence against:** Purely cosmetic — the `Math.min(retries, 5)` clamp is harmless dead code for this path (never reached), and the actual escalating-backoff BEHAVIOR (the substantive fix, C2-32) is correct and tested (`image-queue-processing-retry-backoff.test.ts:134-151` confirms 5000ms then 10000ms).

**Suggested fix:** Trivial doc fix — change the comment to "escalating up to 10s" (or drop the now-inapplicable `Math.min(retries, 5)` clamp since `MAX_RETRIES=3` never lets `retries` exceed 2) to avoid a future reader assuming a 25s worst case applies here.

---

## Flows traced (full list)

1. **Upload → claim → Sharp fan-out → DB update → cleanup**, focused on `02bea8d6`'s five sub-fixes — `apps/web/src/lib/image-queue.ts` (full file read), `apps/web/src/app/actions/images.ts` upload/retry paths, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/process-image.ts` (verify-then-update tail). Confirmed C2-08/C2-10/C2-33 fully closed; C2-32's backoff correct in substance (TRC3-06 nit only); C2-34's scan cap has the cross-invocation gap in TRC3-01.
2. **Service-worker image caching 304 revalidation**, `bf5a4da9` — `apps/web/public/sw.template.js` (full file), `apps/web/src/lib/sw-cache.ts` (full file), `apps/web/src/__tests__/sw-cache.test.ts` (read for coverage gaps). Body/header desync ruled out (Cache API match() semantics + no double-read); async-write durability gap found (TRC3-02).
3. **404 metadata flow**, `911cb0f5` / `faa6f0e5` — the four new `layout.tsx` files (`[topic]`, `p/[id]`, `c/[slug]`, `year/[year]`), their sibling `page.tsx` `generateMetadata` diffs, `apps/web/src/app/[locale]/not-found.tsx`, `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/(public)/layout.tsx`, the e2e and unit test follow-ups. HTTP-status fix confirmed correct; metadata-content regression found (TRC3-03).
4. **migrate.js legacy/fresh/partial/re-run paths**, `b4e986c3` — `apps/web/scripts/migrate.js` (`prepareLegacyDatabaseIfNeeded`, `runMigrations`, `baselineAllJournalMigrations`, `ensureMigrationTable` read in full), `apps/web/src/__tests__/migrate-pending-migrations.test.ts`. Pure-case fix confirmed correct; mixed-case residual gap found (TRC3-04); BIGINT cursor type hypothesis ruled out.
5. **Rate-limiter interplay**: nginx SSR limiter (`af3b2f7d`) + in-app limiters + `TRUST_PROXY` — `apps/web/nginx/default.conf` (full file), `apps/web/src/lib/request-origin.ts` (full file), `apps/web/src/lib/rate-limit.ts` (skimmed for IP-key derivation), CLAUDE.md's env var table for `TRUST_PROXY`/`TRUSTED_PROXY_HOPS`. Header-forwarding gap already tracked (C1-11); a distinct, unfixed-by-that-remediation nginx-native gap found and its blast radius traced to have grown with this commit (TRC3-05).
6. **Restore maintenance marker lifecycle across process restart** — confirmed zero commits touched `restore-maintenance*.ts`/`instrumentation.ts` in `642c5091..e08b6f97`; not re-traced (cycle-2's trace stands, `fa35fc78` only changed the message-selection branch in `db-actions.ts`, itself independently verified above as cleanly fixing cycle-2 TRC-05).
7. **(Self-selected) Single-writer boot guard**, `e39ad990` — `apps/web/src/lib/single-writer-guard.ts` (read via its test file `single-writer-guard.test.ts`, full 289 lines) — confirmed genuinely warn-only (never throws, never blocks boot, handles the mysql2 `Connection` EventEmitter's `'error'` event to avoid an unhandled-error process crash on a later connection drop). No issue found; well-tested.
8. **(Self-selected) Bulk embedding decode correctness**, `ea712cfc` — `apps/web/src/lib/clip-embeddings.ts` (`bufferToEmbedding`, full diff), both search routes' call sites (`apps/web/src/app/api/search/semantic/route.ts:292-309`, `apps/web/src/app/api/search/similar/[id]/route.ts:140-204`), and `node_modules/mysql2/lib/packet_parser.js` (traced buffer-allocation lifecycle to rule out pooled-buffer reuse corrupting a long-lived zero-copy view). No issue found; the "safe because transient" claim in the code comment is correct even for the one call site (`similar/[id]`) where the decoded view DOES outlive an intervening `await`.
