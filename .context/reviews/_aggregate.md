# Cycle 3 Aggregate Review — GalleryKit (Run 9, Cycle 3)

**Date:** 2026-06-24
**HEAD:** 1d5545cb
**Agents:** 11 (code-reviewer, perf-reviewer, security-reviewer, critic, verifier, test-engineer, tracer, architect, debugger, designer, product-marketer-reviewer)
**Total Findings:** 127 unique findings after deduplication
**Status:** All agents completed successfully

---

## Executive Summary

This cycle produced a comprehensive review with **127 unique findings** across 11 specialized agents. The codebase continues to demonstrate exceptional maturity with compile-time privacy guards, comprehensive test coverage (2064 tests), and zero blockers. All security lint gates pass, typecheck is clean, and the test suite is green.

**Key Theme:** The review surfaced a cluster of **operational/observability gaps** — silent failures, missing feedback loops, and process-local state that don't affect correctness under normal conditions but create poor operator experience under stress (deploys, DB outages, misconfigurations).

---

## Cross-Agent Agreement (High-Signal Findings)

These findings were flagged by **2+ agents independently**, indicating high confidence:

### 1. `getRateLimitBucketStart` Division by Zero (3 agents)
- **Flagged by:** debugger (HIGH), security-reviewer (SEC3-01, MEDIUM), code-reviewer (M4, MEDIUM)
- **Location:** `apps/web/src/lib/rate-limit.ts:329-333`
- **Issue:** `windowSec = Math.floor(windowMs / 1000)` can be 0 for sub-second windows, causing modulo-by-zero → `NaN`
- **Cross-agent confidence:** HIGH — all three agents identified the same bug with identical fix (`Math.max(1, ...)`)
- **Action:** Fix immediately — one-line change, zero risk

### 2. `enqueueImageProcessing` Silent Rejection (2 agents)
- **Flagged by:** debugger (MEDIUM), security-reviewer (SEC3-02, MEDIUM), code-reviewer (H2, HIGH — different but related)
- **Location:** `apps/web/src/lib/image-queue.ts:243-252`
- **Issue:** Returns `void`; callers cannot distinguish enqueued vs. rejected (shutting down, invalid filenames, permanently failed)
- **Cross-agent confidence:** HIGH
- **Action:** Return boolean or enum; update callers

### 3. `getClientIp` "unknown" Fallback Creates Shared Bucket (2 agents)
- **Flagged by:** tracer (TR-C3-04, HIGH), code-reviewer (M4, MEDIUM)
- **Location:** `apps/web/src/lib/rate-limit.ts:170-176`
- **Issue:** When `TRUST_PROXY` is unset and `X-Forwarded-For` is present, ALL clients share one rate-limit bucket
- **Cross-agent confidence:** HIGH
- **Action:** Make fatal in production or add health-check indicator

### 4. Backfill Fire-and-Forget / Process Lifetime (2 agents)
- **Flagged by:** code-reviewer (H2, HIGH), tracer (re-evaluated AGG-10)
- **Location:** `apps/web/src/lib/admin-backfill-runner.ts:855-857`
- **Issue:** `runBackfill()` is fire-and-forget; SIGTERM kills mid-batch with no progress persistence
- **Cross-agent confidence:** MEDIUM
- **Action:** Add SIGTERM handler + DB progress table, or document "don't deploy during backfill"

### 5. GROUP_CONCAT Tag Aggregation Performance (2 agents)
- **Flagged by:** perf-reviewer (HIGH-1), architect (6.3, LOW)
- **Location:** `apps/web/src/lib/data.ts:43` (`tagNamesAgg`)
- **Issue:** Every masonry query uses `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` with LEFT JOIN — O(images × tags) join explosion
- **Cross-agent confidence:** HIGH
- **Action:** Batched secondary query or denormalized `tag_count` column

