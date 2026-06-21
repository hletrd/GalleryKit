# Test Engineer Report — run-9 cycle-6

**HEAD:** `ba3277da`  
**Date:** 2026-06-18  
**Test run outcome:** 2056 passed | 4 skipped (CLIP offline — no model weights in CI) | 0 failed  
**Test files:** 224 passed | 2 skipped (226 total)  

---

## Summary

**Test Health: HEALTHY — ZERO masking-DEFECTS found.**

Coverage: no new gaps opened this cycle. The ~30 highest-value fixture/contract tests were inventoried and individually cross-checked against their implementations. All assertions are non-vacuous. No bug-masking found.

---

## Fixture/Contract Tests Audited

### 1. `__tests__/sql-restore-scan.test.ts` — c5 fix tripwire

**KEY QUESTION: does the superset tripwire actually fail if a schema table is removed from `APP_BACKUP_TABLES`?**

Answer: **YES — NON-VACUOUS.**

The test at line 77–98 (`APP_BACKUP_TABLES is a superset of every table in the Drizzle schema`) uses `getTableName()` from `drizzle-orm` to introspect the live schema module at runtime. It then asserts:

1. `schemaTables.includes('images')` — non-vacuity: import must be non-empty
2. `schemaTables.length >= 18` — non-vacuity: at least the known 18 tables
3. `missing = schemaTables.filter(t => !allowlist.has(t))` → `expect(missing).toEqual([])` — would fail immediately if any schema table is absent from `APP_BACKUP_TABLES`

Cross-check against actual source:
- Schema (`db/schema.ts`): 18 tables via `mysqlTable(...)` — `admin_settings`, `admin_tokens`, `admin_users`, `audit_log`, `image_embeddings`, `image_tags`, `image_views`, `images`, `rate_limit_buckets`, `sessions`, `shared_group_images`, `shared_group_views`, `shared_groups`, `smart_collections`, `tags`, `topic_aliases`, `topic_views`, `topics`
- `APP_BACKUP_TABLES` (`lib/sql-restore-scan.ts`): same 18 entries, identical sorted set
- **VERDICT: tripwire is live and correct. Adding a new schema table without updating `APP_BACKUP_TABLES` will fail this test.**

### 2. `__tests__/view-retention.test.ts` — chunk math + mock chain

Mock chain mirrors implementation exactly:
- Mock: `deleteMock → { where: whereMock } → { limit: limitMock } → Promise<{ affectedRows }>`
- Impl: `db.delete(table).where(lt(col, cutoff)).limit(VIEW_PURGE_BATCH)` — identical chain

Chunk math: The test at line 103–115 ("keeps deleting in chunks") uses a counter `n` (increments per `limitMock` call). 3 tables × 2 calls each = 6 calls: odd `n` → 5000, even `n` → 10.
- Call 1 (n=1, odd): 5000 → continues
- Call 2 (n=2, even): 10 → `10 < 5000` → breaks
- Repeat for tables 2 and 3
- Total: `(5000 + 10) × 3 = 15030`
- Test asserts `total === (5000 + 10) * 3` ✓

`VIEW_PURGE_BATCH = 5000` and `MAX_BATCHES_PER_TABLE = 200` in impl — batch cap is correctly modelled. Default 395-day cutoff with the past-only safety guard (non-positive / non-finite falls back to default) is tested with `vi.setSystemTime('2026-06-16T00:00:00Z')`.

**VERDICT: no vacuity, no mock/impl mismatch, chunk math correct.**

### 3. `__tests__/backfill-color-pipeline.test.ts` — 9-column set

Test at line 179–195 ("AGG-02") asserts `Object.keys(signals).sort()` equals exactly:
```
['avif_10bit', 'color_pipeline_decision', 'color_primaries', 'has_gain_map',
 'icc_profile_name', 'is_hdr', 'matrix_coefficients', 'transfer_function', 'was_downscaled']
```
(9 columns)

Cross-check against `scripts/backfill-color-pipeline.ts` line 80–89: the `ColorSignals` type (returned as `signals`) declares exactly these 9 fields. The DB update at line 242–250 writes all 9. `pipeline_version` is written separately (not part of `signals`). The partial `derivativeOnly` path (line 262) carries only `was_downscaled` + `avif_10bit` — a strict subset of `signals` — and does NOT advance `pipeline_version`.

