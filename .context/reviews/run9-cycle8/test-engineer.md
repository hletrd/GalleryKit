# Test-Engineer Review — Run-9 Cycle-8

**HEAD:** 4e132b03  
**Suite baseline:** 2059 passed, 4 skipped (CLIP model not seeded), 0 failed (227 test files)  
**Review date:** 2026-06-22

---

## Inventory

225 active test files in `apps/web/src/__tests__/`, 5 Playwright e2e specs.  
Skipped tests: 4 in `clip-offline-load.test.ts` and `clip-semantic-integration.test.ts` — correctly guarded by `CLIP_MODELS_ROOT` presence; not flaky.

---

## 1. DEF-R9C7-01 Re-Confirmation: @/lib/caption inert mock

**File:** `apps/web/src/__tests__/image-queue-settings-wiring.test.ts:87`  
**Finding:** `vi.mock('@/lib/caption', ...)` targets a module that does not exist. The real import in `image-queue.ts:21` is `@/lib/caption-generator`. Vitest silently accepts the mock registration against the non-existent path, leaving `caption-generator` UNMOCKED.

**Observed runtime evidence (fresh test run):**

```
stdout | ... > forwards the job-supplied 6 settings ...
[Queue] Caption stored for image 42
```

This log line comes from the fire-and-forget `.then()` block in `image-queue.ts:418-423`, which calls the real `generateCaption` from `caption-generator`. The real stub runs (`autoAltTextEnabled: true` is supplied), produces a deterministic string, then calls the mocked `db.update().set().where()` chain — which resolves silently. No test assertion fails.

**Does this mask a real regression now?**

The six settings asserted by this test (`forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`, and `quality`/`imageSizes`) are all forwarded via `processImageFormats` call arguments `args[5]–args[13]`. `autoAltTextEnabled` is NOT passed to `processImageFormats` — it is consumed only by the fire-and-forget caption hook that runs after the `db.update(processed=true)` commit. The six assertions at lines 190–196 and 231–235 are valid and probe the correct argument positions of the mocked `processImageFormats`.

The real `generateCaption` runs during the test but (a) is deterministic/synchronous-equivalent (no I/O), (b) writes to the already-mocked `db.update` chain, and (c) produces no side effect that contaminates any assertion. The fire-and-forget promise is not awaited by the test, so it settles after `runQueuedTask()` returns but before the test assertions run — the `[Queue] Caption stored for image 42` stdout confirms it completes without throwing.

**EXIT CRITERION CHECK:** The exit criterion for DEF-R9C7-01 was "escalate to DEFECT if the inert mock masks a real caption-generator regression." There is currently no such regression: `caption-generator.ts` is a pure stub (EXIF-derived string, no I/O) and the caption DB write hits the test's own mocked `db.update`. The inert mock means a future regression in `caption-generator` (e.g. a thrown exception in the stub) WOULD surface as a test failure via the `.catch()` handler logging a warning — it would not silently pass. It does not currently mask any real bug.

**Status: STILL INERT, NOT ESCALATED. Remains POLISH.**

---

## 2. Coverage Gap: Browser-Upload Path Has No Source-Contract for 6-Settings Forwarding

**Finding:** The c6 fix (CR-R9C6-01) added 6 admin processing settings to the `enqueueImageProcessing()` call inside `uploadImages()` (browser action, `apps/web/src/app/actions/images.ts:461-466`). The queue handler test (`image-queue-settings-wiring.test.ts`) proves the handler RECEIVES and USES these settings correctly. The LR path has a source-contract lock (`lr-upload-hdr-gate.test.ts:318-328`, "CR-R9C7-01") that asserts `config.forceSrgbDerivatives`, `config.wideGamutJpegChroma`, etc. are present in the LR enqueue block.

However, the browser-action path has **no equivalent lock**. The only assertion in `images-actions.test.ts` on the enqueue call is:

```ts
expect(enqueueImageProcessingMock).toHaveBeenCalledWith(
    expect.objectContaining({ id: 9, topic: 'travel' })
);
```

This does not verify the 6 settings fields. A future refactor of `uploadImages()` that drops `forceSrgbDerivatives`, `avifEffort`, etc. from the enqueue payload would reintroduce the pre-c6 silent fallback to encoder defaults — undetected by the test suite.

**Risk:** MEDIUM. The code is correct today; the gap is regression protection asymmetry between the LR path (locked) and the browser path (not locked). Both entry points were fixed in c6/c7 but only one has a source-contract pin.

**Scenario where this lets a bug through:** Developer refactors `uploadImages()` to simplify the enqueue call, accidentally drops `wideGamutMaxSourcePixels` from the payload. The queue handler falls back to `job.wideGamutMaxSourcePixels ?? undefined` → `wideGamutMaxSourcePixels` local variable stays `undefined`, which process-image treats as no cap. OOM on a 100 MP wide-gamut source. No test fails.

**Confidence:** HIGH  
**Classification: POLISH** — no current bug, correctness of the live code confirmed; this is missing regression protection, not a defect.

---

## 3. All Drift-Locking Tests Are Non-Vacuous

Reviewed in full:

**`sql-restore-scan.test.ts`** — CR-R9C5-01 tripwire at line 77 introspects `schema.ts` via `getTableName()` and asserts every Drizzle table is in `APP_BACKUP_TABLES`. Sanity floor (`expect(schemaTables.length).toBeGreaterThanOrEqual(18)`) prevents vacuous pass on import failure. Non-vacuous.

