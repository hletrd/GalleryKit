# Test Engineer Review — Run-5 Cycle-3

**Date:** 2026-06-12
**Reviewer:** test-engineer lane
**Scope:** Test coverage gaps on critical paths; false-positive test assertions; flaky patterns; mock fidelity; missing negative cases; e2e gaps. Extra scrutiny on run-5 cycle-2 additions.
**Suppression honored:** plan-315 / plan-316 / plan-317 / plan-322; run5-cycle2 aggregate.

---

## Summary of cycle-2 test work — verified as shipped and passing

The following items from the cycle-2 plan were confirmed SHIPPED and PASSING:

- `admin-backfill-runner-batching.test.ts` fully rewritten (AGG-R5C2-03): SQL-content dispatch, no wall-clock sleeps, all 4 tests green (confirmed by targeted `vitest run`).
- `session-verify.test.ts`: `vi.resetModules()` in `beforeEach` + unique random bytes per token (AGG-R5C2-14) — confirmed in file.
- `sw-cache.test.ts`: fake timers / `vi.setSystemTime` for the timestamp advance test (AGG-R5C2-15) — confirmed in file.
- `process-topic-image.test.ts`: behavioral tests for processTopicImage / deleteTopicImage / cleanOrphanedTopicTempFiles (AGG-R5C2-16) — confirmed in file.
- `gallery-config.test.ts`: resolver merge/coercion logic, DB-override, invalid fallback, 'production' heal (AGG-R5C2-17) — confirmed in file.
- `public.spec.ts`: `/s/[key]` unknown-key 404 + valid-key routes + 404 page (AGG-R5C2-18) — confirmed in file.
- `download-route-get-behavior.test.ts` / `download-interstitial.test.ts`: GET interstitial behavioral + status taxonomy (AGG-R5C2-19) — confirmed in file.
- `caption-generator.test.ts`: generateCaption prefix/fallback/error-path (AGG-R5C2-05) — 8 tests green (confirmed by targeted `vitest run`).
- `bulk-update-images.test.ts`: applyAltSuggested prefix strip (CRT-R5C2-02) — confirmed in file.
- `count-code-points.test.ts`: surrogate pairs + CJK (AGG-R5C2-54) — confirmed in file.
- `checkout-route.test.ts`: unknown-IP idempotency omission (AGG-R5C2-06) — confirmed in file.
- `photo-title-stub-prefix-strip.test.ts`: stripStubPrefix + formatTitleAsTags (ARCH-R5C2-02 / COR-R5C2-03) — confirmed in file.
- `admin.spec.ts`: wrong-password alert disambiguation (AGG-R5C2-52 — cycle-2 commit cfe7f1c9) — confirmed in file.

---

## FINDINGS

### TEST-R5C3-01 [HIGH / High / confirmed]
**False positive: `caption-generator.test.ts:65-69` — self-equality assertion**

File: `apps/web/src/__tests__/caption-generator.test.ts:65-69`

```
it('prefix used in output === ALT_TEXT_STUB_PREFIX from caption-constants', () => {
    expect(ALT_TEXT_STUB_PREFIX).toBe(ALT_TEXT_STUB_PREFIX);
});
```

`expect(X).toBe(X)` is a tautology — it always passes regardless of what `ALT_TEXT_STUB_PREFIX` equals or whether the constant exists at all. The stated intent (ARCH-R5C2-02) is to verify that `caption-generator.ts` re-exports the same constant as `caption-constants.ts` so a future extraction refactor that diverges them fails CI. The current assertion can never catch that regression.

**Regression that slips through:** caption-generator is changed to hardcode a different prefix string (e.g. `'[DRAFT] '`) while caption-constants retains `'[AUTO] '`. The test passes because it still compares ALT_TEXT_STUB_PREFIX (from caption-constants) against itself.

**Suggested fix:**
```typescript
import { generateCaption } from '@/lib/caption-generator';
import { ALT_TEXT_STUB_PREFIX } from '@/lib/caption-constants';

it('prefix used in output === ALT_TEXT_STUB_PREFIX from caption-constants', async () => {
    const result = await generateCaption({ imageId: 1, camera_model: 'X', capture_date: null }, true);
    expect(result!.startsWith(ALT_TEXT_STUB_PREFIX)).toBe(true);
    // Ensure no additional prefix is prepended (the exact prefix value is pinned)
    expect(result!.indexOf(ALT_TEXT_STUB_PREFIX)).toBe(0);
});
```

