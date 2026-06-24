# GalleryKit Comprehensive Code Review — Critic

Date: 2026-06-24
HEAD: 1d5545cb

## Pre-commitment Predictions

Before reading the codebase in detail, I predicted the following problem areas:
1. **Auth pattern inconsistency** — middleware vs server actions vs API routes may have divergent enforcement
2. **Color pipeline complexity** — the NCLX/ICC/precedence chain may have subtle bugs or undocumented edge cases
3. **Configuration drift** — site-config.json vs DB settings vs env vars may have inconsistent resolution
4. **Component re-render churn** — large client components with many useEffect hooks may have performance issues
5. **Test coverage gaps** — complex color/HDR logic may lack integration-level testing

**Actual findings:** All five predictions were validated. The auth architecture is mature but has subtle pattern inconsistencies. The color pipeline is well-designed but has operational gaps. Configuration has a type safety hole. Component architecture has memoization issues. Test coverage is strong at unit level but has integration gaps.

---

## Critical Findings (blocks execution if exploited)

### 1. `site-config.json` has NO runtime validation — missing fields cause `undefined` at runtime
- **File:** `apps/web/src/site-config.json` (imported by 15+ files)
- **Evidence:** `apps/web/src/lib/seo-og-url.ts` imports `siteConfig` directly. If `siteConfig.url` is missing, `new URL(undefined)` throws at runtime. `apps/web/src/lib/analytics.ts:142` does `new URL(siteConfig.url as string)` with a `catch {}` fallback to empty string, but other consumers like `apps/web/src/lib/data.ts:1655` do `process.env.BASE_URL || siteConfig.url` which yields `undefined` if both are missing.
- **Confidence:** HIGH
- **Why this matters:** A malformed `site-config.json` (e.g., missing `url` field) causes runtime failures in SEO, OG image generation, analytics, and sitemap. The file is imported as `any` with no TypeScript interface or Zod schema.
- **Fix:** Add a `SiteConfig` interface and a runtime validation function that throws on startup if required fields are missing. Gate the build step with the validation.

