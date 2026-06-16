# Aggregate Review — GalleryKit (Run-6 Cycle 2)

**HEAD:** 8ccc8806 · **Date:** 2026-06-16 · **Reviewers:** 11 specialist agents (code-reviewer, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, document-specialist, designer)

**Method:** All 11 agents fanned out concurrently over the full `apps/web` source tree (~465 source files, ~233 test files). Each wrote its own provenance file in this directory. This aggregate dedupes overlapping findings (keeping the highest severity/confidence of any duplicate), notes cross-agent agreement (multi-agent findings are higher-signal), and records the orchestrator's own verification pass that **refuted or downgraded several findings** against live code.

**Headline:** This is an exceptionally mature, heavily-reviewed codebase. Across 11 specialist passes there are **0 Critical** and **0 confirmed-exploitable High security** findings. The genuine High findings are: one live customer-money gap (async Stripe payments — already documented + plan-tracked), one unbounded-analytics-growth operational risk, three latent resource/perf edges, and a small cluster of a11y/correctness fixes. Most of the value this cycle is in (a) a handful of real but low-blast-radius bugs, (b) a11y polish, (c) doc/code drift, and (d) test-coverage gaps on the DB rate-limit layer.

---

## Severity Roll-Up (post-dedupe, post-verification)

| Severity | Count | IDs (aggregate) |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 6 | AGG-H1 (async-pay money gap), AGG-H2 (unbounded `*_views`), AGG-H3 (SW LRU blob rewrite), AGG-H4 (getMapImages unbounded), AGG-H5 (serve-upload fd leak on abort), AGG-H6 (wide-gamut-hint JSON.parse crash) |
| MEDIUM | 12 | AGG-M1 … AGG-M12 |
| LOW | 14 | AGG-L1 … AGG-L14 |
| DOC/DRIFT | 6 | AGG-D1 … AGG-D6 |
| TEST GAPS | 3 | AGG-T1, AGG-T2, AGG-T3 |
| LATENT (CLIP dark-gated) | 4 | AGG-CL1 … AGG-CL4 |

**Cross-agent agreement (highest signal — flagged by 2+ agents independently):**
- **Async-payment money gap** — critic CRT-01 + debugger (Stripe surface) + security (verified the `payment_status==='paid'` gate). 3 agents.
- **SW LRU whole-blob rewrite/race** — perf PERF-01 (+ a prior tracer note).
- **`*_views` unbounded growth** — critic CRT-02 (+ architect coordination-state notes touch it).
- **HDR honesty invariant enforced indirectly** — critic CRT-05 + architect ARCH-02 (privacy-mirror surface).
- **Config sprawl / no central env module** — architect ARCH-04 (+ security SEC-03 TRUST_PROXY validation gap is a slice of it).
- **serve-upload COLOR_IMPACTING_KEYS stale comment** — document-specialist DOC-01 + verifier VER-01 (different framing, same drift).
- **search input `h-8` / touch-target audit blind spot** — designer DES-05 (downgraded, see verification) + prior-cycle live measurement.

---

## HIGH

### AGG-H1 — Async-payment customers are charged but never receive an entitlement/download
**Severity:** HIGH · **Confidence:** High · **Agents:** critic (CRT-01), security (gate verified), debugger
**Files:** `apps/web/src/app/api/stripe/webhook/route.ts`
The webhook handles `checkout.session.completed` and only proceeds on `payment_status === 'paid'`. There is **no** `checkout.session.async_payment_succeeded` / `async_payment_failed` handler. A SEPA/ACH/bank-transfer/OXXO/Boleto buyer gets `completed`+`unpaid` (no entitlement), the bank clears days later, `async_payment_succeeded` fires, GalleryKit ignores it → customer charged, no download row, no token, no access. CLAUDE.md and the `entitlements` schema note already document it and tie the full fix to plan-316 CRT-R5C1-04.
**Remediation (interim, this cycle):** Restrict Stripe Checkout to immediate-capture methods (`payment_method_types: ['card']`) so async methods can't even be initiated — closes the gap operationally in one config line until the full handler ships. Add a regression test (the gap is currently guarded only by a CLAUDE.md sentence). The full `async_payment_succeeded` handler stays deferred to plan-316.

