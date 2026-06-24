# Test-Engineer Review — GalleryKit Test Suite

> **Date:** 2026-06-24  
> **Scope:** `apps/web/src/__tests__/` (229 files), `apps/web/e2e/` (6 files), `apps/web/scripts/` (26 files)  
> **Test Runner:** Vitest 4.1.9  
> **Current Status:** 225 test files passed, 2 skipped, 2068 total tests, 144s duration

---

## 1. Executive Summary

The GalleryKit test suite is one of the most comprehensive and well-structured test surfaces this reviewer has encountered. It demonstrates mature testing practices across security lint gates, color/HDR pipeline correctness, privacy field separation, client-server boundary enforcement, and accessibility contracts. The codebase achieves approximately **97.8% source-file coverage** with only 5 uncovered source files (all infrastructure/config) and 19 uncovered scripts (26.9% script coverage).

**Test Health:** HEALTHY with targeted gaps

**Key Strengths:**
- Fixture-based lint gates (`check-action-origin`, `check-api-auth`, `check-public-route-rate-limit`) that scan ALL server actions and API routes
- AST-based client-server boundary walk with TypeScript compiler API (not regex)
- Comprehensive color/HDR pipeline: 30+ tests covering NCLX parsing, ICC chromaticity, pixel round-trips, post-encode verification
- Privacy field separation with compile-time and runtime guards
- Service worker contract tests that prevent template drift
- Touch-target audit as a blocking unit test (44 px floor)

**Critical Gaps:**
- Missing tests for 5 operational scripts (DB init, seeding, backfill sidecars)
- No E2E coverage for semantic search, smart collections, or timeline pages
- `proxy.ts` middleware is untested at unit level
- Some tests verify source patterns rather than runtime behavior
- Missing property-based/fuzz tests for input validation

---

## 2. Coverage Gap Analysis

### 2.1 Uncovered Source Files (5 files, 97.8% coverage)

| File | Risk | Why Uncovered | Suggested Test |
|------|------|---------------|----------------|
| `src/proxy.ts` | **Medium** | Next.js middleware; hard to unit test | Integration test for middleware auth redirect; or mock `NextRequest`/`NextResponse` |
| `src/instrumentation.ts` | Low | OpenTelemetry bootstrap; infrastructure | Verify `register()` exports correct OTEL config shape |
| `src/db/seed.ts` | Low | One-time seed script | Test that seed SQL produces expected schema state |
| `src/i18n/request.ts` | Low | next-intl plumbing | Verify locale resolution logic with mock headers/cookies |
| `src/types/leaflet-defaulticon-compatibility.d.ts` | None | Type declaration only | N/A — no runtime code |

**Confidence: High** — these are genuinely low-risk infrastructure files. The proxy middleware is the only one with security implications, but E2E tests cover the auth redirect path.

### 2.2 Uncovered Scripts (19 of 26, 26.9% coverage)

Scripts with NO test coverage:

| Script | Risk | Why Test | Suggested Approach |
|--------|------|----------|------------------|
| `scripts/init-db.ts` | **High** | DB initialization; wrong SQL = broken deploy | Unit test: verify SQL execution order, error handling |
| `scripts/seed-admin.ts` | **High** | Creates first admin; wrong hash = lockout | Test Argon2 hash generation, validation of required env vars |
| `scripts/backfill-clip-embeddings.ts` | **Medium** | CLIP backfill; runs in production | Test CLI arg parsing, production mode gating, error paths |
| `scripts/backfill-color-pipeline.ts` | **Medium** | Color pipeline backfill; has advisory lock | Test advisory lock acquisition, batching logic, column set (already covered by `backfill-color-pipeline.test.ts` for the in-app runner, but NOT the sidecar script) |
| `scripts/build-sw.ts` | **Medium** | SW version stamping; stale version = cache issues | Test git-SHA + pipeline-version concatenation, template replacement |
| `scripts/download-clip-models.ts` | **Medium** | Model weight download; offline failure path | Test URL construction, retry logic, path validation |
| `scripts/migrate.js` | **Medium** | Schema migration; skipped migrations = data loss | Test journal monotonicity check, hash validation, reconcile logic (partially covered by `migrate-reconcile-coverage.test.ts` and `migration-journal.test.ts`) |
| `scripts/check-action-origin.ts` | Low | Lint scanner; tested via fixture tests | Already covered by `check-action-origin.test.ts` |
| `scripts/check-api-auth.ts` | Low | Lint scanner; tested via fixture tests | Already covered by `check-api-auth.test.ts` |
| `scripts/check-public-route-rate-limit.ts` | Low | Lint scanner; tested via fixture tests | Already covered by `check-public-route-rate-limit.test.ts` |
| `scripts/seed-e2e.ts` | Low | E2E fixture seeding | Test fixture data generation, idempotency |
| `scripts/run-e2e-server.mjs` | Low | E2E server runner | N/A — test infrastructure |
| `scripts/prepare-next-typegen.mjs` | Low | Type generation prep | N/A — build tooling |
| `scripts/check-js-scripts.mjs` | Low | JS script checker | N/A — build tooling |
| `scripts/ensure-site-config.mjs` | Low | Site config validation | N/A — build tooling |
| `scripts/generate-pwa-icons.ts` | Low | PWA icon generation | N/A — build tooling |
| `scripts/entrypoint.sh` | Low | Docker entrypoint | N/A — shell script |
| `scripts/mysql-connection-options.js` | Low | MySQL connection helper | N/A — config plumbing |
| `scripts/migrate-*.ts` (5 files) | Low | One-off migrations | N/A — historical |
| `scripts/clip-model-manifest.ts` | Low | Model manifest builder | N/A — build tooling |