**VERDICT: 9-column assertion correctly matches the actual backfill column set.**

### 4. `__tests__/sanitize-for-og-global.test.ts` — shared import fixture

Reads actual source files via `readFileSync` to assert:
- `api/og/photo/[id]/route.tsx` imports from `@/lib/og-sanitize`
- `[locale]/(public)/p/[id]/page.tsx` imports from `@/lib/og-sanitize`
- `api/og/route.tsx` imports from `@/lib/og-sanitize`
- None has a local copy of the `UNICODE_FORMAT_CHARS` replace pattern

**VERDICT: non-vacuous source-fixture test; checks 3 real consumers.**

### 5. `__tests__/privacy-fields.test.ts` — 20-key symmetry

`SENSITIVE_KEYS` in the test (20 keys):
```
bit_depth, color_pipeline_decision, color_space, failed_at, filename_original,
has_gain_map, icc_profile_name, is_hdr, latitude, longitude, matrix_coefficients,
original_file_size, original_format, pipeline_version, processed, processing_error,
transfer_function, uploaded_by, user_filename, was_downscaled
```

`PrivacySensitiveKeys` union in `lib/data.ts` (line 414): identical 20-key set.

The symmetric guard (line 83–90) computes `adminSelectFieldKeys - publicSelectFieldKeys` and asserts the difference exactly equals `SENSITIVE_KEYS` sorted. The compile-time `_SensitiveKeysInPublic extends never` guard blocks any of these from appearing in `publicSelectFields` at type-check time.

**VERDICT: 20-key count correct, symmetric guard live and non-vacuous.**

### 6. `__tests__/i18n-key-parity.test.ts` — key-set equality

`flattenKeys` recursively flattens nested JSON to dotted paths. Asserts `enKeys.sort()` deep-equals `koKeys.sort()`. Values may differ (ICU plural in en vs single form in ko per DOC-R5C3-07) — intentional. Test surfaces exact drift.

**VERDICT: correct key-set gate, non-vacuous.**

### 7. `__tests__/data-tag-names-sql.test.ts` — tagNamesAgg

Source-fixture test reads `lib/data.ts` with a brace-depth walker to extract function bodies. Checks:
- `tagNamesAgg` const shape: `GROUP_CONCAT(DISTINCT ${tags.name} ORDER BY ${tags.name})`
- `getImagesLite`, `getImagesLitePage`, `getAdminImagesLite`: all use `tagNamesAgg`, `.leftJoin(imageTags`, `.leftJoin(tags`, `.groupBy(images.id)`
- `getLatestImageForOg`: minimal — no tagNamesAgg, no GROUP_CONCAT, no leftJoin
- `searchImages`: `searchGroupByColumns = Object.values(searchFields)`, two `.groupBy(...searchGroupByColumns)` calls

**VERDICT: non-vacuous; would fail if any of these patterns regressed.**

### 8. `__tests__/sw-template-contract.test.ts` — service worker template

Source-pattern tests on `public/sw.template.js` and `src/proxy.ts`:
- No `Cookie` header read in SW
- `x-gk-admin-render` marker gate present
- `.ok && headers.get('x-gk-admin-render') !== '1'` in the same condition
- `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` on HEAD probe (bounded revalidation — AGG-R8-05)
- `HEAD_REVALIDATE_TIMEOUT_MS = \d{2,4}` constant defined
- No `Array.sort()` in `recordAndEvict` (head-walk pattern)
- `entries.delete(url); entries.set(url,` delete-then-set recency upsert
- Generated `sw.js` carries same bounded HEAD probe (covers template→generated drift)

**VERDICT: all pattern contracts confirmed non-vacuous.**

### 9. `__tests__/settings-hash.test.ts` — 9-key COLOR_IMPACTING_KEYS

Tests `_buildHashForTesting` for all 9 COLOR_IMPACTING_KEYS (`wide_gamut_jpeg_chroma`, `sdr_jpeg_chroma`, `avif_effort`, `force_srgb_derivatives`, `wide_gamut_max_source_pixels`, `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`). Each gets an individual "differs when X changes" test. Key-ordering independence confirmed. R8-H1 test confirms GalleryConfig hash matches raw-DB hash for same values.