---

### TEST-R5C3-02 [HIGH / High / confirmed]
**Missing fixture: migration journal monotonicity test (plan-315 item 14) — never created**

File: `apps/web/src/__tests__/` — no `migration-journal*.test.ts` exists. Confirmed by exhaustive grep for `journal`, `monoton`, `when.*strictly` in `__tests__/`, returning zero results.

Plan-315 item 14 (ARCH-R5C1-04) explicitly schedules a vitest guard that (1) asserts `when` values strictly increase from idx > 7 onward, and (2) verifies every journal tag has a matching `.sql` file. This is the guard that catches the burned-once production failure mode (silent migrator skip on non-monotonic `when`). After cycle-1 and cycle-2, this test has still not been created.

**Regression that slips through:** a developer adds migration 0022 with a `when` value of `1748000000000` (below the current max of ~1748800000000). The migrator silently skips it. `npm test` passes, deploy logs "Migration complete." No columns are added. The next INSERT fails in production.

**Suggested fix:** create `apps/web/src/__tests__/migration-journal.test.ts` as described in plan-315 item 14: read `drizzle/meta/_journal.json`, assert strict monotonicity from idx > 7 forward, assert every `tag` has a matching `drizzle/NNNN_*.sql` file and vice versa, and add a grandfathered-inversion comment for idx 6→7.

---

### TEST-R5C3-03 [HIGH / High / confirmed]
**Missing fixture: advisory lock constants pin (plan-315 item 19) — never created for 4 of 5 constants**

File: `apps/web/src/__tests__/admin-delete-lock-source.test.ts` — covers only `LOCK_ADMIN_DELETE`.

The advisory-locks module (`apps/web/src/lib/advisory-locks.ts`) exports:
- `LOCK_DB_RESTORE = 'gallerykit_db_restore'`
- `LOCK_UPLOAD_PROCESSING_CONTRACT = 'gallerykit_upload_processing_contract'`
- `LOCK_TOPIC_ROUTE_SEGMENTS = 'gallerykit_topic_route_segments'`
- `LOCK_ADMIN_DELETE = 'gallerykit_admin_delete'`  ← pinned
- `LOCK_COLOR_PIPELINE_BACKFILL = 'gallerykit_color_pipeline_backfill'`
- `getImageProcessingLockName(42) === 'gallerykit:image-processing:42'`  ← not pinned

Plan-315 item 19 (TEST-R5C1-09) explicitly requires ALL five constants + `getImageProcessingLockName` to be fixture-pinned. The cycle-2 plan-322 deferred.md notes this as a rider. A grep across `__tests__/` finds zero references to `LOCK_DB_RESTORE`, `LOCK_UPLOAD_PROCESSING_CONTRACT`, `LOCK_TOPIC_ROUTE_SEGMENTS`, `LOCK_COLOR_PIPELINE_BACKFILL`, or `getImageProcessingLockName` in any test file.

**Regression that slips through:** a typo renames `LOCK_COLOR_PIPELINE_BACKFILL` to `'gallerykit_color_pipeline_backfil'`. Two concurrent backfill runs no longer serialize — interleaved derivative writes are possible. CI stays green.

**Suggested fix:** extend `admin-delete-lock-source.test.ts` (or create a new `advisory-locks.test.ts`) to pin all 5 constants and `getImageProcessingLockName(42)` against their documented string values.

---

### TEST-R5C3-04 [HIGH / High / confirmed]
**Missing fixture: upload-paths behavioral tests (plan-315 item 17) — never created**

File: `apps/web/src/lib/upload-paths.ts` — no dedicated behavioral test exists. Confirmed by grep: all references to `resolveOriginalUploadPath` in `__tests__/` are vi.mock stubs in other tests, not behavioral tests of the function itself.

Plan-315 item 17 (TEST-R5C1-07) schedules tmp-dir tests for `resolveOriginalUploadPath` (primary-hit / legacy-hit / neither fallback chains) and `assertNoLegacyPublicOriginalUploads` (clean dir passes; legacy file present → warn vs throw modes).