### AGG-H2 — Anonymous `*_views` analytics writes are unbounded; no retention/prune job, no global write ceiling
**Severity:** HIGH · **Confidence:** High · **Agents:** critic (CRT-02), architect
**Files:** `apps/web/src/app/actions/public.ts` (record paths), `apps/web/src/lib/analytics.ts` (bot detection), `schema.ts` (`image_views`/`topic_views`/`shared_group_views`)
View-event INSERTs are limited per-IP only (`VIEW_RECORD_MAX_REQUESTS=120`/min, bounded map cap 2000 keys). No global write ceiling and **no scheduled prune** of these tables anywhere (the hourly job purges sessions/buckets/audit-log, not analytics rows). `isbot()` is UA-string-only — bot rows are still written, only excluded from counts. A residential-proxy pool of N rotating IPs each gets a fresh 120/min budget → unbounded durable INSERTs into the single MySQL writer, growing `image_views` + its composite indexes without bound, eventually disk pressure on the DB volume (Docker prune doesn't touch it).
**Remediation:** Add a retention/prune job (extend the hourly sweep or a cron) deleting `*_views` rows older than a configurable window (e.g. 13 months for year-in-review). Optionally a global per-minute anonymous-write ceiling. At minimum a documented manual `DELETE … WHERE viewed_at < …` runbook entry.

### AGG-H3 — Service-worker LRU re-sums + re-sorts + JSON-serializes the entire metadata blob on every image cache write
**Severity:** HIGH (perf/throughput) · **Confidence:** High · **Agents:** perf (PERF-01)
**Files:** `apps/web/public/sw.template.js:87,101-116,130-138`; reference `apps/web/src/lib/sw-cache.ts:95-141`
Every cached derivative triggers: full O(n) size-sum, O(n log n) sort once near the 50 MB cap (i.e. on essentially every write thereafter), and a whole-Map `JSON.stringify` back into one cache entry. With ~60-250 steady-state entries this is SW-thread work per cached image; on low-end Android it adds scroll-prefetch jank. Concurrent fetches racing `getAll()`→mutate→`setAll()` also lose writes (last-writer-wins on the single blob), under-counting cache size and weakening the cap.
**Remediation:** Keep a running `total` counter (no re-sum); rely on Map insertion order for head-walk eviction (no full sort); batch/debounce `setAll` so a burst coalesces into one write. The lost-update race is inherent to whole-blob-in-one-entry (acceptable for best-effort cache); the O(n log n)-per-write is the avoidable part. **Requires SW_VERSION re-stamp + sw.js regen after the template edit** and the `sw-template-contract.test.ts` pin must be kept green.

### AGG-H4 — `getMapImages()` is an unbounded, un-`LIMIT`ed query with two unindexed `IS NOT NULL` GPS predicates
**Severity:** HIGH · **Confidence:** High · **Agents:** perf (PERF-03)
**Files:** `apps/web/src/lib/data.ts:1565-1593`; caller `app/[locale]/(public)/map/page.tsx:33`; index inventory `db/schema.ts`
`images INNER JOIN topics WHERE processed=true AND topics.map_visible=true AND latitude IS NOT NULL AND longitude IS NOT NULL` with **no `.limit()`**. `latitude`/`longitude`/`topics.map_visible` are unindexed; only the `processed` prefix is usable. Combined with `revalidate=0` (every hit dynamic), every public `/map` hit materializes the full GPS-bearing set + topic labels into memory and ships it in one payload, growing linearly with the gallery. The single most concrete public unbounded-result path.
**Remediation:** Add a `.limit()` (with viewport-bbox filtering or server-side clustering for large galleries). Consider a short TTL cache instead of `revalidate=0` for map data. (Index on `IS NOT NULL` helps little in MySQL — the bound is the real lever.)

### AGG-H5 — `serve-upload.ts` read stream fd not destroyed on client abort mid-transfer
**Severity:** HIGH (resource leak) · **Confidence:** High · **Agents:** debugger (DBG-H3)
**Files:** `apps/web/src/lib/serve-upload.ts:251-256`
`createReadStream(resolvedPath)` opens an OS fd; `Readable.toWeb()` wraps it into the response. The `destroy()` in the `catch` block only handles setup errors, NOT mid-transfer aborts (browser navigation/back/connection drop). On abort the Node stream isn't destroyed until GC. Under masonry-grid concurrent loads + rapid navigation, fds accumulate toward the OS limit (1024 default on many Linux). Large AVIFs make aborts more likely. NOTE: this is the serve-upload path (locale-prefixed + files-missing-from-public); the static-server path is separate.
**Remediation:** Wire the request's abort signal (`request.signal` / a `close`/`aborted` listener) to call `fileStream.destroy()` on abort. Verify the abort plumbing actually fires in the Next.js 16 route-handler streaming model before claiming the fix (don't ship a no-op shim).

### AGG-H6 — `wide-gamut-hint.tsx` unguarded `JSON.parse(localStorage)` crashes the photo-viewer React subtree
**Severity:** HIGH (user-visible crash) · **Confidence:** High · **Agents:** debugger (DBG-M2 — "confirmed crash path / top-3-most-likely-to-bite")
**Files:** `apps/web/src/components/wide-gamut-hint.tsx:40`
`const parsed = JSON.parse(raw) as PersistedDismiss;` where `raw = localStorage.getItem(...)`. A user can write arbitrary strings to their own localStorage, and a truncated write yields invalid JSON → `SyntaxError` propagates uncaught and crashes the subtree containing `WideGamutHint`. The photo viewer mounts this; without an error boundary above it, the entire photo page collapses for that user until they clear localStorage. Purely client-state-driven (no server degradation needed), hence promoted to HIGH here.
**Remediation:** `try { parsed = JSON.parse(raw) } catch { parsed = null /* treat as fresh */ }`.