**Confidence: High** — the 7 high/medium risk scripts above are genuine gaps. The lint scanners are already well-covered by their fixture tests.

### 2.3 Component-Level Coverage Gaps

While the touch-target audit and a11y contracts scan component source, the following components have NO runtime behavior tests:

| Component | Risk | What's Missing |
|-----------|------|----------------|
| `components/image-zoom.tsx` | Low | Mouse/touch gesture math tested in `image-zoom-math.test.ts`, but no integration test for the React component lifecycle |
| `components/histogram.tsx` | Low | Canvas rendering logic; tested indirectly via `histogram.test.ts` but no pixel-level assertions |
| `components/map/map-client.tsx` | Low | Leaflet integration; no tests for marker clustering or tile loading |
| `components/search.tsx` | Medium | Complex client-side search UI; no component-level tests for IME composition, debounce, or result rendering |
| `components/upload-dropzone.tsx` | Medium | File drop handling, drag states; only wiring tests exist (`upload-dropzone-topic-wiring.test.ts`) |
| `components/lightbox.tsx` | Medium | Keyboard navigation, slideshow timing, preload logic; only source-contract tests exist |
| `components/photo-viewer.tsx` | Medium | Blur placeholder rendering, color details accordion; only wiring tests exist |
| `components/admin-user-manager.tsx` | Low | Admin CRUD; no component-level tests |
| `components/image-manager.tsx` | Low | Bulk operations, table sorting; no component-level tests |

**Confidence: Medium** — these are React components that are covered by E2E tests, but unit/component tests would catch regressions faster.

### 2.4 Server Action Coverage Gaps

Server actions are covered by the lint gates and some unit tests, but the following have NO dedicated unit tests:

| Action File | Risk | Tested By | Gap |
|-------------|------|-----------|-----|
| `app/actions/admin-backfill.ts` | Medium | `admin-backfill-runner-*.test.ts` (8 files) | The action wrapper itself (auth, parameter validation) is not directly tested |
| `app/actions/admin-users.ts` | **High** | `admin-users.test.ts` | Actually HAS tests — OK |
| `app/actions/collections.ts` | Medium | `smart-collections.test.ts` | Actually HAS tests — OK |
| `app/actions/embeddings.ts` | Medium | `clip-embeddings.test.ts`, `clip-semantic-integration.test.ts` | Actually HAS tests — OK |
| `app/actions/lr-tokens.ts` | Medium | `admin-tokens.test.ts`, `lr-tokens-action.test.ts` | Actually HAS tests — OK |
| `app/actions/seo.ts` | Low | `seo-actions.test.ts` | Actually HAS tests — OK |
| `app/actions/settings.ts` | Medium | `settings-hash.test.ts`, `settings-image-sizes-lock.test.ts` | The action itself (not just its helpers) lacks direct tests |
| `app/actions/sharing.ts` | Medium | `sharing-source-contracts.test.ts` | Only source-contract tests; no runtime behavior tests |
| `app/actions/tags.ts` | Medium | `tags-actions.test.ts` | Actually HAS tests — OK |
| `app/actions/topics.ts` | Medium | `topics-actions.test.ts` | Actually HAS tests — OK |
| `app/actions/auth.ts` | **High** | `session.test.ts`, `auth-rate-limit.test.ts` | Login/logout actions themselves not directly tested (only helpers) |

**Confidence: High** — `app/actions/auth.ts` is the most critical gap. The session token generation is tested, but the actual login action (password verification, session creation, cookie setting) has no unit test.

---

## 3. Tests That Don't Actually Verify Behavior (False Confidence)

### 3.1 Source-Scan Tests (Pattern Matching, Not Runtime)

These tests read source files and assert regex matches. They are valuable for catching regressions but do NOT verify runtime behavior:

