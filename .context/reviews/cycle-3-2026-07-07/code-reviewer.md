# Code Quality Review — GalleryKit (apps/web) — Run-10 Cycle 3

Reviewer: cr3b (code-quality lane)
Scope: logic bugs, missed edge cases, error handling, invariant violations, data-flow/state
consistency, race conditions, SOLID/maintainability. NOT security-specific (separate lane).
Date: 2026-07-07 · Branch: master · HEAD: `e08b6f97` (end of cycle-2)

## Method

1. Read CLAUDE.md invariants, the cycle-2 code-reviewer review, and the cycle-1/cycle-2 deferred
   registers first — deferred/already-fixed items are NOT re-reported (see the exception note under
   CR3-01, which is NEW evidence on the cycle-2 PERF-04 change, not a deferral challenge).
2. Priority 1: read the full diffs of all 14 flagged cycle-2 commits (`642c5091..e08b6f97`) and, where a
   change had cross-file reach, the current source of the touched functions and their callers.
3. Priority 2: manual deep read of high-risk lib files not covered by the predecessor
   (view-retention, restore-maintenance, rate-limit client-IP, session verify) + one delegated
   full-text coverage sweep across every `src/components/*.tsx`, every `src/app/api/**/route.ts(x)`,
   every `scripts/*`, and the remaining lib surface (serve-upload, upload-paths, queue-shutdown,
   smart-collections, admin-tokens, api-auth, og-photo-fetch). Behavior validated from code, not from
   comments or tests.

## Headline

The cycle-2 work is high quality. All 14 priority commits do what they claim and I found no regression
or incomplete fix in 13 of them (migrate pending-split, ISOBMFF parent bounds, SW 304 no-rewrite, lean
topics/sitemap budget, tag join-UPDATE, focus-restore ×2, ref-based swipe/sheet transforms, memoized
MasonryCard, CSP degrade, /api CSP, 404 layout checks — all verified sound; details below).

I report **two** findings. One MED (a real latent correctness hazard introduced by the cycle-2 PERF-04
zero-copy embedding change — the safety justification the code relies on does not hold at one of its
call sites). One LOW (a pre-existing latent logic bug in an unreachable code path). Both are honest,
narrow, and backed by a concrete mechanism; I did not inflate to fill a table.

---

## Findings

### CR3-01 — Zero-copy embedding view is retained across a later pool query in the similar-images route (the PERF-04 safety invariant is violated at one call site)
- Severity: MED · Confidence: Medium · Status: likely (mechanism confirmed; corruption is intermittent/data-dependent)
- Locations:
  - `apps/web/src/lib/clip-embeddings.ts:130-148` (`bufferToEmbedding` zero-copy view)
  - `apps/web/src/app/api/search/similar/[id]/route.ts:156-160` (retain), `:173-182` (subsequent query), `:196-204` (deferred read)
- Origin: cycle-2 commit `ea712cfc` (perf(search): replace per-element embedding decode with bulk copy), closing C2-14/PERF-04.

**What the change did.** `bufferToEmbedding` now returns, on little-endian hosts with a 4-aligned
`byteOffset`, a **zero-copy** `Float32Array` view directly over the input Buffer's `ArrayBuffer`
(`new Float32Array(buf.buffer, buf.byteOffset, EMBEDDING_DIM)`). In `decodeEmbeddingColumn`'s Case 1
(the current write path: a raw 2048-byte MEDIUMBLOB), that input Buffer IS the mysql2 row buffer — a
slice over the driver's socket-read/packet-accumulation buffer.

**The invariant it relies on.** The source comment (`clip-embeddings.ts:116-128`) justifies the
zero-copy view as safe because "`decodeEmbeddingColumn`'s callers … read the returned array
**transiently inside a single synchronous `.map()`** … and never store or mutate it afterward." That is
TRUE for the two hot scan sites — `semantic/route.ts:302-309` and `similar/[id]/route.ts:196-204` both
decode + score + discard within one synchronous `.map()` iteration, no await, no retention → safe.