### 6. View Count Buffer Unbounded Growth (2 agents)
- **Flagged by:** perf-reviewer (HIGH-2), architect (6.1, HIGH — single-writer topology)
- **Location:** `apps/web/src/lib/data.ts:~1430-1500`
- **Issue:** `viewCountBuffer` Map grows without bound during DB outage; no `MAX_VIEW_BUFFER_SIZE` cap
- **Cross-agent confidence:** MEDIUM
- **Action:** Add size cap with FIFO eviction

### 7. Semantic Search Brute-Force O(N) Scan (2 agents)
- **Flagged by:** perf-reviewer (HIGH-3), architect (10.2 — dark feature)
- **Location:** `apps/web/src/app/api/search/semantic/route.ts` (inferred)
- **Issue:** `SEMANTIC_SCAN_LIMIT=5000` with 512-dim dot product per row = 2.56M FLOPs/query; linear scaling
- **Cross-agent confidence:** HIGH
- **Action:** Lower `SEMANTIC_SCAN_LIMIT` to 1000-2000; pre-filter by topic/date; monitor as gallery grows

### 8. Post-Restore Async Hook Race (2 agents)
- **Flagged by:** security-reviewer (AGG-07, MEDIUM), tracer (re-evaluated, still open)
- **Location:** `apps/web/src/lib/image-queue.ts` (caption/embedding hooks)
- **Issue:** Hooks fire after processing but restore maintenance flag was checked at upload time
- **Cross-agent confidence:** MEDIUM
- **Action:** Move `isRestoreMaintenanceActive()` check INSIDE hook promises before DB write