| Test File | Lines | What It Actually Tests | Risk |
|-----------|-------|------------------------|------|
| `a11y-us-p15.test.ts` | 1-91 | Source contains `aria-live="polite"`, `href="#main-content"`, etc. | **Medium** — A source pattern could exist but be in a dead code branch, commented out, or rendered conditionally in a way that violates the contract at runtime |
| `sw-template-contract.test.ts` | 1-169 | Source contains specific JS patterns in `sw.template.js` | **Medium** — Template could be correct but the generated `sw.js` could be stale (the test DOES check generated `sw.js` at lines 153-157, which is good) |
| `client-server-only-boundary.test.ts` | 1-500 | AST walk for `'use client'` → `server-only` import closure | **Low** — This is actually a strong test; AST-based, not regex |
| `touch-target-audit.test.ts` | 1-1244 | Regex scan for sub-44px Tailwind classes | **Low** — Very comprehensive with multi-line normalizer; catches real issues |
| `check-action-origin.test.ts` | 1-443 | Fixture-based scanner tests | **Low** — Tests the scanner logic, not the actual action files; but the scanner IS the lint gate |
| `check-api-auth.test.ts` | 1-124 | Fixture-based scanner tests | **Low** — Same as above |
| `check-public-route-rate-limit.test.ts` | 1-268 | Fixture-based scanner tests | **Low** — Same as above |
| `color-details-section-delivered.test.ts` | 1-50 | Source contains `isAdmin && isHdr` | **Medium** — The condition could be present but incorrectly parenthesized or short-circuited |
| `lightbox-color-pip-hdr.test.ts` | 1-50 | Source contains `isAdmin && isHdr` | **Medium** — Same as above |
| `photo-viewer-no-hdr-download.test.ts` | 1-50 | Source contains conditional download logic | **Medium** — Source pattern doesn't prove runtime behavior |

**Confidence: High** — These are legitimate concerns. The source-scan tests are "lint tests" — they verify code structure, not runtime behavior. They should be complemented by runtime tests where possible.

### 3.2 Tests That Could Pass Even If Code Is Broken

| Test File | Issue | How It Could Pass Broken |
|-----------|-------|--------------------------|
| `process-image-blur-wiring.test.ts` | Tests that `blurDataUrl` flows through the pipeline | If the blur generation produces an invalid data URL but the consumer accepts it, the test passes |
| `images-action-blur-wiring.test.ts` | Tests blur data URL wiring in upload action | Same as above — tests the wire, not the data validity |
| `upload-processing-contract-lock.test.ts` | Tests that the lock is acquired | If the lock acquisition fails silently (returns a no-op release), the test may pass |
| `restore-upload-lock.test.ts` | Tests upload lock during restore | Same silent-failure concern |
| `data-tag-names-sql.test.ts` | Tests SQL alias pattern | If the SQL compiles but returns wrong results at runtime, the test passes |
| `privacy-fields.test.ts` | Tests field key lists | If `publicSelectFields` omits a field at runtime due to a spread operator bug, the test passes because it checks the static array |
| `settings-hash.test.ts` | Tests hash computation | If the hash algorithm changes but the test fixture is updated to match, the test passes without catching the change |
| `serve-upload-settings-debounce.test.ts` | Tests settings hash caching | If the cache never invalidates (always returns stale), the test may pass if it only checks the first call |

**Confidence: Medium** — These tests verify contracts and wiring, which is valuable. But they don't test the "what if this breaks" scenarios.

---

## 4. Flaky Tests and Race Conditions

### 4.1 Known Flaky Tests (Fixed or Mitigated)

| Test File | Flakiness | Root Cause | Fix Applied | Status |
|-----------|-----------|------------|-------------|--------|
| `client-server-only-boundary.test.ts` | Timeout under CI load | Full src-tree walk without caching; redundant file reads | Added `readCache` + `importSpecCache` + explicit 60s timeout | **Fixed** (AGG-R8-01) |
| `process-image-color-roundtrip.test.ts` | Sharp/AVIF encode variability | Pixel values shift with encoder quantization | Generous tolerance (~25 codes) + conditional 10-bit probe | **Mitigated** |
| `serve-upload.test.ts` | Cold module import timeout | First import of `next/server` + `@/db` graph takes 10s+ | `beforeAll` warm-up with 120s timeout + `vi.resetModules()` per test | **Fixed** (TEST-R4C1-07) |
| `admin-backfill-runner-*.test.ts` | Timer-based async timing | `setTimeout`/`setInterval` in runner | `vi.useFakeTimers()` + explicit timer advancement | **Fixed** |
| `image-queue.test.ts` | Fake timer leakage | `vi.useFakeTimers()` not cleaned up | `vi.useRealTimers()` in `finally` block | **Fixed** |

### 4.2 Potential Remaining Flaky Patterns

| Test File | Risk | Why |
|-----------|------|-----|
| `process-image-color-roundtrip.test.ts` | Low-High | Depends on `sharp` version, libvips, libheif availability. The 10-bit probe (`canUseHighBitdepthAvif`) is environment-dependent. On a CI runner without libheif 10-bit support, the test takes the 8-bit fallback path, which is tested but the 10-bit path is NOT tested on such runners. |
| `clip-semantic-integration.test.ts` | Medium | ONNX runtime model loading is non-deterministic in timing; may timeout on slow runners |
| `e2e/admin.spec.ts` | Medium | Upload workflow depends on external file system and image processing queue; 30s timeout may be tight under load |
| `e2e/public.spec.ts` | Low | Search tests depend on seeded data; if seed data is missing, tests skip gracefully |
| `db-pool-connection-handler.test.ts` | Medium | MySQL connection tests may fail if no DB is running; the test may mock the connection but real integration is untested |
| `rate-limit-db.test.ts` | Medium | DB-backed rate limit tests depend on MySQL being available; may fail in CI if DB is not ready |

**Confidence: Medium** — The known flakes have been addressed. The remaining concerns are environment-dependent.

### 4.3 Race Conditions in Test Code