**Where it breaks.** The similar-images route has a THIRD `decodeEmbeddingColumn` call that does NOT
match that pattern: at `:156-160` it decodes the *target* image's embedding and assigns it to
`targetEmbedding`, then at `:173` runs a **second `await db.select(...)`** on the same connection pool,
then at `:201` reads `targetEmbedding` via `dotProduct(...)`. So a zero-copy view over query-1's mysql2
buffer is read AFTER a subsequent query executes on the pool. mysql2 (`^3.22.0`) reuses each
connection's packet-accumulation buffer across queries; when query 2 lands on the same pooled
connection and overwrites that memory before line 201 reads it, `targetEmbedding` sees rewritten bytes
→ garbage similarity scores / wrong or empty similar-image results.

**Why "likely" not "confirmed".** Corruption needs three things to coincide: (a) the target row's
`byteOffset` is 4-aligned so the zero-copy branch is taken (roughly 1-in-4 by wire position, else the
safe copy branch runs), (b) query 2 reuses the same pooled connection (common at low concurrency), and
(c) mysql2 rewrites that specific region before the read. Each is plausible; I did not build a live
repro. Notably, this commit's own message ("copy chosen over zero-copy view because mysql2 row buffers
may be pooled/reused after return") directly contradicts the final code, which keeps a zero-copy view —
evidence the author was aware of exactly this hazard. The reliance on undocumented mysql2 buffer-lifetime
internals is the same fragile-coupling class already flagged as deferred C1-31.

**Exposure.** Production semantic/similar search is operator-gated OFF by default (`semantic_search_mode`
+ `SEMANTIC_SEARCH_ALLOW_PRODUCTION`), so this is latent until an operator enables it — but when enabled
it is a real correctness bug in a shipped feature, and its intermittent nature makes it painful to debug.

**Fix.** Defensive-copy the single retained vector; it costs nothing (one 512-float vector, not the hot
per-row loop) and removes the mysql2 dependence entirely:
`similar/[id]/route.ts:160` → `targetEmbedding = new Float32Array(decoded);` (or `Float32Array.from(decoded)`).
Keep the zero-copy fast path at the two `.map()` scan sites where the transient-synchronous-read
invariant genuinely holds. Optionally tighten the `clip-embeddings.ts` comment to state that the
zero-copy result is safe ONLY for immediate synchronous consumption and MUST be copied before being
held across any further DB I/O.

---

### CR3-02 — `OptimisticImage` retry after a failed `fallbackSrc` reverts to the original (already-failed) `src`, not the fallback
- Severity: LOW · Confidence: High (logic) / High (currently unreachable) · Status: confirmed latent
- Location: `apps/web/src/components/optimistic-image.tsx:30-54` (`handleError`)

**Problem.** When `fallbackSrc` is provided and the primary image fails, `handleError` switches
`imgSrc` to `fallbackSrc` and resets the retry counter (`:31-37`). If the *fallback* then also fails,
the first branch is skipped (`imgSrc === fallbackSrc`), and the retry branch builds the next URL from
the **original `src` prop**, not from `imgSrc`/`fallbackSrc`:
`setImgSrc(\`${src}${separator}retry=${nextRetry}\`)` (`:47-48`). So every retry after a failed fallback
hammers the original known-failed URL instead of retrying the fallback — the opposite of the intent, and
it means the fallback gets exactly one attempt while the dead original gets `maxRetries` attempts.

**Failure scenario (latent today).** A caller passes `fallbackSrc="/uploads/jpeg/x.jpg"` with a primary
`src` that 404s and a fallback that is briefly unavailable (transient 5xx). Expected: retry the fallback
with backoff. Actual: one fallback attempt, then N retries against the dead primary; the transient
fallback outage is never retried.

**Reachability.** No caller currently passes `fallbackSrc` — the three `<OptimisticImage>` sites
(`masonry-card.tsx:119`, `image-manager.tsx:473`, `on-this-day-widget.tsx:65`) omit it, and
`grid-picture-fallback-boundary.tsx`'s `fallbackSrc` is an unrelated `<picture>` data-attribute
mechanism. So the branch is dead-but-shipped: a correctness trap for the next author who wires it.