**VERDICT: all 9 keys covered; no coverage gap.**

### 10. `__tests__/check-action-origin.test.ts` — action-origin scanner

Covers:
- Function declarations and arrow-function exports
- Missing guard → fails
- Guard present but mutation before it → fails (DB-before-guard pattern)
- Guard present but result not returned early → fails (ignored result)
- Exempt comment on mutating body → fails with `EXEMPT COMMENT ON MUTATING ACTION`
- Exempt comment on read-only body → allowed
- Aliased exports → fails closed (`UNSUPPORTED aliased export`)
- `walkForActionFiles` extension/exclusion coverage

**VERDICT: 22 test cases, all meaningful; scanner is correctly hardened.**

### 11. `__tests__/touch-target-audit.test.ts` — KNOWN_VIOLATIONS counts

KNOWN_VIOLATIONS map (summarized, spot-check only):
- `components/image-manager.tsx`: 1 (batchAddButton `size="sm"` ~:328 without h override)
- `components/admin-user-manager.tsx`: 2 ("Add admin" header + per-row delete icon)
- `components/admin-header.tsx`: 1 (Logout link as `size="sm"`)
- `app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`: 5 (four quick-action + one retry)
- `app/[locale]/admin/(protected)/categories/topic-manager.tsx`: 3
- `app/[locale]/admin/(protected)/tags/tag-manager.tsx`: 3
- `app/[locale]/admin/(protected)/settings/settings-client.tsx`: 1
- `app/[locale]/admin/(protected)/seo/seo-client.tsx`: 1
- All shadcn ui/* primitives: 0 (exempt as primitive wrappers)
- Public route group (`publicDir`): covered as third `SCAN_ROOT`

Key scanner hardening present:
- `(?<!max-)` lookbehind to avoid false-positives on `max-h-N`/`max-w-N` ceiling utilities on `<Button>`, `<button>`, native `<select>`, and `<Link>`/`<a>`
- Multi-line tag normalization (`normalizeMultilineButtonTags`)
- `<Badge asChild>` sub-44 arbitrary `min-h-[NNpx]` patterns
- Raw `<input type="checkbox|radio">` scanning via `scanRawCheckboxes`
- Scale-token catch-all for `h-1..10`/`size-1..10` etc. on all interactive tags

**VERDICT: KNOWN_VIOLATIONS counts match documented rationale; scanner patterns are correctly maintained.**

---

## Flaky-Test Risk Assessment

No new flaky sources identified.

- `vi.useFakeTimers()` / `vi.setSystemTime()` in `view-retention.test.ts`: correctly reset in `beforeEach`/`afterEach`.
- `view-retention.test.ts` uses module-level `n` counter in the chunk-count test — reset by the mock's `mockImplementation` on each test run since `limitMock.mockClear()` in `beforeEach` clears call history (though the closure variable `n` is re-declared inside the `it()` block, not shared). No order-dependence risk.
- `backfill-color-pipeline.test.ts` creates temp files in `beforeAll`/`afterAll` — no shared mutable state between test files.
- 4 skipped CLIP tests: correctly gated on `CLIP_MODELS_ROOT` availability; not flaky, just environment-conditional.
- All SQL restore scan tests: pure function, no I/O, no timing.

---

## Deferred Items (not re-raised)

Per task brief — all of these remain in the standing register, not re-raised:
- TE-R7C2-03 (semantic route null-skip untested)
- TE-R7C2-04 (logAuditEvent truncation untested)
- TE-R7C2-05 (embeddings action no dedicated test)
- TE-R9C3-01 residual (upload-tracker beforeAll near-no-op under forks)
- verifySessionToken concurrent-init
- auth-rate-limit combined-exhaustion
- sidecar flushBatch coverage gaps

None of the underlying logic for these was touched in c5 or c6.

---

## Verification

```
npm test --workspace=apps/web
Test Files  224 passed | 2 skipped (226)
      Tests  2056 passed | 4 skipped (2060)
   Duration  27.21s
```

---

**TESTS HEALTHY, ZERO masking-DEFECTS found.**