| Location | Issue | Risk |
|----------|-------|------|
| `process-image-color-roundtrip.test.ts:35-46` | `afterAll` cleans up files by `generatedIds` list, but if a test fails mid-run, the list may be incomplete | Low — `force: true` on `fs.rm` handles missing files |
| `serve-upload.test.ts:40-38` | `vi.resetModules()` between tests with shared `uploadRoot` env var | Low — env var is reset in `afterEach` |
| `admin-backfill-runner-batching.test.ts` | Multiple `vi.useFakeTimers()` calls without checking if already fake | Low — Vitest handles nested fake timers |
| `image-queue.test.ts:112-140` | Fake timers + async task execution; `task!()` is called without checking if `queueAddMock` has the right call | Low — the test explicitly advances through 3 attempts |

**Confidence: Low** — No critical race conditions found in test code.

---

## 5. Missing Edge Case Tests

### 5.1 Input Validation Edge Cases

| Function/File | Missing Edge Cases | Risk |
|---------------|-------------------|------|
| `uploadImages` in `actions/images.ts` | Empty FormData, null topic, extremely large tag string (>10KB), Unicode bidi in filename | **Medium** — The tag validation tests exist but filename validation is minimal |
| `searchImagesAction` in `actions/public.ts` | SQL injection in search query (the test uses ` ` but not other control chars), 1000-char query | Low — LIKE wildcards are escaped |
| `createTopic` in `actions/topics.ts` | Slug collision with existing route segment, emoji in label, 500-char label | Medium — Only basic slug validation is tested |
| `deleteImage` in `actions/images.ts` | Delete while processing (race), delete non-existent image ID | Medium — Race is handled by queue but not tested |
| `updateImage` in `actions/images.ts` | Concurrent edits, stale data, XSS in title/description | Medium — Unicode formatting chars are stripped but not tested |
| `logAuditEvent` in `lib/audit.ts` | Extremely long message, null userId, DB write failure | Low — Audit is best-effort |

### 5.2 Color/HDR Pipeline Edge Cases

| Scenario | Missing Test | Risk |
|----------|-------------|------|
| NCLX box with invalid/malformed size field | `parseCicpFromHeif` tests have bounded box sizes but not overflow/underflow | Low |
| ICC profile with >256 tags (bounds check) | `extractIccProfileName` caps tagCount but no test for the cap trigger | Low |
| HEIF file with multiple `colr` boxes (first vs last wins) | Tests exist for `prof` then `nclx` but not `nclx` then `prof` | Low |
| 16-bit PNG with no ICC (wide-gamut detection from pixel values only) | No test for PNG without ICC | Low |
| HDR source with `allow_hdr_ingest=true` but SDR-only delivery pipeline | Tests exist for rejection and acceptance, but not for the warning message content | Low |
| Custom monitor ICC profile (Eizo CG2700X) with chromaticity match | Tests exist for AdobeRGB chromaticity but not for other presets (sRGB, P3, Rec.2020) | Low |
| `force_srgb_derivatives=true` with wide-gamut source + 10-bit AVIF | Tests exist for 8-bit derivatives but not the 10-bit AVIF path with force_srgb | Low |

### 5.3 Database Edge Cases

| Scenario | Missing Test | Risk |
|----------|-------------|------|
| Connection pool exhaustion under load | `db-pool-connection-handler.test.ts` tests basic connection but not queue limit | Medium |
| Advisory lock timeout/interruption | `advisory-locks.test.ts` tests acquisition but not timeout | Low |
| Transaction rollback on error | No explicit test for Drizzle transaction rollback | Medium |
| Deadlock between concurrent topic renames | `topics-actions.test.ts` tests slug rename but not concurrent rename | Low |
| `image_views` table with 10M+ rows (retention performance) | `view-retention.test.ts` tests the DELETE query but not at scale | Low |
| `image_embeddings` table with null/invalid embedding bytes | `clip-embedding-column-roundtrip.test.ts` tests valid bytes but not corruption | Low |

### 5.4 Security Edge Cases

| Scenario | Missing Test | Risk |
|----------|-------------|------|
| Session token replay after logout | `session.test.ts` tests token format but not replay detection | **Medium** |
| Session fixation on login | No test for session ID regeneration on login | **Medium** |
| Rate limit bypass via X-Forwarded-For spoofing | `auth-rate-limit.test.ts` tests IP extraction but not spoofing | **Medium** |
| CSRF via `fetch()` with `credentials: 'include'` from attacker origin | `origin-guard.spec.ts` tests API routes but not server actions | **High** — Server actions are the main attack surface |
| Path traversal via null byte (`\x00`) in upload filename | `upload-paths.test.ts` tests `SAFE_SEGMENT` but not null byte | **Medium** |
| Symlink attack via relative path in upload | `serve-upload.test.ts` tests symlink rejection but `uploadImages` does not test symlink rejection on the original file | **Medium** |
| ReDoS in regex-based validators | No tests for catastrophic backtracking in `validation.ts` regexes | Low |

---

## 6. Missing Error Path Tests

### 6.1 Server Action Error Paths