---

## MEDIUM

### AGG-M1 — Wide-gamut downscale warning uses hardcoded `50_000_000` instead of `uploadConfig.wideGamutMaxSourcePixels`
**Confidence:** High · **Agents:** debugger (DBG-H2)
**File:** `apps/web/src/app/actions/images.ts:298`
`uploadConfig` is already fetched (line 177) and exposes `wideGamutMaxSourcePixels`, but the warning check hardcodes `50_000_000`. An admin who tunes the cap (to 20M or 100M) gets upload warnings that disagree with actual encoder behavior. Photographer-visible semantic mismatch (a wrong warning, not a wrong encode → MEDIUM). **Fix:** use `uploadConfig.wideGamutMaxSourcePixels`.

### AGG-M2 — `sharedGroups.view_count` denormalized counter structurally diverges from the durable `shared_group_views` event log
**Confidence:** High · **Agents:** critic (CRT-03), architect (ARCH-01 — the buffer subsystem)
**Files:** `apps/web/src/lib/data.ts` (~1266 buffer), `app/actions/public.ts` (~392 durable INSERT)
Two counters of the same quantity with different durability: the in-memory buffered `view_count` (drops on SIGKILL/OOM) and the durable event-log INSERT. The denormalized column drifts downward after every hard crash and never self-heals. (Graceful SIGTERM IS handled — see Refuted #1.) CLAUDE.md honestly labels it "best-effort approximate," so this is a design smell at the documented contract, not a correctness bug. **Remediation:** derive `view_count = COUNT(*) FROM shared_group_views WHERE bot=false` via a periodic reconcile (buffer becomes a self-healing latency optimization), or document which counter is authoritative. **Lower urgency given the honest doc label — deferral candidate.**

### AGG-M3 — HDR public badge gated indirectly by field-nullness, not by an explicit `isAdmin` check
**Confidence:** Medium · **Agents:** critic (CRT-05), architect (ARCH-02)
**Files:** `components/color-details-section.tsx:169,511`; same pattern in `lightbox-color-pip.tsx`, `info-bottom-sheet.tsx`
`isHdr = transfer_function === 'pq' || 'hlg'` and the badge renders on `{isHdr && …}` — NOT gated on `isAdmin`. It's only false for the public today because `transfer_function`/`is_hdr` are stripped from `publicSelectFields` (a coincidence two layers away). The `_PrivacySensitiveKeys` compile guard protects the select layer, but the moment any future feature surfaces `transfer_function` publicly, the HDR honesty invariant (no public HDR badge until WI-09) breaks with **no test catching it**. **Remediation:** gate the public badge on `isAdmin && isHdr` explicitly + add a test rendering with `is_hdr=true, isAdmin=false` asserting no `.hdr-badge`.

### AGG-M4 — `motion-safe:` not applied to `group-hover:scale-105` image zoom on every photo card
**Confidence:** High · **Agents:** designer (DES-01)
**Files:** `components/home-client.tsx:355,370`, `on-this-day-widget.tsx:72`, `(public)/year/[year]/page.tsx:190`, `(public)/timeline/page.tsx:238`, `(public)/g/[key]/page.tsx:230`
Every card uses `transition-transform duration-500 group-hover:scale-105` unconditionally. Users with `prefers-reduced-motion: reduce` still get the spatial zoom on hover. The lightbox/photo-viewer correctly guard Ken Burns/slide via `useReducedMotion()`, but these Tailwind-only hover animations bypass that. WCAG 2.3.3 (AAA). **Remediation:** `motion-safe:` prefix (6 files), OR a single `globals.css` `@media (prefers-reduced-motion: reduce)` rule neutralizing `.group:hover img` transform — one edit, also covers DES-08 (caption fade). NOTE: globals.css already has a reduced-motion block (`animation-duration:0.01ms`); extend it to cover `transform`/`transition` on hover, OR use the per-class `motion-safe:` approach.

### AGG-M5 — Admin dialog/sheet close-button label hardcoded English `"Close"` (Korean a11y gap)
**Confidence:** High · **Agents:** designer (DES-02) — VERIFIED (`ui/dialog.tsx:53`, `ui/sheet.tsx:51` both `closeLabel = "Close"`, rendered in an `sr-only` span)
Every admin dialog/sheet whose call site doesn't pass `closeLabel` (the common shadcn pattern) announces "Close" to Korean screen-reader users. WCAG 3.1.2 (AA). **Remediation:** thread the i18n `t('common.close')` fallback into the primitives (client wrapper / provider), or make `closeLabel` required and pass a translated value at every call site. Confirm a `common.close` key exists in both `en.json`/`ko.json` (add if missing — keep parity).

### AGG-M6 — `tag-input.tsx` text field `outline-none` with no `focus-visible` replacement ring
**Confidence:** High · **Agents:** designer (DES-04) — VERIFIED (`tag-input.tsx:199` bare `<input className="flex-1 ... outline-none ...">`, no ring)
The primary admin tag-entry control suppresses the browser outline with no `focus-visible:ring-*` replacement, unlike every other interactive element. Keyboard-only admin users get no focus indicator. WCAG 2.4.7 / 2.4.11 (AA). **Remediation:** add `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded` to the input.

### AGG-M7 — Per-photo OG route fetches a request-Host-derived origin (theoretical SSRF / cache-poison)
**Confidence:** Medium · **Exploitability:** Theoretical (needs TRUST_PROXY misconfig / unvalidated Host) · **Agents:** security (SEC-01)
**Files:** `app/api/og/photo/[id]/route.tsx:103` → `lib/og-photo-fetch.ts:50-54`
`origin = new URL(req.url).origin` feeds a server-side `fetch(\`${origin}/uploads/jpeg/<uuid>\`)`. In a correctly-configured deploy `origin` is canonical and the path is a validated UUID derivative — safe. If a fronting proxy forwards an arbitrary `Host`/`X-Forwarded-Host`, the OG generator could be coerced to fetch `http://attacker/uploads/jpeg/<uuid>.jpg` (blind, 10s timeout, 1MB cap, only decoded into a Satori canvas — weak primitive). **Remediation:** derive the internal fetch base from a trusted source (`seo.url` / env `INTERNAL_ORIGIN`), not the request Host.

### AGG-M8 — `check-api-auth` lint gate scans only `src/app/api/admin/**` (coverage gap for a misplaced privileged route)
**Confidence:** High · **Exploitability:** N/A today (no such route) · **Agents:** security (SEC-02)
**File:** `apps/web/scripts/check-api-auth.ts:17`
The `withAdminAuth` gate recurses only under `api/admin/`. A future privileged route placed elsewhere (`api/internal/purge`) ships unscanned, and middleware excludes `/api/*` so there's no backstop. **Remediation:** broaden the scanner to flag any `route.*` under `api/**` referencing privileged ops without `withAdminAuth`, OR enforce/document "all privileged routes live under /api/admin/" as an invariant (mirror the public-route-rate-limit exempt-comment pattern).

### AGG-M9 — `getImagesForFeed()` ORDER BY `updated_at` cannot use any index (filesort + temp table)
**Confidence:** High · **Agents:** perf (PERF-07)
**File:** `apps/web/src/lib/data.ts:771-794`; callers `feed.xml/route.ts:40`, `[topic]/feed.xml/route.ts:62`
Orders by `desc(updated_at),…` but no index has `updated_at` as a prefix; the `GROUP_CONCAT` forces a temp table. Bounded to 50 output rows but the sort spans the full filtered set. Low call rate (crawlers). **Remediation:** add index `(processed, updated_at, created_at)`, OR accept the filesort at personal scale and document the deliberate omission. **Deferral candidate given low cadence.**

### AGG-M10 — `searchImages()` leading-wildcard `LIKE '%term%'` across 6 unindexed columns
**Confidence:** Medium · **Agents:** perf (PERF-09)
**File:** `apps/web/src/lib/data.ts:1404-1543`
Leading wildcards defeat every B-tree prefix; no FULLTEXT index. Every public search full-scans the processed set evaluating 6 LIKE predicates/row (per-IP 30/min caps abuse; fast at personal scale, linear growth). **Remediation:** add MySQL `FULLTEXT` over `(title, description, camera_model, lens_model)` + `MATCH … AGAINST` (LIKE fallback). **Deferral candidate at current scale.**

### AGG-M11 — Upload-path N+1: sequential `await ensureTagRecord()` per tag (upload + `batchUpdateImageTags`)
**Confidence:** Medium · **Agents:** perf (PERF-05, PERF-06)
**Files:** `app/actions/images.ts:399-415`, `app/actions/tags.ts:397-425`
One DB round-trip per tag, sequentially; `batchUpdateImageTags` does it inside the transaction (holding row locks). Deliberate correctness-over-throughput (slug-collision races make naive `Promise.all` non-trivial). **Remediation:** pre-resolve existing tags in one `WHERE slug IN (...)`, then sequentially create only the misses; batch-INSERT `imageTags`. **Deferral candidate at personal scale.**

### AGG-M12 — `bootstrapImageProcessingQueue` resets the hourly GC interval on every continuation batch
**Confidence:** Medium · **Agents:** debugger (DBG-M1)
**File:** `apps/web/src/lib/image-queue.ts:698-705`
Each successful bootstrap batch `clearInterval` + re-arms a fresh 1-hour GC timer. Processing 10k pending images (20 batches) continuously resets the timer so `purgeExpiredSessions`/`purgeOldBuckets`/`purgeOldAuditLog` never fire during the bootstrap window, delaying them beyond the intended cadence. **Remediation:** arm `state.gcInterval` once (`if (!state.gcInterval)`).

---

## LOW

- **AGG-L1** — `backfillClipEmbeddings` server action is dead (no caller) AND hardcodes `embedImageStub`/`STUB_MODEL_VERSION`, diverging from the two authoritative mode-aware embedding writers. If wired to a UI in production mode it'd write rows the production search ignores. (code-reviewer CR-01) **Fix:** delete OR make mode-aware + comment "no UI wires it yet". CLIP-adjacent, dark-gated — safe today.
- **AGG-L2** — Lossless GPS strip returns lenient `false` ("no GPS") instead of conservative `null` (anomaly→re-encode) when a TIFF block has a zero IFD0 offset, inconsistent with the module's own fail-safe doctrine. (code-reviewer CR-02) **Fix:** `if (ifdAbs === tiffStart) return null;` (`gps-exif-strip.ts:147-149`). Not a demonstrable leak (orphan GPS bytes are unreferenced), tightens consistency.
- **AGG-L3** — `check-action-origin`/`check-api-auth` `continue` past non-`async` exported handlers — coverage hole in the same-origin/auth net (unreachable today because Next.js forces async server actions). (code-reviewer CR-03) **Fix:** flag non-async mutating exports as failures.
- **AGG-L4** — `flushGroupViewCounts` backoff counter resets on any partial success, so backoff never engages for consistently-failing groups during partial DB degradation. (debugger DBG-M3) Analytics-only. `data.ts:152-157`.
- **AGG-L5** — `_verifyWebpIccChunk` reads the entire WebP file into memory then uses only 1 KB; ~`concurrency×3×filesize` transient waste under peak. (debugger DBG-M4) **Fix:** `fileHandle.read(buf,0,1024,0)`.
- **AGG-L6** — `admin-tokens.ts:120` `JSON.parse` result used without shape validation; corrupt `admin_settings` row → TypeError. Requires DB write access (robustness, not security). (debugger DBG-M5)
- **AGG-L7** — `getTrustedRequestProtocol` defaults to `'http'`; a TLS staging deploy without `NODE_ENV=production` + dropped proto headers mints a non-Secure session cookie. (security SEC-03) **Fix:** fail closed to Secure when Origin/Referer are HTTPS; document TRUST_PROXY+NODE_ENV. `request-origin.ts:45-53`.
- **AGG-L8** — `permanentlyFailedIds` Set never cleared on `deleteImage` → unbounded growth on long-running servers; pathological auto-increment ID reuse could silently skip a re-uploaded image. (tracer TRC-01, debugger DBG-L1) `image-queue.ts` + `images.ts`.
- **AGG-L9** — Admin login form: no `aria-invalid`/`aria-describedby` wiring for server auth errors (errors only via toast, not field-associated). (designer DES-03) WCAG 3.3.1/3.3.3. `admin/login-form.tsx:56,76`.
- **AGG-L10** — `<main tabIndex={-1} className="...focus:outline-none">` suppresses focus ring for ALL focus, not just programmatic skip-link focus. (designer DES-06) **Fix:** `focus-visible:outline-none`. `(public)/layout.tsx:12`. (Widely-accepted shadcn pattern; low priority.)
- **AGG-L11** — `lightbox-color-pip.tsx` cycle-mode/copy buttons use `ring-1` not `ring-2` (inconsistent with the lightbox toolbar; likely fails WCAG 2.4.11 2px-perimeter on `bg-black/70`). (designer DES-07) Lines 186, 268.
- **AGG-L12** — `<OnThisDayWidget>` not wrapped in `<Suspense>` (unlike `<TagFilter>`); a slow/failing DB query cascades to the whole page render. (designer DES-10) `(public)/page.tsx:223`. **Fix:** Suspense + Error Boundary.
- **AGG-L13** — `admin-backfill.ts:67-68` returns raw runner error (`result.reason`, can carry SQL/driver text) to the admin toast, unlike sibling actions that localize+log. Admin-only surface. (code-reviewer CR-05) **Fix:** log detail server-side, return localized generic.
- **AGG-L14** — OFFSET-based pagination retained on `getImages`/`getImagesLitePage`/`getAdminImagesLite` (deep-offset O(K·pageSize) cost); keyset cursor machinery already exists. (perf PERF-10) **Fix:** route list pagination through the existing cursor. **Deferral candidate.**

Additional LOW perf items (deferral candidates at personal scale): PERF-08 (`getFailedImages` unindexed filter/sort, no LIMIT), PERF-11/12 (`getAdminTags`/`getAdminUsers` no LIMIT), PERF-13 (`getTopics` correlated MAX subquery), PERF-14 (touch swipe `setState` per touchmove), PERF-15 (`getBoundingClientRect` in wheel handler), PERF-18 (login two-round-trip rate-limit read). Code-reviewer nits CR-04 (migrate-aliases no `connection.end()`), CR-06 (duplicated FIFO-eviction idiom).

---

## DOC / CODE DRIFT

- **AGG-D1 (HIGH-drift)** — `serve-upload.ts:187-190` inline comment lists only **3** COLOR_IMPACTING_KEYS; actual is **9**. (document-specialist DOC-01, verifier VER-01) CLAUDE.md line 263 is already correct. **Fix:** update the comment to "all 9 (see settings-hash.ts)" and drop the drifting enumeration.
- **AGG-D2** — CLAUDE.md line 261 says serve-upload "executes only for locale-prefixed URLs"; actually **two** route handlers call `serveUploadFile` — `app/uploads/[...path]` (non-locale, primary for SW HEAD checks) AND `app/[locale]/(public)/uploads/[...path]`. (document-specialist DOC-03) **Fix:** correct the wording to name both.
- **AGG-D3** — CLAUDE.md line 135 `transfer_function` values omit `gamma24` (NCLX 14/15, BT.1886) and `gamma26` (NCLX 17, DCI-P3), which the resolver emits for real files; internally inconsistent with the NCLX summary at line 232. (document-specialist DOC-02) **Fix:** add `gamma24`/`gamma26`, drop the misleading "(NCLX)" since `gamma18` is ICC-only.
- **AGG-D4** — Admin-tunables table (CLAUDE.md) omits `image_quality_webp`/`avif`/`jpeg` even though they're in `COLOR_IMPACTING_KEYS` and byte-impacting. (critic CRT-D2, verifier VER-01) **Fix:** add the 3 quality rows (and note `image_sizes` is also a COLOR_IMPACTING_KEY).
- **AGG-D5** — CLAUDE.md "Runtime topology" line-194 coordination-state enumeration omits the admin-backfill-runner status and the in-memory rate-limit buckets; the static-path-cache gotcha (CRT-D1) could be misread as "settings flip invalidates everywhere." (architect ARCH-07, critic CRT-D1) **Fix:** extend the line-194 sentence; add one explicit sentence that flipping a color/quality/size setting does NOT invalidate already-served static derivatives until a backfill re-encode.
- **AGG-D6 (LOW)** — `schema.ts:259/266` comment claims the embedding column stores raw "2048 bytes" binary; code stores **base64 TEXT** in the mediumblob (round-trips correctly — the prior CRITICAL fix). ALSO route docstrings (`semantic/route.ts`, `similar/[id]/route.ts`) say `PRODUCTION_COSINE_THRESHOLD (0.25)`; actual is `0.22`. Plus NCLX matrix codes 8/10 omitted from CLAUDE.md line 232 (DOC-05) and `avif_10bit` missing from the images column table (DOC-06). (debugger DD-1/DD-2, document-specialist DOC-05/06) CLIP-dark + comment-only. **Fix:** correct all comments.

---

## TEST GAPS

- **AGG-T1 (HIGH)** — `incrementRateLimit`/`decrementRateLimit`/`resetRateLimit` (`lib/rate-limit.ts:419-502`) have **zero** unit tests. `decrementRateLimit`'s transactional UPDATE-`GREATEST(count-1,0)`-then-DELETE shape is correctness-critical (rollback-on-navigation guarantee); removing the `GREATEST()` guard or the transaction would go uncaught. (test-engineer TEST-01, TEST-04) **Fix:** add `__tests__/rate-limit-db.test.ts` asserting INSERT-onDup increment, the transaction wrap, `GREATEST()`, and the DELETE.
- **AGG-T2 (HIGH)** — `rollbackLoginRateLimit` (IP-scoped, `lib/auth-rate-limit.ts`) is untested (only the account-scoped sibling is). The count=1→delete transition that clears the IP bucket has no coverage; silent removal of the delete would leak buckets and tighten the effective window. (test-engineer TEST-02) **Fix:** add the two scenarios to `auth-rate-limit.test.ts`.
- **AGG-T3 (MEDIUM)** — `getSessionSecret` INSERT-IGNORE + re-fetch (dev/test fallback) branch never exercised. (test-engineer TEST-03) **Fix:** mock `findFirst` null-then-value, assert insert called once + returned secret matches re-fetch.

Lower test items: TEST-05 (advisory-lock double-release idempotency source-asserted not behavioral), TEST-06 (semantic-search route has no source-contract test for the disabled-mode guard), and `image-queue-quiesce.test.ts:136` real 60s no-op timer without fake-timers (no assertion impact, but the timer hangs in the worker — add cleanup).

---

## LATENT (CLIP dark-gated — code/test/doc-only; DO NOT activate)

Real but inert today (default `semantic_search_mode='disabled'`, healed from `'production'` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`). Fix the code/tests/docs; do NOT enable the feature, do NOT seed weights, do NOT set the env, do NOT run `--production` backfill.

- **AGG-CL1** — `/api/search/similar/[id]` loads ≤5000 embeddings (~10 MB) + ~5M float ops synchronously on the event loop, no ANN index; full linear scan per call. Same shape in `/api/search/semantic`. (perf PERF-02) **Fix BEFORE any enablement:** chunk/yield the scan off the loop, or push cosine into MySQL / a vector index.
- **AGG-CL2** — Runtime loader `clip-model.ts:63-71` performs NO checksum on the on-disk ONNX (the downloader does). A partial/truncated model surviving on the volume loads unverified → opaque parse error (→ retry, stays dark) or, worst case, structurally-valid-but-wrong file producing garbage embeddings. (debugger LR-1) **Fix when live:** verify the ONNX SHA-256 against the manifest in `getModelBundle()`.
- **AGG-CL3** — Production embedding hook (`image-queue.ts:433-470`) is unbounded fire-and-forget OUTSIDE PQueue concurrency control + a redundant per-image `getGalleryConfig()` DB read. ONNX `session.run()` is thread-safe (no corruption) — CPU-oversubscription, not data-loss. (debugger LR-2) **Fix when live:** bounded PQueue; read mode from the already-fetched config.
- **AGG-CL4** — Model-reload storm: the (correct) reject-and-null retry means a permanently-absent production volume makes every processed image's hook re-attempt the full load, no backoff. (debugger LR-3) Plus CSP lacks `wasm-unsafe-eval` — production CLIP / onnxruntime-web would break under strict CSP with no breadcrumb (critic CRT-06). **Fix when live:** negative-cache TTL on rejection + a documented conditional CSP relaxation behind the env gate.

---

## VERIFIED NON-ISSUES (refuted/downgraded this cycle — do NOT re-raise)

1. **TRC-03 "No SIGTERM flush for view-count buffer" — REFUTED (orchestrator).** `apps/web/src/instrumentation.ts:8-34` registers `process.once('SIGTERM'/'SIGINT', gracefulShutdown)`, and `gracefulShutdown` calls `flushBufferedSharedGroupViewCounts()` alongside `shutdownImageProcessingQueue()` under a 15 s `Promise.race`. `db-actions.ts:333` also flushes before backup. The tracer explicitly noted it had NOT checked `instrumentation.ts`. Only `SIGKILL`/OOM loses the buffer (unavoidable, best-effort-by-design).
2. **DES-11 "Dynamic Tailwind `columns-N` classes purged in production" — REFUTED (orchestrator).** `tailwind.config.ts:11-21` has an explicit `safelist` covering `columns-1..5` + all `sm:`/`md:`/`xl:`/`2xl:` variants the interpolation produces. Not a bug.
3. **DES-05 "Search modal input `h-8` = 32px touch-target violation" — DOWNGRADED (orchestrator).** The base `Input` primitive (`ui/input.tsx:11`) hard-floors `min-h-11` (44px); CSS `min-height` wins over the `h-8` `height`, so the input renders at 44px at runtime (matching prior-cycle live measurement). The `h-8` is a **misleading dead class**, NOT a WCAG violation — recorded as a LOW cleanup only. The "touch-target audit blind spot for `<Input>`" is mooted by the primitive's floor (belt-and-braces only).
4. **TRC-04 / DD-2 "CLIP embedding schema mismatch / raw-Buffer corruption risk" — NUANCE.** The column is `mediumblob`; the code stores **base64 TEXT** (verified) and round-trips correctly. The "raw bytes" framing in CLAUDE.md/schema comments is itself the drift (AGG-D6), not a live bug. Only action is the comment fix.
5. **code-reviewer + critic refutations (re-confirmed against source):** `color_primaries` doc/code "drift" (consistent — public), `COLOR_IMPACTING_KEYS` 5-vs-9 (it's 9, CLAUDE.md correct), delete-during-processing orphans the original (REFUTED — `deleteImage` unconditionally `deleteOriginalUploadFile`), process-restart rate-limit bypass (REFUTED — DB bucket is source of truth, survives restart), CSP nonce ineffective (REFUTED — wired in proxy.ts), `gps-exif-strip` over-read-before-bounds (REFUTED — guard runs first), `icc-chromaticity` tagCount overflow (REFUTED — clamped to 100 first), WI-15 downscale aspect bug (REFUTED), topic TOCTOU outside lock (REFUTED — inside lock + ER_DUP_ENTRY catch), `image_embeddings`/`entitlements` orphan on delete (REFUTED — cascade FKs), `useSyncExternalStore` React #185 (REFUTED — value-memoized snapshot), `clampSemanticTopK` coercion (HANDLED), `actions/sharing.ts` in-memory-vs-DB rate-limit drift (NOT A BUG — fail-closed by design).

---

## SCOPE-APPROPRIATE TRADEOFFS (NOT bugs — planner must NOT "fix")

Per architect "Scope-Appropriate Tradeoffs": single MySQL + single web instance SPOF (documented), `revalidate=0` on public pages (deliberate freshness), flat multi-root-admin (no RBAC — accepted), process-local rate-limit buckets (login has DB backup), view-count best-effort approximate, `must-revalidate` (not `immutable`) on derivatives, per-iteration deploy/no staging, hardcoded rate-limit windows/file-size caps. The CLIP dark posture is intentional and airtight. i18n en/ko value-shape asymmetry is intentional (ko omits ICU plural). The lint-gate regex scanners are the right tradeoff for this loop-driven workflow.

---

## ARCHITECTURE (structural, calibrated to personal-scale — worth doing but not emergencies)

- **ARCH-01 / ARCH-03** — Complexity concentration: `data.ts` (1,649 LOC), `process-image.ts` (1,638), `actions/images.ts` (1,152). Extract the view-count subsystem to `lib/shared-group-view-counter.ts`; promote the color matrix to a declarative table before WI-09. **Refactor — deferral candidate (mechanical, low-risk, do when touching those files).**
- **ARCH-02** — Triple-mirrored privacy field surface (`data.ts` public + map + `data-timeline.ts`); a 4th future read path inherits no guard. Core split IS by-construction-safe. **Remediation:** single exported `PUBLIC_IMAGE_COLUMNS` allowlist all public reads spread; lock `publicMapSelectFields` behind its only caller. **Privacy is the most expensive-to-reverse invariant — schedule, don't defer indefinitely.**
- **ARCH-04** — Config sprawl: 40+ scattered `process.env` reads, duplicate-name concurrency knobs (`BACKFILL_CONCURRENCY` vs `ADMIN_BACKFILL_CONCURRENCY`), `TRUST_PROXY`/`TRUSTED_PROXY_HOPS` read without boot validation. **Remediation:** single typed `lib/env.ts` with fail-fast. **Deferral candidate (single-operator); the proxy-trust validation slice (overlaps SEC-03) is worth doing.**
- **ARCH-05** — Storage abstraction fully orphaned (zero prod importers; `switchStorageBackend` is local→local dead code), honestly documented. **Remediation:** delete it (YAGNI at this scope) OR add an `@orphaned` no-importer marker test. **Decide now (delete vs mark), defer the S3 migration.**
- **ARCH-06** — `lib/api-auth.ts` imports `isAdmin` from `app/actions/auth` — the only `lib→app` inversion. Works today. **Defer** unless an auth refactor is planned.

---

## TOP PRIORITIES FOR THIS CYCLE (planner input)

1. **AGG-H1** — Stripe card-only interim guard + regression test (money-taken-no-goods). Full async handler stays plan-316-deferred.
2. **AGG-H6** — `wide-gamut-hint.tsx` JSON.parse try/catch (user-visible photo-page crash, trivial).
3. **AGG-H5** — serve-upload fd-leak abort handling (resource exhaustion on a busy instance).
4. **AGG-H3** — SW LRU running-total + head-walk eviction + debounced setAll (+ SW_VERSION re-stamp + contract test).
5. **AGG-H4** — `getMapImages()` `.limit()` bound.
6. **AGG-H2** — `*_views` retention/prune job + (optional) global anonymous-write ceiling.
7. **AGG-M1, M3, M4, M5, M6, M12** — wide-gamut warning constant; explicit `isAdmin` HDR-badge gate + test; `motion-safe:` reduced-motion; i18n Close label; tag-input focus ring; GC-interval-once.
8. **AGG-T1, T2, T3** — DB rate-limit + IP-rollback + session-secret-fallback tests.
9. **AGG-D1..D6** — doc/comment drift corrections.
10. Smaller LOW/perf items + ARCH refactors as capacity allows or defer per repo rules.

---

## AGENT FAILURES

The designer agent's first two attempts exhausted their tool budget during the live dev-server boot (slow ~40s first-compile on this filesystem) and did not complete the file write; the verifier and debugger first attempts likewise returned mid-progress. All three were retried per the skill's retry rule — debugger and verifier completed on retry-1, designer completed on a third static-only attempt. **All 11 per-agent review files are present and dated 2026-06-16 / HEAD 8ccc8806.** No agent was silently dropped.