**Regression that slips through:** `resolveOriginalUploadPath` path-priority logic is refactored to always return the legacy path, meaning photos with the new storage layout cannot be found for backfill/download. All existing tests pass because they mock the function.

**Suggested fix:** new `apps/web/src/__tests__/upload-paths.test.ts` with real tmpdir-based tests matching the `strip-gps-from-original.test.ts` pattern, covering the three resolution branches and both `assertNoLegacyPublicOriginalUploads` modes.

---

### TEST-R5C3-05 [MED / High / confirmed]
**`withAdminAuth` wrong-scope → 401 not tested at the wrapper level**

File: `apps/web/src/__tests__/api-auth-response-headers.test.ts` — covers no-token-at-all (401) and valid-scope (200) branches. `apps/web/src/__tests__/admin-tokens.test.ts:251-271` tests `tokenHasScope` the library helper, but calls it directly — never through `withAdminAuth`.

Plan-315 item 18 (TEST-R5C1-08) specifies: "verified token carrying `['lr:read']` against a route requiring `lr:upload` → 401." No test drives the `withAdminAuth` wrapper with a verified token whose scope does NOT satisfy `allowTokenScope` and asserts the 401 response.

**Regression that slips through:** `withAdminAuth` scope check is accidentally inverted (`!tokenHasScope` changed to `tokenHasScope`) — a `lr:read` token now grants `lr:upload` access. `api-auth-response-headers.test.ts` passes because it only tests with a valid `lr:upload` token. `admin-tokens.test.ts` passes because it tests the helper, not the wrapper behavior.

**Suggested fix:** add one test to `api-auth-response-headers.test.ts`:
```typescript
it('token branch: wrong scope → 401 (lr:read token cannot access lr:upload route)', async () => {
    verifyTokenMock.mockResolvedValue({ id: 1, userId: 7, scopes: ['lr:read'] });
    const withAdminAuth = await importWrapper();
    const wrapped = withAdminAuth(
        async (_req: NextRequest) => NextResponse.json({ ok: true }),
        { allowTokenScope: 'lr:upload' },
    );
    const response = await wrapped(fakeRequest({ 'x-gallerykit-token': 'gk_test' }));
    expect(response.status).toBe(401);
});
```

---

### TEST-R5C3-06 [MED / High / confirmed]
**`download-route-get-behavior.test.ts` source-scan contracts: behavioral gaps remain for the 410/affectedRows=0 path**

File: `apps/web/src/__tests__/download-route-get-behavior.test.ts:253-280` — uses string-literal source scanning (`expect(routeSource).toContain(...)`) to assert 410 status codes.

The `affectedRows` fallback-to-1 behavior at route.ts:397 (`const affected = header?.affectedRows ?? 1`) is specifically documented as "allow download on shape mismatch." Plan-315 item 7 (TRC-R5C1-17) schedules a unit test pinning the drizzle/mysql2 UPDATE result shape so driver upgrades that change the shape fail CI. That test does not exist.

More critically: `download-route-get-behavior.test.ts`'s source-scan for `Token already used` at ≥2 occurrences (line 268-270) is fragile — it counts string occurrences across the entire file, not specifically within `validateDownloadRequest`. A refactor that moves one 410 branch to a shared helper preserving the same string would still pass even if the count changed, because the regex counts ALL file occurrences.

**Regression that slips through:** the `affectedRows` shape changes in a drizzle minor update to return a nested object, making `header?.affectedRows` always `undefined`, so `affected = 1` (the fallback) always allows re-download. Source-scan tests stay green.

**Suggested fix:** add a unit test for the `claimedRows(result)` helper per plan-315 item 7, pinning the real `[ResultSetHeader, ...]` shape expected from drizzle/mysql2 (can be done with a mocked drizzle result). The source-scan test for "≥2 occurrences" should be tightened to also assert those occurrences fall within a bounded region of the file.

---

### TEST-R5C3-07 [MED / Med / likely]
**`semantic-search-route.test.ts` uses call-order-dependent mock for two-SELECT dispatch**

File: `apps/web/src/__tests__/semantic-search-route.test.ts:221-242`