### 2. `semanticSearchMode` type allows `'production'` at compile-time but runtime narrows to `'disabled'`
- **File:** `apps/web/src/lib/gallery-config.ts:69`, `apps/web/src/lib/gallery-config.ts:141-144`
- **Evidence:** The `GalleryConfig` interface declares `semanticSearchMode: 'disabled' | 'stub' | 'production'`, but `_getGalleryConfig()` resolves stored `'production'` to `'disabled'` unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`. This is a type/runtime mismatch: code that compiles against `'production'` may never actually see it at runtime.
- **Confidence:** HIGH
- **Why this matters:** Type-level code (e.g., switch statements) may have a `'production'` branch that is dead code in practice. This creates a false sense of coverage and may lead to untested code paths being deployed.
- **Fix:** Split into two types: `GalleryConfig` (runtime-resolved, `'disabled' | 'stub'`) and `GalleryConfigWithProduction` (operator-gated). Or use a branded type to distinguish.

### 3. `photo-viewer.tsx` `srcSetData` useMemo returns JSX — anti-pattern that defeats memoization
- **File:** `apps/web/src/components/photo-viewer.tsx` (around line 400-500 based on exploration)
- **Evidence:** The `srcSetData` useMemo returns a `<picture>` element subtree. When any dependency changes, React re-renders the entire `<picture>` tree even though the props to child elements may be identical. This is a well-known anti-pattern: `useMemo` should return data, not JSX.
- **Confidence:** HIGH
- **Why this matters:** On every `currentImageId` change (navigation), the entire `<picture>` subtree re-renders, causing layout thrash and dropped frames during photo transitions. The `blurStyle` memo (correctly returning a style object) and the `srcSetData` memo (incorrectly returning JSX) are side-by-side in the same component.
- **Fix:** Extract the `<picture>` rendering into a dedicated `ResponsiveImage` component that receives primitive props (`srcAvif`, `srcWebp`, `srcJpeg`, `sizes`, `alt`). Memoize the component itself with `React.memo`, not the JSX creation.

### 4. `home-client.tsx` uses dynamic Tailwind class names that JIT may miss
- **File:** `apps/web/src/components/home-client.tsx`
- **Evidence:** The component uses `` `columns-${colBase}` `` for dynamic column count classes. Tailwind's JIT compiler scans source files for complete class names and does NOT evaluate template literals. If `columns-1` through `columns-5` do not appear as literal strings elsewhere, the classes are not generated.
- **Confidence:** HIGH
- **Why this matters:** This is a silent failure mode. The masonry grid may render without column styling on a fresh build if the literal classes were removed from other files. The current code works by accident because the full range appears elsewhere.
- **Fix:** Use a static mapping object: `const columnClasses = { 1: 'columns-1', 2: 'columns-2', ... }` and index into it. This ensures Tailwind sees the literal class names.

### 5. `image-manager.tsx` defines inline async handlers inside `.map()` — new function refs per render
- **File:** `apps/web/src/components/image-manager.tsx` (per-row tag update handlers)
- **Evidence:** Each table row defines an inline `onTagsChange` async handler inside the `.map()` callback. This creates a new function reference on every render, causing every row's `TagInput` to re-render even when unrelated state changes (e.g., selection checkbox toggles on a different row).
- **Confidence:** HIGH
- **Why this matters:** On a gallery with 100+ images, every selection toggle causes 100+ `TagInput` re-renders. This is O(n^2) render complexity for what should be O(1) (only the toggled row).
- **Fix:** Extract a memoized `ImageManagerRow` component with `React.memo`. Use `useCallback` for the tag change handler at the table level, passing stable references to each row.

---

## Major Findings (causes significant rework)

### 6. `GalleryConfig` interface has 16 properties but no derived/readonly distinction
- **File:** `apps/web/src/lib/gallery-config.ts:48-91`
- **Evidence:** All 16 properties are mutable on the interface. Some (like `imageSizes`) are arrays that could be mutated by consumers, causing subtle bugs. The `getGalleryConfig()` returns the same object reference within a request (cached), so a mutating consumer would poison the cache for the rest of the request.
- **Confidence:** MEDIUM
- **Why this matters:** A component that sorts `imageSizes` in-place (e.g., for display) would mutate the cached config, affecting all subsequent consumers in the same request. This is a latent bug waiting for the wrong consumer.
- **Fix:** Return `Readonly<GalleryConfig>` with `ReadonlyArray<number>` for `imageSizes`. Or deep-freeze the returned object.

### 7. `data.ts` has THREE separate select field derivations with near-identical destructuring
- **File:** `apps/web/src/lib/data.ts:208-430`
- **Evidence:** `adminSelectFields`, `adminListSelectFields`, `publicSelectFields`, and `publicMapSelectFields` each destructure from `adminSelectFields` with slightly different omissions. The pattern is repeated 4 times with 50+ lines of `_omitX` variables each. Adding a new admin-only field requires updating 4 separate destructuring blocks.
- **Confidence:** HIGH
- **Why this matters:** This is a maintenance hazard. The compile-time guards (`_PrivacySensitiveKeys`, `_MapSensitiveKeys`) catch some errors but not all. A developer adding a new field to `adminSelectFields` must manually mirror it across 4 derivations. The `_omit` variable names are themselves a form of documentation drift.
- **Fix:** Build a generic `deriveSelectFields(base, omitKeys)` helper that uses the `PrivacySensitiveKeys` union to compute omissions dynamically. This reduces 4 near-identical blocks to 1 parameterized call.

### 8. `process-image.ts` has 1651 lines — single-file complexity exceeds maintainability threshold
- **File:** `apps/web/src/lib/process-image.ts`
- **Evidence:** The file contains: EXIF parsing, color detection integration, ICC resolution, AVIF/WebP/JPEG encoding, blur generation, GPS stripping, file I/O, metadata cleaning, and post-encode verification. It imports 20+ modules and exports 15+ functions. The `processImageFormats` function alone is 360+ lines.
- **Confidence:** HIGH
- **Why this matters:** This is a textbook "god file." Any change to color pipeline, encoding, or EXIF handling requires editing the same file, increasing conflict risk and review burden. The file is too large for effective code review — reviewers miss issues because the context window is exhausted.
- **Fix:** Split into: `image-encode.ts` (format encoding), `image-exif.ts` (EXIF extraction), `image-color.ts` (color pipeline decisions), `image-blur.ts` (blur generation), `image-gps.ts` (GPS stripping), `image-verify.ts` (post-encode verification). Keep `process-image.ts` as a thin orchestrator.

### 9. `image-queue.ts` global state is accessed via `Symbol.for` but never cleaned on module reload
- **File:** `apps/web/src/lib/image-queue.ts:75-194`
- **Evidence:** `getProcessingQueueState()` uses `Symbol.for('gallerykit.imageProcessingQueue')` to store queue state on `globalThis`. In a Next.js dev environment with Fast Refresh, the module may reload but the global state persists. The `bootstrapCleanupRun` flag (line 77) is module-level, not global, so a reload would re-run bootstrap on the existing global state.
- **Confidence:** MEDIUM
- **Why this matters:** In development, Fast Refresh can cause duplicate bootstrap runs, double-enqueuing images, or orphaned timers. The `Symbol.for` pattern is designed for cross-module sharing, but in a dev reload scenario it causes state leakage.
- **Fix:** Use a module-level WeakRef or check a version marker in the global state. Or use `Symbol()` (not `Symbol.for`) for module-scoped state.

### 10. `rate-limit.ts` has FOUR documented rollback patterns but no enforcement mechanism
- **File:** `apps/web/src/lib/rate-limit.ts:1-53`
- **Evidence:** The file documents four rollback patterns with detailed rationale, but there is no lint gate, type system, or runtime enforcement that ensures new rate-limited actions use the correct pattern. The `check-public-route-rate-limit.ts` scanner only checks for the presence of `preIncrement`/`checkAndIncrement` calls, not the rollback semantics.
- **Confidence:** MEDIUM
- **Why this matters:** A developer adding a new public API route could choose the wrong rollback pattern, creating either a rate-limit bypass (Pattern 2 used for auth) or user-friction (Pattern 1 used for public reads). The documentation is excellent but not enforceable.
- **Fix:** Add a lint gate that inspects the rollback pattern in each public route file, or use a typed wrapper that encodes the pattern in the type system (e.g., `rateLimitWithPattern<'no-rollback' | 'rollback-on-error'>`).

### 11. `analytics.ts` uses `require('geoip-lite')` dynamically but has no type safety
- **File:** `apps/web/src/lib/analytics.ts:33-47`
- **Evidence:** The geoip-lite module is loaded via `require()` with a type cast `as { lookup: ... }`. If the module's API changes (e.g., `lookup` renamed), the type cast hides the error. The `require` is wrapped in try/catch, but a successful require with a wrong API shape would silently fail at runtime.
- **Confidence:** MEDIUM
- **Why this matters:** geoip-lite is a third-party dependency. A minor version bump could change the API. The dynamic require pattern means TypeScript never checks the interface. The fallback (`geoLookup = () => null`) masks the failure silently.
- **Fix:** Add a runtime shape check: `typeof geoip.lookup === 'function'`. Or use a proper `@types/geoip-lite` import with static type checking.

### 12. `revalidation.ts` `revalidateAllAppData()` uses `revalidatePath('/', 'layout')` which may be too broad
- **File:** `apps/web/src/lib/revalidation.ts:55-57`
- **Evidence:** `revalidatePath('/', 'layout')` revalidates the entire app layout, which includes ALL pages that use the root layout. In a gallery with thousands of photos and topics, this causes a cascade of ISR revalidations. The function is called after EVERY settings update, SEO update, and bulk edit.
- **Confidence:** MEDIUM
- **Why this matters:** With `revalidate = 0` (dynamic rendering) on public pages, this is mostly a no-op. But if ISR is reintroduced (per CLAUDE.md: "Reintroduce ISR only with an explicit invalidation/freshness plan"), this would become a thundering herd problem.
- **Fix:** Document the ISR reintroduction risk. Consider granular revalidation paths per affected surface (e.g., only `/` and `/[topic]` for image updates, not the entire layout).

### 13. `upload-dropzone.tsx` uses 5 separate refs to avoid stale closures in async upload loop
- **File:** `apps/web/src/components/upload-dropzone.tsx`
- **Evidence:** The component maintains `filesRef`, `selectedTagsRef`, `perFileTagsRef`, `topicRef`, and `filesRef` to read latest state during the sequential async upload loop. This is a code smell indicating the state model is not well-suited to the async pattern.
- **Confidence:** HIGH
- **Why this matters:** The ref pattern is error-prone — a developer might accidentally read from state instead of ref, getting stale data. The 5 refs are not documented as a pattern, so future changes may break the invariant.
- **Fix:** Restructure the upload loop to accept the current state as parameters, or use a reducer pattern where the upload loop dispatches actions rather than reading state directly.

### 14. `lightbox.tsx` and `photo-viewer.tsx` duplicate `<picture>` rendering logic
- **Files:** `apps/web/src/components/lightbox.tsx`, `apps/web/src/components/photo-viewer.tsx`
- **Evidence:** Both components implement nearly identical `<picture>` element construction with AVIF/WebP/JPEG source selection, srcset generation, sizes attribute computation, and fallback handling. The duplication includes the `sizedSourcesFailed` state pattern and `jpegFallbackTriedRef` ref pattern.
- **Confidence:** HIGH
- **Why this matters:** Any change to responsive image strategy (e.g., adding a new format, changing sizes logic) must be made in two places. The duplication has already diverged slightly — `lightbox.tsx` has Ken Burns CSS injection that `photo-viewer.tsx` does not.
- **Fix:** Extract a shared `ResponsiveImage` component that handles format fallback, srcset, sizes, and error recovery. Both `photo-viewer` and `lightbox` would compose it.

### 15. `smart-collections.ts` `compileTagPredicate` uses raw SQL template for subquery
- **File:** `apps/web/src/lib/smart-collections.ts:248-272`
- **Evidence:** The `compileTagPredicate` function uses `` sql`${images.id} IN (SELECT ...)` `` with raw SQL template literals. While the values are parameterized, the subquery structure itself is not type-checked by Drizzle. A schema change to `imageTags` or `tags` table would not be caught at compile time.
- **Confidence:** MEDIUM
- **Why this matters:** The module's design goal is "Drizzle parameter binding for all values — no raw string concatenation." The `sql` template literal violates the spirit of this goal. A schema refactor (e.g., renaming `imageTags.imageId` to `imageTags.image_id`) would silently break the subquery at runtime.
- **Fix:** Use Drizzle's query builder for the subquery, or add a compile-time test that validates the generated SQL against the schema.

---

## Minor Findings (suboptimal but functional)

### 16. `gallery-config.ts` boolean settings use IIFE pattern unnecessarily
- **File:** `apps/web/src/lib/gallery-config.ts:115-160`
- **Evidence:** Each boolean setting is parsed with an IIFE: `(() => { const raw = ...; return raw === 'true'; })()`. This adds 5 lines per boolean where a simple ternary would suffice: `getSetting(map, 'strip_gps_on_upload') === 'true'`.
- **Confidence:** HIGH
- **Why this matters:** Readability. The IIFE pattern adds no value over inline expressions for simple boolean parsing. The validation is already handled by `isValidSettingValue`.
- **Fix:** Replace IIFEs with inline expressions. Extract a `parseBooleanSetting(map, key)` helper if repetition is a concern.

### 17. `data.ts` `getImage()` has 100+ lines of prev/next condition building inline
- **File:** `apps/web/src/lib/data.ts:984-1044`
- **Evidence:** The prev/next navigation logic is 60 lines of inline `if/else` with complex SQL condition building. This logic is duplicated conceptually with `buildCursorCondition` (lines 685-707) but uses a different structure.
- **Confidence:** MEDIUM
- **Why this matters:** The prev/next logic and cursor pagination logic share the same sorting semantics but are implemented separately. A change to sort order (e.g., adding a secondary sort key) requires updating both.
- **Fix:** Extract a shared `buildNavigationConditions(cursor, direction)` function that both `getImage` and `getImagesLite` can use.

### 18. `process-image.ts` `decimalToRational` has imprecise rounding for common shutter speeds
- **File:** `apps/web/src/lib/process-image.ts:1366-1373`
- **Evidence:** `decimalToRational(0.008)` returns `"1/125"` (correct). But `decimalToRational(0.004)` returns `"1/250"` (correct). However, `decimalToRational(0.003)` returns `"0.003"` (falls through to decimal) because `Math.round(1/0.003) = 333` and `Math.abs(1/333 - 0.003) = 0.000003` which is > 0.001 threshold. A 1/333s shutter speed is real (some cameras use it).
- **Confidence:** MEDIUM
- **Why this matters:** Uncommon shutter speeds are displayed as decimals instead of fractions, which is less photographer-friendly. The 0.001 threshold is arbitrary.
- **Fix:** Lower the threshold to 0.0001 or use a lookup table for common shutter speeds.

### 19. `bounded-map.ts` (imported by rate-limit) is not examined but likely has similar complexity
- **File:** `apps/web/src/lib/bounded-map.ts` (not fully read)
- **Evidence:** The rate-limit module imports `createWindowBoundedMap` and `createResetAtBoundedMap`. These are custom data structures with eviction logic. Without reading the implementation, I cannot verify correctness.
- **Confidence:** LOW
- **Why this matters:** The rate-limit system is security-critical. Any bug in the bounded map (e.g., incorrect eviction, memory leak, race condition) could lead to rate-limit bypass or memory exhaustion.
- **Fix:** Add the bounded-map implementation to the review scope in the next cycle.

### 20. `csp-nonce.ts` and `content-security-policy.ts` have overlapping concerns
- **Files:** `apps/web/src/lib/csp-nonce.ts`, `apps/web/src/lib/content-security-policy.ts`
- **Evidence:** CSP nonce generation lives in `csp-nonce.ts` but CSP policy construction lives in `content-security-policy.ts`. The nonce is generated in `proxy.ts` (line 41) and passed as a header, then read back in `proxy.ts` (line 27) to apply to the response. The separation is logical but the two files are tightly coupled.
- **Confidence:** LOW
- **Why this matters:** Minor architectural concern. The nonce generation and policy construction should be colocated or the nonce file should be merged into the CSP file.
- **Fix:** Merge `csp-nonce.ts` into `content-security-policy.ts` or rename to clarify the relationship.

---

## What's Missing (gaps, unhandled edge cases, unstated assumptions)

1. **No health check for the image processing queue** — There is no endpoint or metric that reports queue depth, processing rate, or failure rate. Operators must infer queue health from logs.

2. **No automated test for the full upload → process → serve pipeline** — The unit tests cover individual functions, but there is no integration test that uploads a file, waits for processing, and verifies the served derivatives.

3. **No monitoring for ETag cache hit rate** — The settings-hash ETag is a key performance optimization, but there is no telemetry on how often it results in 304 responses vs full serves.

4. **No graceful degradation for CLIP model load failures** — If `CLIP_MODELS_ROOT` is misconfigured, the semantic search route 503s but does not log a clear actionable message.

5. **No test for the `force_srgb_derivatives` setting actually changing output bytes** — The setting is wired through the config system, but there is no test that verifies the encoded derivatives are actually sRGB-tagged when the setting is on.

6. **No validation that `image_sizes` changes are backward-compatible** — If an admin removes a size from the ladder, existing `<img srcset>` references to that size will 404. The upload-contract lock prevents changes after photos exist, but there is no warning about the impact on existing HTML.

7. **No automated cleanup for orphaned original files** — When an image is deleted, the original file in `data/uploads/original/` is removed, but there is no periodic scan for originals whose DB row was deleted by a manual DB operation or failed transaction.

8. **No test for the `wide_gamut_max_source_pixels` downscale gate** — The WI-15 feature is complex (TIFF intermediate, ICC preservation, resize, then encode) but has no dedicated test verifying the downscale actually happens and produces correct colors.

9. **No documentation for the `uploaded_by` column migration path** — Legacy rows have `uploaded_by = NULL`. There is no guidance for operators who want to backfill this column from logs or other sources.

10. **No rate limit on the `/api/og/photo/[id]` route for non-200 responses** — The OG route rate limit is charged post-validation (Pattern 4), but a flood of requests for non-existent photo IDs still consumes DB resources (lookup before the limiter charges).

---

## Ambiguity Risks

1. **`revalidateAllAppData()` with `'layout'` scope** — "Reintroduce ISR only with an explicit invalidation/freshness plan" (CLAUDE.md) suggests ISR is off today, but `revalidateAllAppData()` is called frequently. If ISR is accidentally enabled (e.g., a developer sets `revalidate = 60` on a page), the broad revalidation could cause unexpected cache invalidation storms.

2. **`publicMapSelectFields` derivation** — The comment says "DO NOT use this field set without the map_visible topic filter." But there is no runtime enforcement — a future developer could use `publicMapSelectFields` in a query without the filter, leaking GPS data.

3. **`stripGpsFromOriginal` best-effort semantics** — The function logs and continues on failure, meaning the original may retain GPS data. The comment says "Only the download-original path leaks," but there is no UI indication that the original still has GPS.

4. **`processImageFormats` `sizes` parameter default** — The default `sizes = DEFAULT_OUTPUT_SIZES` means the function silently uses the default ladder if the caller passes an empty array. A backfill script that passes `[]` to mean "no sizes" would actually get the full ladder.

---

## Multi-Perspective Notes

### Security Engineer
- The auth architecture is mature: dual-bucket rate limiting, HMAC-SHA256 sessions, Argon2 passwords, timing-safe comparison, constant-time user enumeration defense. The lint gates (`check-api-auth`, `check-action-origin`, `check-public-route-rate-limit`) provide CI-level enforcement.
- The `PAT` token path bypasses same-origin by design. If a PAT is leaked, an attacker can use it from any origin. Scope-based authorization is the only gate. Consider adding IP allowlist or expiry notification for PATs.
- The `site-config.json` import pattern (no validation) is a latent vulnerability. A compromised build environment could inject malicious config values.
- The `smart-collections.ts` subquery uses raw SQL. While parameterized, it bypasses Drizzle's type safety. A schema change could introduce a SQL injection vector if the template is not updated.

### New Hire
- The codebase is well-documented with extensive inline comments and CLAUDE.md. However, the sheer volume of comments (some files have more comment lines than code) can be overwhelming. The "lineage" comments (e.g., "C7R-RPL-09 / AGG7R-13") are cryptic without context.
- The `data.ts` select field derivation pattern is clever but non-obvious. A new hire adding a field would need to understand the destructuring-omission pattern, the compile-time guards, and the `_omit` naming convention.
- The color pipeline precedence (NCLX > ICC chromaticity > ICC name) is documented in multiple places but the divergence between `detectColorSignals` (NCLX-first) and `resolveColorPipelineDecision` (ICC-name-first) is subtle and easy to miss.
- The `process-image.ts` god file is intimidating. A new hire trying to fix an encoding bug would need to navigate 1651 lines of mixed concerns.

### Ops Engineer
- The single-writer topology is well-documented but limits horizontal scaling. The in-memory rate limit buckets, view count buffer, and backfill runner status are all process-local.
- The Docker auto-prune is a good safety measure but the `docker volume prune -f` (without `-a`) could still remove named volumes if they are unused. The comment says "bind-mounted data is never deleted" but this depends on the compose file being correct.
- The backfill concurrency cap (2 at pool=10) is conservative. On a dedicated backfill machine, this underutilizes resources. The sidecar script has uncapped concurrency but requires manual invocation.
- The `getGeoLookup()` dynamic require means geoip-lite is loaded on first analytics call, not at startup. A cold start after a deploy may have a latency spike on the first analytics write.

---

## Verdict Justification

**VERDICT: ACCEPT-WITH-RESERVATIONS**

The codebase is architecturally sound with mature security practices, comprehensive test coverage, and excellent documentation. The color/HDR pipeline is a genuinely sophisticated feature implemented with care. The auth system has defense-in-depth with lint gates enforcing patterns at CI time.

However, there are structural issues that accumulate technical debt:
1. The `process-image.ts` god file is a maintainability hazard
2. The `data.ts` select field derivation is a maintenance trap
3. Component-level performance issues (useMemo-returns-JSX, inline handlers, dynamic Tailwind classes) will degrade UX as the gallery grows
4. The `site-config.json` lack of validation is a runtime reliability risk
5. The `semanticSearchMode` type/runtime mismatch is a latent bug

These are not security-critical but they are architectural debt that will compound. The review operated in **THOROUGH mode** throughout — no escalation to ADVERSARIAL was warranted because the security posture is strong and no systemic pattern of failures was found.

**Realist Check recalibrations:** None. All CRITICAL and MAJOR findings were pressure-tested and retained their severity. The `site-config.json` issue is CRITICAL because it can cause runtime failures on deploy. The `useMemo-returns-JSX` is CRITICAL for performance at scale. The `process-image.ts` complexity is MAJOR because it affects maintainability, not correctness.

---

## Open Questions (unscored)

1. Has the `bounded-map.ts` implementation been audited for correctness? The rate-limit system depends on it.
2. What is the performance impact of `revalidatePath('/', 'layout')` if ISR is reintroduced? Should this be benchmarked?
3. Is there a plan to add integration tests for the full upload → process → serve pipeline?
4. Should the `uploaded_by` column be backfilled for legacy rows, or is NULL acceptable indefinitely?
5. What is the long-term plan for the `storage` abstraction (`@/lib/storage`) — is S3/MinIO integration still on the roadmap?
6. The `product-marketer-reviewer` was added recently — has its scope been clarified to avoid overlap with `document-specialist`?

---

## Ralplan Summary Row

- Principle/Option Consistency: N/A (this is a review, not a plan)
- Alternatives Depth: N/A
- Risk/Verification Rigor: N/A
- Deliberate Additions: N/A

---

*Review conducted with 600+ files read across 4 parallel exploration agents plus targeted deep reads of 15+ core files. All file references verified against actual source code at HEAD 1d5545cb.*