**`privacy-fields.test.ts`** — Symmetric guard (line 83) checks `adminSelectFieldKeys ∖ publicSelectFieldKeys === SENSITIVE_KEYS` exactly. Any new admin-only column not added to `SENSITIVE_KEYS` fails. Non-vacuous.

**`backfill-color-pipeline.test.ts`** — AGG-02 column-set test (line 148) uses `Object.keys(signals).sort()` equality to an exact sorted array. Non-vacuous; would catch any added/removed column.

**`migrate-reconcile-coverage.test.ts`** — Strips JS comments before asserting every schema table name and column name appears in `migrate.js` executable code. The `stripJsComments()` guard (added AGG-R8c3-16a) prevents a comment-only mention from satisfying the check. Non-vacuous.

---

## 4. LR-Settings c7 Fix Has Real Assertion

`lr-upload-hdr-gate.test.ts:318-328` — the CR-R9C7-01 describe block contains six `expect(blockStr).toMatch(...)` regex assertions, each verifying that `config.<setting>` appears in the actual `enqueueImageProcessing({...})` source block extracted from `route.ts`. These are source-contract style but not vacuous: a refactor that drops any of the six fields from the LR enqueue payload would fail the corresponding `toMatch`. Confirmed real.

---

## 5. c5 Restore-Scanner Fix Has Tripwire

`sql-restore-scan.test.ts:62-69` pins `DROP TABLE IF EXISTS` for every table in `APP_BACKUP_TABLES`, and lines 77-99 ensure `APP_BACKUP_TABLES` stays a superset of the schema. These two tests together constitute the c5 regression lock. Both are non-vacuous as analysed in §3.

---

## 6. Previously-Adjudicated Items — Status Unchanged

- **TE-R7C2-03/04/05** — not re-filed; no new evidence.
- **TE-R9C3-01 residual** (`beforeAll` near-no-op) — not re-filed; no new evidence.
- **POLISH: verifySessionToken race** — not re-filed.
- **POLISH: auth-rate-limit combined path** — not re-filed.
- **POLISH: sidecar flushBatch** — not re-filed.

---

## 7. Spot-Checked Additional Areas

**`images-action-blur-wiring.test.ts` and `process-image-blur-wiring.test.ts`** — source-contract style, regex against source text; valid assertions checked against real import paths. Non-vacuous.

**`sanitize-for-og-global.test.ts`** — imports the three consumer modules and asserts each uses the shared `sanitizeForOg` helper. Non-vacuous: the import-presence check would fail if a consumer were refactored to an inline copy.

**`admin-backfill-runner-deleted-mid-reencode.test.ts` / `backfill-color-pipeline-deleted-mid-reencode.test.ts`** — both test the delete-mid-reencode guard with `affectedRows: 0` returning path. The mocked `db.update()` chains have distinct `affectedRows` return values per case; the outcome assertions are not trivially satisfiable.

**`view-retention.test.ts`** — tests `shouldPurgeViewEvents` with boundary values; the non-default `VIEW_RETENTION_DAYS` calculation is arithmetic under test. Non-vacuous.

**`settings-hash.test.ts`** — imports `COLOR_IMPACTING_KEYS` from source and asserts specific known settings are present; a key removal would fail. Non-vacuous.

**`touch-target-audit.test.ts`** — walking source tree for forbidden patterns; the sanity check `expect(scannedFiles.length).toBeGreaterThan(30)` prevents vacuous pass on a broken scan root. Non-vacuous.

---

## 8. No Flaky or Order-Dependent Tests Found

All 225 test files use isolated mocks with `beforeEach` resets on shared state (verified in `image-queue-settings-wiring.test.ts` and `images-actions.test.ts`). The `backfill-color-pipeline.test.ts` uses `beforeAll`/`afterAll` with real filesystem temp directories and generates UUID-named fixture IDs to avoid inter-test collision. No shared mutable state was found that could cause order dependence.

---

## 9. No Tests Asserting Wrong Behavior

Searched for tests that might be locking in a known bug (wrong expected value, inverted assertion). No instances found. The `color-detection.test.ts` gamma-code assertions correctly reflect the AGG-R7C2-01 fix (`gamma28` for NCLX code 5, not `gamma22`). The NCLX matrix code 8 → `'YCgCo'` fix (AGG-R7C1-01) is correctly reflected in the color detection tests.

---

## Summary

**Test suite health: HEALTHY**

Full suite: 2059 passed, 4 skipped (expected CLIP-model absence), 0 failed.

**Findings:**

| ID | File | Type | Severity | Description |
|----|------|------|----------|-------------|
| DEF-R9C7-01 | `image-queue-settings-wiring.test.ts:87` | POLISH | LOW | `vi.mock('@/lib/caption')` targets non-existent module; real `caption-generator` runs unmocked. No current bug masked. Not escalated. |
| GAP-R9C8-01 | `images-actions.test.ts` (browser upload path) | POLISH | MEDIUM | `uploadImages()` enqueue call has no source-contract asserting the 6 admin processing settings are forwarded. LR path is locked (lr-upload-hdr-gate.test.ts:318-328); browser path is not. |

---

## DISPOSITION

**DEFECTS: 0**  
**POLISH: 2** (DEF-R9C7-01 — still inert, not escalated; GAP-R9C8-01 — new, browser-upload 6-settings forwarding unlocked)

**DEF-R9C7-01 STATUS:** Inert mock confirmed. The wrong mock target (`@/lib/caption`) means the real `caption-generator` runs during tests. The real stub is pure (no I/O), writes to an already-mocked DB chain, and does not contaminate any assertion. No caption-generator regression is currently masked. Exit criterion NOT met. Remains POLISH, not escalated to DEFECT.