The enriched-results test uses a `callCount` counter to dispatch the first `dbSelectMock` call to embeddings and the second to image enrichment. This is the same anti-pattern fixed in `checkout-route.test.ts` (AGG-R5C2-53): a reordering of SELECT calls (e.g. the image query is issued first, then embeddings) would feed wrong rows to wrong queries, producing a false positive or a surprising test failure.

```typescript
let callCount = 0;
dbSelectMock.mockImplementation(() => {
    callCount++;
    if (callCount === 1) { /* embedding query */ }
    // Image enrichment query
});
```

Unlike `checkout-route.test.ts` which was fixed to dispatch by table identity (`'processed' in table`), this mock cannot distinguish the two queries without inspecting the `from()` argument. The production code's query order could change without breaking the test behavior pin.

**Regression that slips through:** the route is refactored to fetch image enrichment first (for an early-exit on empty results), then embeddings. The mock feeds image rows where it expects embedding rows, the cosine computation fails silently, and the test still sees a 200 with `results: []` which matches the "empty results" path — but now the enriched-results test is also testing the wrong thing.

**Suggested fix:** dispatch by the schema object passed to `.from()` (inspect a sentinel property present only on `imageEmbeddings` vs `images`), matching the `checkout-route.test.ts` AGG-R5C2-53 fix pattern.

---

### TEST-R5C3-08 [MED / Med / likely]
**E2E `shared-link valid key` spec always skips — no seeded share key in e2e fixtures**

File: `apps/web/e2e/public.spec.ts:125-140`

The `shared-link valid key renders photo page` spec is gated on `process.env.E2E_SHARE_KEY` and unconditionally skips when the variable is absent. The e2e seed data (`e2e/fixtures/`) ships a shared-group key (`/g/Abc234Def5`) but no single-photo share key. In CI (where `E2E_SHARE_KEY` is not configured), this spec is always skipped.

Plan-315 item 21 (TEST-R5C1-11) originally requested a paid-download e2e spec but acknowledged that seeding entitlements is heavy. The `/s/[key]` route behavior is similarly unseeded. The existing `shared-link unknown key` spec (which always runs) covers the 404 path — the 200 (valid key) path has zero e2e coverage.

**Regression that slips through:** a server-side refactor of `app/[locale]/s/[key]/page.tsx` causes an unhandled exception on valid keys (while unknown keys still render the 404 page via `notFound()`). The 404 spec continues to pass; the 200 path is never exercised.

**Suggested fix:** either add a seeded share key to the e2e fixture seed script and document `E2E_SHARE_KEY` in the CI env matrix, or convert the spec to a lighter integration test that directly calls the server action used to create share links and then navigates. Short-term: add a TODO comment to the fixture that this spec will always skip until seeding is wired.

---

### TEST-R5C3-09 [MED / High / confirmed]
**`admin-backfill-runner-batching.test.ts`: COUNT query dispatch assumes drizzle primitives order is stable**

File: `apps/web/src/__tests__/admin-backfill-runner-batching.test.ts:198-219` (`inspectSql`)

The `classifySql` function dispatches on: `COUNT\(` → count, `/LIMIT/i && /id\s*>/i` → batch, otherwise → update. This relies on the exact SQL text that drizzle's `sql` tagged template emits. If drizzle changes how it serializes the COUNT query (e.g. emits `count(*)` lowercase or the cursor literal changes position in `values[]`), the dispatch will misclassify. More concretely: the `cursor = Number(values[1])` extraction assumes the second primitive in the inlined chunk array is always the cursor — this is drizzle internals, not a stable public API.

This is a medium risk because (a) the test was explicitly designed to replace a worse pattern and (b) the rewrite was verified correct by multiple cycle-2 agents. The risk is drizzle upgrading between test runs and changing the `sql` template's serialization.

**Regression that slips through:** drizzle 0.40 changes `sql` tagged template to emit placeholders as `Param` wrappers instead of raw primitives. `inspectSql` returns `values: []` for the batch SELECT, `cursor = Number(undefined) = NaN`, and the `allRows.filter(r => r.id > NaN)` returns `[]`. The test asserts `batches.length === 2` but only gets 1, so it fails — this is actually a good failure (test catches the change). However if the COUNT query is now classified as 'batch' and returns `[{cnt: N}]` as a row, the runner sees it as real image data and loops indefinitely. The test has a 5s timeout which would catch the infinite loop, but the failure mode is confusing.