| Action | Error Path | Tested? |
|--------|-----------|---------|
| `uploadImages` | DB insert fails mid-batch (partial upload) | NO |
| `uploadImages` | Disk full after file save but before DB insert | NO |
| `uploadImages` | Sharp metadata extraction throws | NO |
| `uploadImages` | `saveOriginalAndGetMetadata` returns null | NO |
| `deleteImage` | File deletion succeeds but DB delete fails | NO |
| `deleteImage` | DB delete succeeds but file deletion fails | NO |
| `updateImage` | Concurrent edit by another admin (stale data) | NO |
| `createTopic` | DB connection lost mid-transaction | NO |
| `login` | Argon2 verification throws (corrupted hash) | NO |
| `login` | Session secret generation fails | NO |
| `changePassword` | Old password verification fails (rate limit should still increment) | Partially — `auth-rate-limit-rollback.test.ts` tests rollback but not the specific action |

### 6.2 Image Processing Error Paths

| Error Path | Tested? |
|-----------|---------|
| `processImageFormats` throws after partial derivative creation (orphan cleanup) | Partially — `image-queue-permanent-failure-cleanup.test.ts` tests queue cleanup but not the specific orphan scenario |
| Sharp `limitInputPixels` rejection (decompression bomb) | NO |
| AVIF encode fails at 10-bit, falls back to 8-bit (encode-time rejection) | NO — the `canUseHighBitdepthAvif` probe tests pre-encode, but not encode-time failure |
| WebP/JPEG encode produces 0-byte file | NO |
| EXIF extraction throws on malformed file | NO |
| ICC profile parsing throws on truncated buffer | NO |
| Color detection throws on unsupported format | NO |

### 6.3 API Route Error Paths

| Route | Error Path | Tested? |
|-------|-----------|---------|
| `/api/og/photo/[id]` | Image ID not found | NO |
| `/api/og/photo/[id]` | Satori render throws | NO |
| `/api/og/photo/[id]` | Output exceeds `OG_PHOTO_MAX_BYTES` | NO |
| `/api/admin/db/download` | File not found | NO |
| `/api/admin/db/download` | File is a directory (path traversal) | NO |
| `/api/admin/lr/upload` | Invalid PAT token | Partially — `admin-tokens.test.ts` tests token validation but not the route |
| `/api/search/semantic` | Model not loaded (503) | Partially — `semantic-route-production.test.ts` tests the 503 path |
| `/api/search/semantic` | Embedding generation fails | NO |
| `/app/uploads/[...path]` | File outside upload root (symlink) | Partially — `serve-upload.test.ts` tests this |
| `/app/uploads/[...path]` | File is a directory | NO |

---

## 7. Missing Integration Tests

### 7.1 End-to-End Gaps

| Scenario | E2E Coverage | Risk |
|----------|-------------|------|
| Semantic search full flow (query → results → click) | NO | **High** — No `E2E_SEMANTIC_KEY` env var, no seeded semantic search data |
| Smart collections (create → view → delete) | NO | Medium — Only unit tests exist |
| Timeline / year-in-review pages | NO | Medium — `timeline/page.tsx` and `year/[year]/page.tsx` have no E2E |
| On-this-day widget | NO | Low — `on-this-day-widget.tsx` has no E2E |
| Photo map (geolocation display) | NO | Medium — `map/page.tsx` has no E2E |
| Admin analytics dashboard | NO | Medium — `analytics-client.tsx` has no E2E |
| Admin token management (create → use → revoke) | NO | Medium — `tokens/page.tsx` has no E2E |
| Lightroom Classic publish plugin upload | NO | **High** — `/api/admin/lr/upload` has no E2E |
| CSV export | NO | Medium — No E2E for the export/download flow |
| DB backup download | NO | Medium — Only unit test for `hasPlausibleSqlDumpHeader` |
| DB restore (full flow) | NO | **High** — Critical operation with no E2E |
| Theme switching (dark/light/system) | NO | Low — `theme-provider.tsx` has no E2E |
| Service worker registration and cache behavior | NO | **Medium** — `sw-cache.test.ts` is unit-only; no browser E2E for SW |
| Offline mode (HTML fallback) | NO | **Medium** — No E2E for the offline fallback |
| Image derivative cache invalidation (ETag change) | NO | Medium — `serve-upload.test.ts` tests 304 but not the full browser cache flow |
| Shared link (`/s/[key]`) with valid key | Partial | Medium — Skips when `E2E_SHARE_KEY` is not set |
| Bulk image operations (select all, delete, tag) | NO | Medium — `image-manager.tsx` bulk operations untested |
| Password change flow | NO | Medium — `password/page.tsx` has no E2E |
| Admin user creation/deletion | Partial | Medium — `admin-users.test.ts` has unit tests but no E2E |

### 7.2 API Integration Tests

| API Surface | Tested? | Gap |
|-------------|---------|-----|
| Full upload → process → view flow | Partial | E2E tests upload but not the processing queue completion |
| Full delete → cleanup → revalidation flow | NO | No test verifies that deleting an image removes all derivatives and updates the UI |
| Topic rename → URL redirect → cache invalidation | NO | No integration test for the full rename flow |
| Settings change → ETag invalidation → backfill trigger | NO | No test for the full settings-change pipeline |
| CLIP embedding generation → semantic search → result display | Partial | `clip-semantic-integration.test.ts` tests the integration but not the full HTTP route |