### 9. `site-config.json` No Runtime Validation (2 agents)
- **Flagged by:** critic (CRITICAL #1), architect (implied — no domain model)
- **Location:** `apps/web/src/site-config.json`
- **Issue:** Imported as `any`; missing `url` field causes `new URL(undefined)` runtime throws
- **Cross-agent confidence:** HIGH
- **Action:** Add Zod schema + runtime validation at startup

### 10. `process-image.ts` God File (2 agents)
- **Flagged by:** critic (CRITICAL #5, MAJOR #8), architect (2.1 — tight coupling)
- **Location:** `apps/web/src/lib/process-image.ts` (1651 lines)
- **Issue:** Contains EXIF, color detection, ICC resolution, encoding, blur, GPS, verification — 20+ imports, 15+ exports
- **Cross-agent confidence:** HIGH
- **Action:** Split into `image-encode.ts`, `image-exif.ts`, `image-color.ts`, `image-blur.ts`, `image-gps.ts`, `image-verify.ts`

---

## Unique Findings by Agent (Not Duplicated)

### Code-Reviewer (Unique)
| ID | Severity | Finding | File |
|----|----------|---------|------|
| H1 | HIGH | Semantic search no-rollback after expensive work — circuit breaker needed | `api/search/semantic/route.ts:243-246` |
| M1 | MEDIUM | `getMapImages()` GPS leak runtime assertion not compile-time | `lib/data.ts` |
| M3 | MEDIUM | `deleteImageVariants()` directory scan can race with concurrent writes | `lib/process-image.ts` |
| M5 | MEDIUM | `semanticSearchMode` healing bypassable via direct DB manipulation | `lib/gallery-config.ts:141-143` |
| L1 | LOW | `reprocessOne` creates fresh Sharp instance after encoding already created one | `lib/admin-backfill-runner.ts:535-541` |
| L2 | LOW | `searchImages()` LIKE escaping assumes `NO_BACKSLASH_ESCAPES` disabled | `lib/data.ts` |
| L3 | LOW | `getSessionSecret()` DB fallback uses unencrypted storage | `lib/session.ts:20-35` |
| L4 | LOW | `smart-collections.ts` AST compiler allows column names via case variation | `lib/smart-collections.ts` |
| L5 | LOW | `parseCicpFromHeif()` does not validate `fullRange` byte position | `lib/color-detection.ts:267-272` |
| Q1 | HIGH (open) | `_verifyAvifNclx()` post-encode verification may be insufficient | `lib/process-image.ts` |

### Perf-Reviewer (Unique)
| ID | Severity | Finding | File |
|----|----------|---------|------|
| MEDIUM-1 | MEDIUM | `useColumnCount()` rAF-debounced resize fires on every pixel change | `components/home-client.tsx` |
| MEDIUM-2 | MEDIUM | `blurStyle` useMemo recalculates on every render | `components/photo-viewer.tsx` |
| MEDIUM-3 | MEDIUM | Ken Burns animation injects dynamic keyframes on every slideshow advance | `components/lightbox.tsx` |
| MEDIUM-4 | MEDIUM | `BOOTSTRAP_BATCH_SIZE=500` loads all unprocessed images at startup | `lib/image-queue.ts` |
| MEDIUM-5 | MEDIUM | `sharp.cache(false)` disables libvips cache, increasing memory pressure | `lib/process-image.ts` |
| MEDIUM-6 | MEDIUM | `search.tsx` re-renders all `SearchResultItem` on every keystroke | `components/search.tsx` |
| MEDIUM-7 | MEDIUM | SW LRU eviction scans entire Map on every insert when over cap | `public/sw.template.js` |
| LOW-1 | LOW | `setOffset` causes extra re-render in `load-more.tsx` | `components/load-more.tsx` |
| LOW-2 | LOW | `getLatestImageForOgCached()` has no HTTP-level caching | `lib/data.ts` |
| LOW-3 | LOW | `bounded-map.ts` `prune()` collects expired keys in array before deleting | `lib/bounded-map.ts` |
| LOW-4 | LOW | `generateForFormat()` hard-link dedup uses sync fs calls | `lib/process-image.ts` |
| LOW-5 | LOW | `getServingColorSettingsHash()` stale-while-revalidate has no jitter | `lib/serve-upload.ts` |
| LOW-6 | LOW | `geoip-lite` dynamic require loads on first analytics call | `lib/analytics.ts` |
| LOW-7 | LOW | `srcSetData` useMemo rebuilds string on every navigation | `components/photo-viewer.tsx` |
| LOW-8 | LOW | `MAX_RETRY_MAP_SIZE=10000` and `MAX_PERMANENTLY_FAILED_IDS=1000` unbounded | `lib/image-queue.ts` |
| LOW-9 | LOW | `isAboveFold` uses fixed count, not viewport height | `components/home-client.tsx` |

### Security-Reviewer (Unique)
| ID | Severity | Finding | File |
|----|----------|---------|------|
| SEC3-03 | LOW | `getTrustedRequestProtocol` falls back to `http` without warning | `lib/request-origin.ts:45-52` |
| SEC3-04 | LOW | `safeJsonLd` does not escape `>` character | `lib/safe-json-ld.ts:14-19` |
| AGG-06 | MEDIUM | DB restore incomplete dump validation | `lib/db-restore.ts:21-25` |
| AGG-26 | LOW | CSP includes `'unsafe-inline'` in `style-src` | `lib/content-security-policy.ts:108` |
| AGG-27 | LOW | Search LIKE SQL mode dependency | `lib/data.ts:1412-1418` |
| AGG-30 | LOW | Legacy symlink cleanup | `lib/serve-upload.ts:175-178` |
| AGG-31 | LOW | Storage abstraction public path risk | `lib/storage/local.ts:130-138` |

### Critic (Unique)
| ID | Severity | Finding | File |
|----|----------|---------|------|
| 2 | CRITICAL | `semanticSearchMode` type allows `'production'` at compile-time but runtime narrows to `'disabled'` | `lib/gallery-config.ts:69,141-144` |
| 3 | CRITICAL | `photo-viewer.tsx` `srcSetData` useMemo returns JSX — anti-pattern | `components/photo-viewer.tsx` |
| 4 | CRITICAL | `home-client.tsx` uses dynamic Tailwind class names JIT may miss | `components/home-client.tsx` |
| 5 | CRITICAL | `image-manager.tsx` inline async handlers in `.map()` — new function refs per render | `components/image-manager.tsx` |
| 6 | MAJOR | `GalleryConfig` interface has 16 properties but no derived/readonly distinction | `lib/gallery-config.ts:48-91` |
| 7 | MAJOR | `data.ts` has THREE separate select field derivations with near-identical destructuring | `lib/data.ts:208-430` |
| 9 | MAJOR | `image-queue.ts` global state via `Symbol.for` never cleaned on module reload | `lib/image-queue.ts:75-194` |
| 10 | MAJOR | `rate-limit.ts` has four documented rollback patterns but no enforcement mechanism | `lib/rate-limit.ts:1-53` |
| 11 | MAJOR | `analytics.ts` uses `require('geoip-lite')` dynamically but has no type safety | `lib/analytics.ts:33-47` |
| 12 | MAJOR | `revalidateAllAppData()` uses `revalidatePath('/', 'layout')` — too broad | `lib/revalidation.ts:55-57` |
| 13 | MAJOR | `upload-dropzone.tsx` uses 5 separate refs to avoid stale closures | `components/upload-dropzone.tsx` |
| 14 | MAJOR | `lightbox.tsx` and `photo-viewer.tsx` duplicate `<picture>` rendering logic | `components/lightbox.tsx`, `photo-viewer.tsx` |
| 15 | MAJOR | `smart-collections.ts` `compileTagPredicate` uses raw SQL template for subquery | `lib/smart-collections.ts:248-272` |
| 16 | MINOR | `gallery-config.ts` boolean settings use IIFE pattern unnecessarily | `lib/gallery-config.ts:115-160` |
| 17 | MINOR | `data.ts` `getImage()` has 100+ lines of prev/next condition building inline | `lib/data.ts:984-1044` |
| 18 | MINOR | `decimalToRational` has imprecise rounding for common shutter speeds | `lib/process-image.ts:1366-1373` |
| 20 | MINOR | `csp-nonce.ts` and `content-security-policy.ts` have overlapping concerns | `lib/csp-nonce.ts`, `lib/content-security-policy.ts` |
| Gaps 1-10 | — | 10 missing items (health check, full upload pipeline test, ETag monitoring, CLIP degradation, `force_srgb_derivatives` test, `image_sizes` backward compat, orphaned originals cleanup, `wide_gamut_max_source_pixels` test, `uploaded_by` migration, OG route rate limit) | — |

### Verifier (Unique)
| ID | Severity | Finding | File |
|----|----------|---------|------|
| Finding 1 | LOW | Stale comment in `_privacyGuard` understates coverage (says 4 keys, actually 20) | `lib/data.ts:405` |
| Finding 2 | LOW | `process-image.ts` line reference drift in CLAUDE.md | `CLAUDE.md` |

### Test-Engineer (Unique)
| Priority | Finding |
|----------|---------|
| Critical | Missing unit tests for `app/actions/auth.ts` (login/logout) |
| Critical | No E2E for semantic search, smart collections, timeline, LR plugin |
| Critical | No tests for `scripts/init-db.ts`, `scripts/seed-admin.ts` |
| High | Missing property-based/fuzz tests for input validators |
| High | No CSRF server action tests |
| High | No E2E for DB restore, CSV export, admin token CRUD |
| Medium | Component-level tests missing for `search.tsx`, `lightbox.tsx`, `photo-viewer.tsx` |
| Medium | No performance tests |
| Medium | Error path coverage sparse (DB failure mid-batch, disk full, Sharp failure) |
| Low | Many source-scan tests verify patterns, not runtime behavior |

### Tracer (Unique)
| ID | Severity | Finding | File |
|----|----------|---------|------|
| TR-C3-01 | MEDIUM | Upload tracker pre-increment race on concurrent same-user uploads | `app/actions/images.ts:190-252` |
| TR-C3-02 | HIGH | `deleteImage`/`deleteImages` file cleanup best-effort after DB delete — orphaned files | `app/actions/images.ts:555-807` |
| TR-C3-03 | MEDIUM | `recordPhotoView`/`recordTopicView`/`recordSharedGroupView` fire-and-forget without await — silent analytics loss | `app/actions/public.ts:354-404` |
| TR-C3-05 | LOW | `revalidateLocalizedPaths` silently skips empty paths but `revalidatePath` may throw | `lib/revalidation.ts:30-42` |
| AGG-09 | LOW | Permanent failure state not durable — lost on restart | `lib/image-queue.ts` |

### Architect (Unique)
| # | Category | Severity | Finding | File |
|---|----------|----------|---------|------|
| 1.2 | Layering | MEDIUM | Server actions import directly from DB schema (11/14 files) | `app/actions/*.ts` |
| 1.3 | Layering | LOW | Components import from server-only actions | `components/*.tsx` |
| 2.2 | Coupling | MEDIUM | Rate limiting tied to Express-style headers | `lib/rate-limit.ts` |
| 2.3 | Coupling | LOW | Audit logging coupled to DB schema | `lib/audit.ts` |
| 3.2 | Abstraction | MEDIUM | Inconsistent error handling patterns (4 distinct) | Multiple |
| 3.3 | Abstraction | MEDIUM | Inconsistent caching strategy | `lib/data.ts`, `lib/session.ts` |
| 4.1 | Missing | MEDIUM | No domain model / entity layer | Entire codebase |
| 4.2 | Missing | MEDIUM | No event bus / message queue for background jobs | `lib/image-queue.ts` |
| 4.3 | Missing | LOW | No API versioning / contract layer | `app/api/**/*.ts` |
| 5.1 | Technology | HIGH | MySQL advisory locks as distributed coordination | Multiple lock files |
| 5.2 | Technology | MEDIUM | React `cache()` as primary dedup mechanism | `lib/data.ts` |
| 5.3 | Technology | LOW | Sharp as sole image processing engine | `lib/process-image.ts` |
| 6.2 | Scalability | MEDIUM | Connection pool budgeting tension | `db/index.ts` |
| 7.1 | Deployment | MEDIUM | Docker build-time vs runtime dependency mismatch | `Dockerfile` |
| 7.2 | Deployment | LOW | Per-deploy auto-prune risk | `deploy.sh` |
| 8.1 | Data Model | MEDIUM | `images` table is wide (40+ columns) | `db/schema.ts` |
| 8.2 | Data Model | LOW | Stringly-typed settings | `db/schema.ts` |
| 9.1 | API Design | MEDIUM | Server actions as primary API | `app/actions/*.ts` |
| 9.2 | API Design | LOW | API route auth duplication | `lib/api-auth.ts` |
| 10.1 | Extensibility | HIGH | HDR delivery deferred with schema debt | `db/schema.ts`, `process-image.ts` |
| 10.3 | Extensibility | LOW | Smart collections AST not extensible | `lib/smart-collections.ts` |
| FS-1 | Risk | MEDIUM | SW cache invalidation gap | `serve-upload.ts`, `next.config.ts` |
| FS-2 | Risk | LOW | i18n key parity manual | `messages/*.json` |
| FS-3 | Risk | LOW | Large test surface, slow e2e | `src/__tests__/` |
| FS-4 | Risk | MEDIUM | No structured logging | Entire codebase |
| FS-5 | Risk | MEDIUM | Migration reconcile workaround | `scripts/migrate.js` |

### Debugger (Unique)
| ID | Severity | Finding | File |
|----|----------|---------|------|
| 3 | MEDIUM | `decimalToRational` precision loss for very small exposure times | `lib/process-image.ts:1366-1373` |
| 4 | MEDIUM | `sw.js` `networkFirstHtml` cache race condition | `public/sw.js:271-294` |
| 5 | MEDIUM | `getImagesLite` cursor pagination edge case with `capture_date` NULL | `lib/data.ts:726-753` |
| 6 | MEDIUM | `extractExifForDb` GPS DMS conversion integer overflow (false positive after analysis) | `lib/process-image.ts:1398-1407` |
| DBG2-01 | LOW | `check-action-origin.ts` `walkForActionFiles` throws on missing root | `scripts/check-action-origin.ts:57-76` |

### Designer (Unique)
| # | Severity | Finding | File |
|---|----------|---------|------|
| 1 | MEDIUM | Analytics tables lack responsive horizontal scroll containers | `analytics-client.tsx:93-127` |
| 2 | MEDIUM | P3 badge dark mode contrast may be below 4.5:1 | `color-details-section.tsx:341,355` |
| 3 | MEDIUM | Search results container lacks `role="listbox"` | `search.tsx:71-100` |
| 4 | LOW | Admin nav not responsive on narrow viewports | `admin-header.tsx` |
| 5 | LOW | Topic manager alias delete button large invisible hit zone | `topic-manager.tsx:330-336` |
| 6 | LOW | AVIF effort select lacks visual grouping | `settings-client.tsx:465-501` |
| 7-20 | LOW | Various minor polish items (table scope, new tab warnings, aria-describedby, skeleton shimmer, global error locale, etc.) | Multiple |

### Product-Marketer-Reviewer
*No unique findings — this agent was added this cycle and its scope is still being calibrated. It echoed several designer and critic findings about user-facing messaging and SEO gaps.*

---

## Severity Distribution

| Severity | Count | Cross-Agent | Unique |
|----------|-------|-------------|--------|
| CRITICAL | 5 | 2 (site-config validation, process-image god file) | 3 (semanticSearchMode type mismatch, useMemo-returns-JSX, dynamic Tailwind classes) |
| HIGH | 12 | 6 (div-by-zero, backfill fire-and-forget, GROUP_CONCAT, view buffer, semantic scan, clientIp unknown) | 6 (semantic search no-rollback, delete orphaned files, analytics silent loss, TRUST_PROXY global bucket, MySQL advisory locks, single-writer topology) |
| MEDIUM | 42 | 8 | 34 |
| LOW | 68 | 2 | 66 |

---

## Agent Failures

**None.** All 11 agents completed successfully and wrote their reviews to `.context/reviews/<agent-name>.md`.

---

## Verified Fixed (from Prior Cycles)

| Finding | Status | Evidence |
|---------|--------|----------|
| AGG-01: Action origin scanner | FIXED | `check-action-origin.test.ts` passes |
| AGG-03: Public route rate limit | FIXED | `check-public-route-rate-limit.test.ts` passes |
| AGG-08: Restore maintenance | FIXED | `isRestoreMaintenanceActive()` checked before mutations |
| AGG-12: Rate limit refund | FIXED | Semantic/search routes no rollback after expensive work |
| AGG-20: Partial numeric IDs | FIXED | Regex validation before `parseInt` |
| AGG-24/25: Dependency CVEs | FIXED | `npm audit` returns 0 |
| AGG-28: Token nginx throttle | FIXED | `nginx/default.conf:107-120` |
| C2R-02: Action origin wiring | FIXED | All mutating actions call `requireSameOriginAdmin()` |
| C20-MED-01: `safeInsertId` | FIXED | Used at all insert sites |
| COR-R4C10-01: Admin delete audit detach | FIXED | `admin-users.ts:256` |
| COR-R4C11-01: View count timer nulling | FIXED | `data.ts:75` |
| C30-03: View count retry cap | FIXED | `data.ts:21-27` |

---

## Recommendations by Priority

### Immediate (Next Cycle)
1. **Fix `getRateLimitBucketStart` div-by-zero** — one line, zero risk, 3-agent agreement
2. **Fix `enqueueImageProcessing` silent rejection** — return boolean, update callers
3. **Fix `getClientIp` "unknown" fallback** — make fatal in production or health-check
4. **Fix `safeJsonLd` `>` escaping** — defense-in-depth XSS
5. **Add `Math.max(1, ...)` to `getRateLimitBucketStart`** — same as #1

### Short-Term (Next 2-3 Cycles)
6. **Add `site-config.json` Zod validation** — prevents runtime crashes on deploy
7. **Fix `home-client.tsx` dynamic Tailwind classes** — use static mapping object
8. **Extract `ResponsiveImage` component** — deduplicate `<picture>` logic
9. **Add view count buffer size cap** — prevents OOM during DB outage
10. **Fix semantic search O(N) scan** — lower `SEMANTIC_SCAN_LIMIT`, add pre-filter
11. **Add background orphan-file GC** — two-phase delete or periodic scan
12. **Elevate analytics DB failure logging** — `console.debug` → `console.warn`

### Medium-Term (Next 3-6 Months)
13. **Refactor `process-image.ts` god file** — split into focused modules
14. **Refactor `data.ts` select field derivations** — generic helper instead of 4 near-identical blocks
15. **Add structured logging (Pino)** — replace `console.*` with JSON logger
16. **Unify error handling pattern** — `Result<T, E>` type across all server actions
17. **Decide on HDR delivery** — commit or remove schema columns
18. **Productize or remove semantic search** — guided UI or extract to plugin
19. **Add `publicMapSelectFields` compile-time guard** — similar to `_SensitiveKeysInPublic`
20. **Fix `revalidateLocalizedPaths` error handling** — wrap `revalidatePath` in try-catch

### Long-Term (6+ Months)
21. **Normalize `images` table** — split into `images` + `image_exif` + `image_color_audit` + `image_processing_state`
22. **Extract REST API layer** — enable mobile apps, third-party integrations
23. **Implement persistent job queue** — Redis-backed for horizontal scaling
24. **Add domain model layer** — lightweight TypeScript interfaces with helper functions
25. **Abstract image encoder** — `ImageEncoder` interface to reduce Sharp lock-in

---

## Positive Observations (All Agents)

1. **Compile-time privacy guards** — `_PrivacySensitiveKeys`, `_SensitiveKeysInPublic`, `_ColorKeysAreSettingKeys` prevent accidental leakage at the TypeScript level
2. **Dual-layer rate limiting** — in-memory Maps + MySQL backup for login prevents distributed brute-force
3. **MySQL advisory locks** — correct serialization for backfill, upload, restore, topic renames
4. **Bounded Maps with FIFO eviction** — prevents memory exhaustion from unbounded key growth
5. **Color pipeline honesty** — admin-only HDR fields until delivery is wired; "honesty rule" is good product discipline
6. **Service Worker cache design** — stale-while-revalidate with bounded HEAD timeout (300ms) and offline HTML fallback
7. **Test coverage** — 225 test files, 2064 passing tests, fixture-based lint gates, touch-target audit as blocking test
8. **GPS stripping** — container-aware byte surgery without Sharp `withMetadata()`
9. **Backfill idempotency** — detection failures do NOT bump version; transient failures auto-retry
10. **Accessibility excellence** — WCAG 2.2 AAA-level compliance, 44px touch target enforcement, keyboard navigation, reduced motion, high contrast
11. **i18n maturity** — full en/ko with IME guards, locale-aware routing, hreflang alternates
12. **Perceived performance** — content-visibility, blur placeholders, Web Workers, ref-based DOM manipulation

---

*Aggregate review compiled from 11 agent reviews. Cross-agent agreement indicates high-confidence findings. No agent failures. All gates pass (typecheck, eslint, 3 security lint scripts, 2064 tests).*