**Suggested fix:** document the drizzle `sql` primitive-chunk contract in a comment citing the specific drizzle version verified (drizzle-orm package.json version), and add an assertion that at least one `StringChunk` is found (to catch `values: []` early). Low priority given the test is correct today.

---

### TEST-R5C3-10 [LOW / High / confirmed]
**`stripe-webhook-source.test.ts` is entirely source-scan (no behavioral tests) — plan-315 item 22 not yet created**

File: `apps/web/src/__tests__/stripe-webhook-source.test.ts` — all 8 tests use `WEBHOOK_SRC.indexOf(...)` and regex pattern matching on the source file. Plan-315 item 22 (TEST-R5C1-13) explicitly schedules mocked Stripe+DB behavioral tests for `checkout.session.completed`: happy path (entitlement + token insert ordering), duplicate delivery idempotency, deleted-image FK path, zero-amount path.

Source-scan tests are bypassed entirely if the implementation is rewritten to produce the same behavior through different code structure (variable renames, helper extraction, import reordering). None of the 8 existing tests would fail.

**Regression that slips through:** the `insertedFresh` check (`affectedRows === 1 && insertId > 0`) is accidentally inverted to `affectedRows !== 1 || insertId <= 0` — every fresh insert bails out without logging the download token. Source scan for the conjunction string still matches the inverted form? No — the exact regex `insertedFresh\s*=\s*insertHeader\.affectedRows\s*===\s*1\s*&&\s*insertHeader\.insertId\s*>\s*0` would fail. But a refactor to extract `isInsertFresh(header)` helper would pass all source scans while breaking the behavior.

**Suggested fix:** implement plan-315 item 22: mocked Stripe+DB behavioral tests for at minimum the happy path (token inserted, entitlement row present) and the duplicate-delivery idempotency path (second delivery with same `session.id` is a no-op).

---

### TEST-R5C3-11 [LOW / High / confirmed]
**`admin-backfill-runner-batching.test.ts`: `resetGlobalState()` relies on a private Symbol — brittle coupling to internals**

File: `apps/web/src/__tests__/admin-backfill-runner-batching.test.ts:164-177`

```typescript
const sym = Symbol.for('gallerykit.adminBackfillState');
const g = globalThis as Record<symbol, unknown>;
g[sym] = { running: false, ... };
```

The test reaches into `admin-backfill-runner.ts`'s internal global state via `Symbol.for`. If the module switches from `Symbol.for` to a module-level `let` variable (or changes the symbol key string), the test's reset no longer clears the actual state, causing test isolation failures. The test itself acknowledged this is necessary for the current implementation, but it's a coupling that will break silently when the module is refactored.

**Regression that slips through:** if module is refactored to use a plain module-level `let state = {...}`, `resetGlobalState()` writes to a dangling `globalThis[sym]` property that the module never reads. The first test run succeeds (state starts fresh from module import). The second test in the same file sees `state.running = true` left over from the first test, the `waitForRunnerDone` assertion times out after 5s, and the test fails with a timeout — not a meaningful assertion failure.

**Suggested fix:** export a `_resetStateForTesting()` function from `admin-backfill-runner.ts` (behind a `process.env.NODE_ENV !== 'production'` guard) rather than relying on the Symbol. This is the standard pattern for test isolation of module-level state.

---

### TEST-R5C3-12 [LOW / Med / needs-manual-validation]
**E2E `wrong-password` test consumes rate-limit budget against a real server**

File: `apps/web/e2e/admin.spec.ts:45-71`

The wrong-password e2e spec submits a bad login attempt, consuming one slot of the 5-attempt / 15-min per-IP rate limit. The spec comment notes this. If other tests in the suite fail and are retried (or if the spec runs alongside other admin tests that also fail login), the 5-attempt budget could be exhausted, causing subsequent correct-login attempts in the same test run to receive 429s, making the entire admin e2e suite fail non-deterministically.