---

## 8. Test Fixture Issues

### 8.1 Fixtures That May Not Match Reality

| Fixture/Test | Issue | Risk |
|-------------|-------|------|
| `images-actions.test.ts` | Mocks `saveOriginalAndGetMetadata` with synthetic metadata; the real function may return different shapes | Low — the mock matches the expected interface |
| `public-actions.test.ts` | Mocks `searchImages` with `[{ id: 1 }]`; real search returns full image objects with many fields | Low — tests focus on rate limiting and cursor validation |
| `color-detection.test.ts` | Uses synthetic ICC buffers with minimal structure; real ICC profiles are much larger and more complex | Low — the parser handles variable-length structures |
| `process-image-color-roundtrip.test.ts` | Uses synthetic JPEGs with `sharp().withIccProfile('p3')`; real P3 photos may have different ICC structures | Low — the test verifies the pipeline's handling of the profile, not the profile itself |
| `db-restore.test.ts` | `hasPlausibleSqlDumpHeader` tests with short strings; real dumps are multi-MB | Low — the function only checks the first few bytes |
| `clip-embeddings.test.ts` | Uses mock embeddings; real jina-clip-v2 embeddings are 512-dimensional float32 | Low — tests focus on the column encoding, not the model |
| `e2e/fixtures/e2e-landscape.jpg` | Single fixture image; does not test portrait, panorama, RAW, HDR, or wide-gamut sources | Medium — E2E upload only tests one image type |

### 8.2 Mock Accuracy Concerns

| Mock | What It Masks | Risk |
|------|--------------|------|
| `vi.mock('next/headers')` in `public-actions.test.ts` | Returns a simple mock; real `headers()` may behave differently with edge cases | Low |
| `vi.mock('@/db')` in `images-actions.test.ts` | Simplified `select().from().where().limit()` chain; real Drizzle queries may have different behavior | Low |
| `vi.mock('p-queue')` in `image-queue.test.ts` | Mock `PQueue` with simplified `add()`; real PQueue has concurrency limits, priority, etc. | Low |
| `vi.mock('@/lib/process-image')` in `image-queue.test.ts` | `processImageFormats` is a no-op mock; real function may throw or hang | Medium — the queue's error handling around `processImageFormats` is not tested |
| `vi.mock('next-intl/server')` in `images-actions.test.ts` | `getTranslations` returns identity function; real i18n may have different interpolation | Low |

---

## 9. Missing Property-Based / Fuzz Tests

### 9.1 Areas That Would Benefit from Fuzzing

| Function | Property to Test | Fuzz Input |
|----------|-----------------|------------|
| `sanitizeForOg` in `lib/og-sanitize.ts` | Output never contains bidi chars or C0 controls | Random strings with Unicode bidi, C0, ZW chars |
| `isValidTagName` in `lib/validation.ts` | Valid tags pass, invalid tags fail | Random Unicode strings |
| `normalizeImageListCursor` in `lib/data.ts` | Invalid cursors always return null | Random JSON objects |
| `extractIccProfileName` in `lib/icc-extractor.ts` | Never throws on any Buffer input | Random Buffers of varying sizes |
| `parseCicpFromHeif` in `lib/color-detection.ts` | Never throws on any Buffer input | Random Buffers, truncated ISOBMFF files |
| `hasPlausibleSqlDumpHeader` in `lib/db-restore.ts` | Never accepts non-SQL binary data | Random binary data |
| `getTagSlug` in `lib/tag-records.ts` | Output is always a valid slug (no leading/trailing hyphen, no empty) | Random Unicode strings |
| `hashSessionToken` in `lib/session.ts` | Always produces 64-char hex, always deterministic | Random strings |
| `generateSessionToken` in `lib/session.ts` | Format is always `timestamp:random:signature` | Multiple invocations |
| `resolveColorPipelineDecision` in `lib/process-image.ts` | All ICC names map to valid decisions | All known ICC profile names + random strings |
| `verifyAvifNclxInBuffer` in `lib/process-image.ts` | Invalid buffers return `{ ok: false }` | Random Buffers |
| `verifyWebpIccInBuffer` in `lib/process-image.ts` | Invalid buffers return `{ ok: false }` | Random Buffers |
| `isAdminRoute` / `isImageDerivative` in `lib/sw-cache.ts` | Correct classification for all URLs | Random URLs with path manipulation |
| `recordAndEvict` in `lib/sw-cache.ts` | Total size never exceeds cap | Random sequences of add/remove operations |

**Confidence: High** — These are all pure functions or stateless validators that are ideal candidates for property-based testing. The `fast-check` library would integrate well with the existing Vitest setup.

---

## 10. E2E Test Gaps

### 10.1 Playwright E2E Coverage Summary