**Fix.** Retry against the currently-displayed source, not the original prop — e.g. track a
`currentBaseRef` set to `fallbackSrc` when the fallback branch is taken and build the retry URL from it;
or reset `retryCount`/base coherently so the fallback (not the original) is the retry target. Minimal
change: derive the retry base from `imgSrc` with its existing `?retry=` stripped rather than from `src`.

---

## Priority-1 commit verification (all sound — no action)

- **`b4e986c3` migrate pending-vs-drift split (FDR-01).** Correct. `prepareLegacyDatabaseIfNeeded` now
  returns early when every missing journal hash sits strictly above the recorded `MAX(created_at)`
  cursor (drizzle applies the pending SQL itself, restoring the loud post-condition), and only true
  drift (missing hash at/below cursor, empty/poisoned log) reconciles+baselines, loudly naming any
  above-cursor entry it baselines without executing. `Number(m.folderMillis) > Number(cursor)` compares
  epoch-ms to bigint-string safely (values ~1.75e12 << MAX_SAFE_INTEGER; no precision loss).
- **`9ce5cf96` ISOBMFF parent-container bounds (DBG-01).** Correct and complete. Both walkers
  (`color-detection.ts:parseCicpFromHeif`, `gain-map-detection.ts:readBoxHeader/parseIinf/parseIref/walk)
  now bound child boxes against the container end (`limit`/`end`), not `buffer.length` — matching
  `gps-exif-strip.ts:walkChildren`. `size===0` (`= limit - pos`) and `size===1` (`pos+16 > limit`) cases
  both re-anchored. Crafted-overflow + positive-control tests pin both walkers.
- **`bf5a4da9` SW 304 no-body-rewrite (C2-11).** Correct. `refreshCachedImageTimestamp` removed;
  304/same-ETag return `cached` directly after `touchMeta`; `evictExpiredCachedImage` reads the LRU meta
  timestamp first with the `sw-cached-at` header as a legacy fallback, so recency still holds after the
  header stops advancing. `touchMeta` failure (`.catch(()=>{})`) at worst leaves the prior meta
  timestamp — an entry ages out slightly sooner, never serves corrupt bytes. sw.js regenerated + version
  bumped; contract tests updated.
- **`9bd2daf3` lean topics + sitemap budget + SEO fallback.** Verified: only the sitemap reads
  `last_image_updated_at`, and it now uses `getTopicsWithLatestUpdate()`; every other consumer (nav,
  home, topic, collection, admin dashboard) uses the lean `getTopics()`, which dropped ONLY that column
  (other 5 fields unchanged) — no stranded reader. Sitemap reservation now counts feed + per-topic-feed
  rows and adds a defensive `.slice(0, MAX_SITEMAP_URLS)` clamp. `buildSeoSettingsFallback()` mirrors the
  siteConfig-default branch field-for-field (fixes nav.tsx's wrong-field partial fallback).
- **`ea712cfc` bulk embedding decode.** The endianness probe + aligned/misaligned/BE branches are all
  value-correct; the misaligned and BE paths copy (safe). Only the aligned zero-copy path retained across
  a query is unsafe — see CR3-01.
- **`eb3a7ad9` tag rename/delete single join-UPDATE.** Correct. `updateTag` keeps its `updateRows > 0`
  gate; `deleteTag` runs the join-UPDATE BEFORE deleting `image_tags` (the join is the row source). A
  non-existent tag id touches zero rows (harmless). Behavior equivalent to the prior SELECT-then-IN, minus
  the multi-MB packet + long row-lock.
- **`02bea8d6` image-queue hardening (C2-08/10/32/33/34).** All five correct: concurrency now derives
  from imported `POOL_CONNECTION_LIMIT`; detached call sites use `getGalleryConfigUncached` (3 sites,
  pinned); processing-failure retry uses an escalating `setTimeout(...).unref()` mirroring the claim path;
  defensive re-init clears the orphaned `gcInterval`; embedding bootstrap capped at `SEMANTIC_SCAN_LIMIT`
  with a continuation log. The retry timer is `.unref()`'d so it can't hold the process open at shutdown.
- **`fc21007a` info-sheet focus + imperative transform / `2c82a69c` lightbox focus.** Both correct.
  Explicit parent-owned `restoreFocusRef` (a known-visible toolbar button) is captured at setup and
  refocused on a rAF after teardown, sidestepping the FocusTrap-unmounts-in-same-commit race and the
  display:none-activeElement no-op. Imperative sheet transform: `useLayoutEffect` reasserts the resting
  transform on state/open change; touch handlers write `style.transform` directly without setState;
  snap-back settles imperatively. No ref/state desync.
- **`ffc4a06e` ref-based swipe transforms.** Correct image-zoom idiom; progress bar now always-mounted at
  rest (opacity/width 0, pointer-events-none); `applySwipeVisuals` added to the effect deps.
- **`e5504bc8` memoized MasonryCard.** `React.memo` default shallow comparator is valid: `image` keeps
  referential identity across `setAllImages(prev => [...prev, ...new])` appends, other props are
  primitives/parent-stable, `onLinkClick` is a scrollKey-keyed useCallback; context (locale) changes still
  re-render memo'd children correctly. Markup/aria preserved.
- **`a4a2d250` CSP degrade / `3b8d05c8` /api CSP.** `buildCspSafely` catches the `parseCspImageBaseUrl`
  throw and rebuilds with an explicit `imageBaseUrl: null` (overrides the throwing default param, so the
  fallback cannot re-throw), logging once per process — turns a full-site 500 into degraded CDN images.
  The non-dev `/api/:path*` rule (`default-src 'none'; frame-ancestors 'none'; sandbox`) applies to the
  API response bytes only and does not affect `<img>` embedding of OG cards.
- **`911cb0f5`/`faa6f0e5` real 404s.** Framework-correct: existence checks moved into segment `layout.tsx`
  (which resolves before the streamed 200 shell, unlike the page body inside the loading Suspense
  boundary); `generateMetadata` throws `notFound()` too (defense in depth); the global
  `[locale]/loading.tsx` (which forced all pages onto the streamed-200 path) is removed while deliberate
  per-segment skeletons remain; checks skip during restore maintenance so the maintenance panel keeps
  200. `getImageCached`/`getTopicBySlugCached`/`getSmartCollectionBySlugCached` are React-cache()-deduped
  with the page + metadata, so no extra query.

## Verified clean (spot-checked, no findings)

- `view-retention.ts` — negative/non-finite `VIEW_RETENTION_DAYS` falls back to the 395-day default
  (never a future cutoff); chunked DELETE bounded at 200×5000/table/sweep, remainder next sweep.
- `restore-maintenance.ts` — process-local flag only (durable marker lives elsewhere, per CLAUDE.md);
  begin/end semantics correct.
- `rate-limit.ts` `getClientIp` — XFF only trusted under `TRUST_PROXY`, right-anchored hop selection with
  the documented nginx-overwrite shipped config (the deeply-reviewed C1-11/C2-40 surface).
- `session.ts:128` `parseInt(timestamp,10)` — safe: timestamp is HMAC-verified (unforgeable) and
  server-generated from `Date.now()` (always plain integer); `Number.isFinite` guards NaN. Not the
  scientific-notation class the sweep fixed elsewhere.
- Full delegated coverage sweep (every component / api route / script / remaining lib): serve-upload fd
  lifecycle (no double-close, abort path destroys fd), lr/upload claim-settle + contract-lock-in-finally,
  restore-maintenance recovery marker-path parity across the tsx-less container, backfill keyset
  pagination termination, search.tsx request-id race guarding, load-more stale-query/unmount guards,
  onError one-shot fallback guards, smart-collections predicate narrowing — all traced and cleared.

## Coverage statement

Priority-1: all 14 flagged commits read in full + current source of touched functions and their callers.
Priority-2: lib high-risk files read manually; every `src/components/*.tsx`, `src/app/api/**/route.ts(x)`,
`scripts/*`, and the remaining lib surface read in full via the delegated sweep (file list captured in
the sweep result). No relevant file was sampled-and-skipped. Findings deliberately narrow: this is a
mature, heavily-annotated codebase and two findings (one MED-latent, one LOW-dead-path) is the honest
result, not an artifact of stopping early.