The existing comment says "One wrong attempt is consumed here; subsequent tests perform a correct login so the budget is not exhausted." This is valid for a single sequential run, but Playwright's worker parallelism (`--workers`) could run this spec concurrently with another that also consumes budget from the same IP.

**Regression that slips through:** CI runs with `--workers=2`, two test files execute concurrently from the same CI worker IP, both consume rate-limit slots, and the correct-login tests in the second file see 429. The test output shows `Expected 200 got 429` with no indication this is a rate-limit cascade from the wrong-password test.

**Suggested fix:** confirm Playwright config uses `--workers=1` for admin specs (or confirm admin specs are serialized via `test.serial` or a project-level worker limit). If not, add an explicit note in the `playwright.config.ts` that admin specs must run sequentially.

---

## Surfaces verified CLEAN (no new findings)

- `admin-backfill-runner-batching.test.ts` rewrite: all 4 tests pass; SQL-content dispatch is sound; no wall-clock sleeps remain.
- `session-verify.test.ts`: `vi.resetModules()` in `beforeEach` correctly isolates the module-level `cachedSessionSecret` singleton; unique `randomBytes(16)` tokens defeat React `cache()` deduplication.
- `sw-cache.test.ts`: `vi.useFakeTimers()` / `vi.setSystemTime` properly advances timestamps; test is now deterministic.
- `caption-generator.test.ts`: 8 tests, all pass; covers null/empty/undefined model, truncation, `autoAltTextEnabled=false`.
- `gallery-config.test.ts`: resolver coverage complete for DB-override, invalid-value fallback, 'production'-heal, boolean/numeric coercion, unknown-key ignore, DB-throw fallback.
- `bulk-update-images.test.ts`: `applyAltSuggested` prefix strip + empty-strip skip correctly pinned.
- `count-code-points.test.ts`: surrogate pairs, CJK extension B, combining marks, mysql varchar(N) semantics — all present.
- `checkout-route.test.ts`: table-keyed dispatch (AGG-R5C2-53 fix) correct; unknown-IP idempotency omission pinned.
- `download-route-get-behavior.test.ts` / `download-interstitial.test.ts`: interstitial HTML shape + helper contracts behavioral (not source-only for the helper layer).
- `process-topic-image.test.ts`: tmpdir-based real-fs tests for `cleanOrphanedTopicTempFiles`; mocked process/delete paths cover rejection cases.
- `public.spec.ts`: 404 spec and `/s/[key]` unknown-key spec both run unconditionally and are correctly isolated from seed data.
- `stripe-webhook-source.test.ts`: existing source-scan assertions are correctly keyed on non-trivial patterns (insertedFresh conjunction, email shape regex, LOG_PLAINTEXT gate structure); they catch structural regressions even without behavioral tests.
- `admin.spec.ts` wrong-password: `filter({ hasText: 'Invalid credentials' })` disambiguation correctly avoids the route-announcer false match.
- `withAdminAuth` tests (`api-auth-response-headers.test.ts`): cookie and token branches with header defaults + invalid token → 401 all covered.
- Advisory lock constants source: `LOCK_ADMIN_DELETE` correctly pinned in `admin-delete-lock-source.test.ts`.

---

## Coverage gaps summary (plan-315 items still not created)

| Plan item | Status | Risk |
|---|---|---|
| plan-315 item 14: migration-journal monotonicity test | NOT CREATED | HIGH — direct repeat of production failure mode |
| plan-315 item 17: upload-paths behavioral tests | NOT CREATED | HIGH — all consumers mock the function |
| plan-315 item 19: all 5 advisory-lock constants pinned | PARTIAL (1/5) | HIGH — 4 lock names + getImageProcessingLockName unpinned |
| plan-315 item 18: withAdminAuth wrong-scope → 401 | NOT CREATED at wrapper level | MED |
| plan-315 item 22: Stripe webhook behavioral tests | NOT CREATED | LOW-MED |

---

## Finding severity counts

| Severity | Count |
|---|---|
| HIGH | 4 (TEST-R5C3-01, -02, -03, -04) |
| MED | 4 (TEST-R5C3-05, -06, -07, -08) |
| LOW | 4 (TEST-R5C3-09, -10, -11, -12) |
| **Total** | **12** |