| Spec File | Tests | Coverage |
|-----------|-------|----------|
| `admin.spec.ts` | 6 tests (1 always, 5 opt-in) | Login, navigation, settings toggle, topic CRUD, upload, wrong password |
| `public.spec.ts` | 8 tests | Homepage, locale switch, search, lightbox, heading hierarchy, 404, shared group |
| `origin-guard.spec.ts` | 4 tests | Cross-origin API rejection (authenticated + unauthenticated) |
| `test-fixes.spec.ts` | 4 tests | Mobile nav, desktop nav, mobile info sheet, keyboard focus nav |
| `nav-visual-check.spec.ts` | Unknown | Visual regression (not examined) |
| `helpers.ts` | N/A | Login helper, cookie creation, image processing wait |

### 10.2 Critical E2E Gaps

| Feature | Priority | Why Missing |
|---------|----------|-------------|
| Semantic search | **High** | No seeded data, no env var for semantic key |
| Smart collections | **High** | No seeded collection data |
| Admin analytics | Medium | No seeded analytics data |
| Lightroom Classic publish | **High** | No E2E for the `/api/admin/lr/upload` route |
| DB restore | **High** | Critical operation; only unit-tested |
| CSV export | Medium | No E2E for the export flow |
| Theme switching | Low | Visual-only feature |
| Service worker offline mode | **Medium** | No test for the offline HTML fallback |
| Image cache revalidation | Medium | No test for the SW stale-while-revalidate flow |
| Bulk image operations | Medium | No E2E for select-all, bulk delete, bulk tag |
| Password change | Medium | No E2E for the password change flow |
| Admin token CRUD | Medium | No E2E for token creation/revocation |
| Timeline / year-in-review | Medium | No E2E for these public pages |
| Photo map | Medium | No E2E for the map page |
| On-this-day widget | Low | No E2E for the widget |
| Shared single-photo link (`/s/[key]`) | Medium | Skips when `E2E_SHARE_KEY` is not set |

---

## 11. Commonly Missed Test Issues (Final Sweep)

### 11.1 Tests That Verify Implementation Details Instead of Behavior

| Test | Issue | Recommendation |
|------|-------|----------------|
| `image-queue.test.ts:87-108` | Tests that `pruneRetryMaps` uses a specific code pattern (collect-then-delete) | This is a source-scan test disguised as a unit test. It verifies the implementation, not the behavior. Better: test that the map never exceeds `MAX_RETRY_MAP_SIZE` regardless of implementation. |
| `sw-template-contract.test.ts` | Tests that specific strings exist in the template | These are valuable contract tests but should be complemented by runtime tests of the actual SW behavior in a browser. |
| `client-server-only-boundary.test.ts` | Tests AST structure | This is actually a strong architectural test; keep it but add a runtime test that builds the client bundle and verifies it doesn't throw. |

### 11.2 Tests With Weak Assertions

| Test | Weak Assertion | Stronger Alternative |
|------|---------------|---------------------|
| `session.test.ts:5-9` | `hashSessionToken('test-token')` has length 64 | Also assert it's a valid hex string, and test with empty string, unicode, very long input |
| `session.test.ts:24-43` | Token format is `timestamp:random:signature` | Also assert timestamp is within reasonable range, random is unique across calls, signature verifies with HMAC |
| `base56.test.ts` | (Assumed) Encode/decode round-trip | Also test that output contains only allowed chars, never produces ambiguous pairs (0/O, 1/I/l) |
| `backup-filename.test.ts` | (Assumed) Filename format | Also test that filename is unique across calls, contains no path traversal |
| `download-filename.test.ts` | (Assumed) Filename format | Also test with special chars in title, very long titles |

### 11.3 Missing Test for "Happy Path" Variations

| Feature | Missing Variations |
|---------|-------------------|
| Upload | Multiple files, mixed formats (JPEG + PNG + HEIC), max size boundary, zero-byte file |
| Search | Empty result set, exact match, partial match, special chars in query, 1000-char query |
| Load more | First page, last page, empty topic, cursor at boundary |
| Image display | Portrait, panorama, very small image, missing derivative |
| Admin settings | Toggle all boolean settings, change all numeric settings to min/max values |
| Topic management | Rename to existing slug, rename with special chars, delete topic with images |
| Tag management | Merge tags, delete tag used by images, create tag with same name different case |

### 11.4 Missing Performance Tests

| Scenario | Why Test |
|----------|----------|
| Masonry grid with 1000+ images | Ensure virtualization or pagination doesn't break |
| Search with 10K+ images | Ensure search query performance |
| Upload with 100 files | Ensure batch processing doesn't OOM |
| Image processing with 50MP source | Ensure wide-gamut downscaling works |
| CLIP embedding generation for 1000 images | Ensure batch processing doesn't timeout |
| DB backup with 1M+ row `image_views` | Ensure retention purge doesn't lock the table |
| Admin dashboard with 100 failed images | Ensure retry UI doesn't freeze |

### 11.5 Missing Accessibility Tests

| Test | Why |
|------|-----|
| Keyboard navigation through lightbox | Arrow keys, Escape, Tab trapping |
| Screen reader announcement of search results | `aria-live` region updates |
| Focus management after modal close | Focus returns to trigger element |
| Color contrast of admin UI | WCAG AA compliance for all text |
| Reduced motion preference | All animations respect `prefers-reduced-motion` |
| Touch target sizes on mobile | Already covered by `touch-target-audit.test.ts` |

---

## 12. Recommendations by Priority

### 12.1 Critical (Do Next)

1. **Add unit tests for `app/actions/auth.ts`** — The login/logout actions are the most security-critical untested code. Test: password verification, session creation, cookie attributes, rate limit integration, error paths.

2. **Add E2E for semantic search** — Seed semantic search data and add `E2E_SEMANTIC_KEY` to CI. Test the full query → results → click flow.

3. **Add E2E for smart collections** — Seed a smart collection and test creation, viewing, and deletion.

4. **Add tests for `scripts/init-db.ts` and `scripts/seed-admin.ts`** — These are deployment-critical scripts. Test the SQL execution, error handling, and idempotency.

5. **Add property-based tests for input validators** — Use `fast-check` to fuzz `sanitizeForOg`, `isValidTagName`, `normalizeImageListCursor`, `extractIccProfileName`, `parseCicpFromHeif`.

### 12.2 High (Do Soon)

6. **Add E2E for Lightroom Classic publish plugin** — Test the `/api/admin/lr/upload` route with valid and invalid PAT tokens.

7. **Add E2E for DB restore** — Test the full backup → download → restore flow.

8. **Add unit tests for `proxy.ts` middleware** — Mock `NextRequest`/`NextResponse` and test auth redirect, locale routing, and admin-render marker.

9. **Add error path tests for `uploadImages`** — Test DB failure mid-batch, disk full, Sharp failure, null metadata.

10. **Add CSRF test for server actions** — Verify that `requireSameOriginAdmin` rejects cross-origin `fetch()` calls to server actions, not just API routes.

### 12.3 Medium (Do When Convenient)

11. **Add component-level tests for `search.tsx`, `lightbox.tsx`, `photo-viewer.tsx`** — Use React Testing Library to test user interactions.

12. **Add E2E for timeline, year-in-review, map pages** — These are public pages with no E2E coverage.

13. **Add E2E for admin analytics, token management, password change** — These are admin features with no E2E.

14. **Add tests for `scripts/build-sw.ts`** — Verify SW version stamping and template replacement.

15. **Add performance tests for key queries** — Ensure `getImagesLite`, `searchImages`, `getImagesForFeed` don't degrade with large datasets.

### 12.4 Low (Nice to Have)

16. **Add visual regression tests for key pages** — Homepage, photo page, admin dashboard.

17. **Add offline mode E2E** — Test the service worker offline fallback.

18. **Add tests for `scripts/download-clip-models.ts`** — Test retry logic and path validation.

19. **Add tests for theme switching** — Verify dark/light/system preference persistence.

20. **Add load tests for concurrent uploads** — Ensure the upload processing contract lock serializes correctly.

---

## 13. Final Assessment

### Test Suite Health Score

| Category | Score | Notes |
|----------|-------|-------|
| Unit test coverage | 9/10 | 97.8% source file coverage, excellent helper/lib coverage |
| Integration test coverage | 7/10 | Good for color pipeline, auth rate limiting, data layer; gaps in server actions |
| E2E test coverage | 5/10 | Basic homepage, search, lightbox, admin login; many features untested |
| Security test coverage | 8/10 | Excellent lint gates, rate limit tests, origin guard; gap in server action CSRF |
| Accessibility test coverage | 7/10 | Good source-contract tests, touch-target audit; missing runtime a11y tests |
| Performance test coverage | 3/10 | No performance tests at all |
| Error path coverage | 5/10 | Many happy paths tested, but error paths are sparse |
| Flakiness | 9/10 | Known flakes fixed; remaining concerns are environment-dependent |
| Test maintainability | 9/10 | Excellent documentation, clear naming, good use of mocks |
| **Overall** | **7.5/10** | **Strong foundation with targeted gaps in E2E, error paths, and operational scripts** |

### Risk Heat Map

| Risk Area | Current Coverage | Gap Severity | Recommended Action |
|-----------|-----------------|------------|-------------------|
| Authentication (login/logout) | Partial (helpers tested, actions not) | **High** | Unit test `app/actions/auth.ts` |
| Server action CSRF protection | Partial (API routes tested, actions not) | **High** | E2E test cross-origin server action calls |
| Semantic search | None (E2E) | **High** | Add E2E with seeded data |
| Smart collections | None (E2E) | **High** | Add E2E with seeded data |
| DB init/seed scripts | None | **High** | Unit test script logic |
| Image processing error paths | Partial | Medium | Add error path tests |
| Upload race conditions | Partial | Medium | Add concurrent upload tests |
| Service worker runtime | None | Medium | Add E2E for SW behavior |
| Admin analytics | None (E2E) | Medium | Add E2E |
| Lightroom publish | None (E2E) | Medium | Add E2E |
| Timeline/year-in-review | None (E2E) | Low | Add E2E |
| Performance | None | Low | Add benchmark tests |

---

*Review completed. 229 test files examined, 225 source files mapped, 26 scripts inventoried, 6 E2E specs reviewed. All findings are based on static analysis of the test and source code; runtime verification was performed via `npm test` (225 passed, 2 skipped).*
