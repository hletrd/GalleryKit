# Test-Engineer Review — Run-7 Cycle-2

**Agent:** test-engineer
**HEAD:** `1cdbb883` (build(sw): refresh SW_VERSION stamp for run-7 cycle-2)
**Scope:** Entire repo test surface (`apps/web/src/__tests__/` 237 files / 2231 tests, `apps/web/e2e/` 5 specs)
**Suite health at review time:** GREEN — `npx vitest run` → 2231 passed | 4 skipped | 0 failed (31.88s)
**Date:** 2026-06-18

---

## Summary

**Coverage posture:** STRONG. The money-handling (Stripe checkout + download token), auth/session, GPS-stripping, and color-pipeline surfaces are the most heavily tested areas of the codebase, mostly with behavioral (mocked-DB + real route handler) tests rather than source-contract string matching. The NCLX YCgCo fix from cycle-1 (TE-R7C1-01 / AGG-R7C1-01) has an adequate behavioral regression test.

**Test health:** HEALTHY. No flaky tests observed (full suite ran clean twice). No tests asserting the WRONG behavior were found (the NCLX code-8 class of bug has been purged — verified across all color test files).

**Findings:** 1 MEDIUM (new), 2 LOW re-raised with new evidence, 3 LOW informational. The highest-value gap is an **asymmetric privacy-guard test coverage** between the Lightroom upload path and the browser upload path for the GPS-strip-on-original toggle.

| ID | Severity | Type | Status |
|----|----------|------|--------|
| TE-R7C2-01 | MEDIUM | Coverage gap (privacy) | NEW |
| TE-R7C2-02 | LOW | Coverage gap (money path) | RE-RAISED (was TE-R7C1-02) |
| TE-R7C2-03 | LOW | Coverage gap (semantic route) | RE-RAISED (was TE-R7C1-03) |
| TE-R7C2-04 | LOW | Untested unit (audit) | NEW |
| TE-R7C2-05 | LOW | TDD opportunity (audit) | NEW |
| TE-R7C2-06 | LOW | Action coverage gap | NEW (informational) |

---

## Verification of Cycle-1 Fixes

### TE-R7C1-01 / AGG-R7C1-01 — NCLX matrix code 8 (YCgCo) — FIXED, test ADEQUATE

The fix at `apps/web/src/lib/color-detection.ts:207` (`8: 'ycgco'`) is locked by a **behavioral** regression test:

- `apps/web/src/__tests__/color-detection.test.ts:294-299` — constructs a synthetic HEIF with `makeColrNclx(..., 8)` NCLX matrix and asserts `signals.matrixCoefficients === 'ycgco'`. The test comment explicitly documents the prior incorrect mapping ("8 = BT.2020-NCL (alias of 9)") and why it was corrected. This is exactly the right shape: it would have FAILED against the old code and PASSES against the fix.
- `apps/web/src/__tests__/color-details-section-delivered.test.ts:98-104` — source-contract pin that the UI renders `case 'ycgco': return 'YCgCo'`, so the corrected enum value reaches the admin-facing label.

The matrix-code-9 path (`bt2020-ncl`) is independently covered at `color-detection.test.ts:81`, so the 8-vs-9 disambiguation is symmetrically locked. **No further action needed on this finding.**

### AGG-R7C1-02 — Firefox `(color-gamut: p3)` MQ doc correction — FIXED

Documentation-only change (commit `10108963`). No test impact; the underlying `use-display-capability.ts` behavior is already covered by `use-display-capability.test.ts`. **Verified, no test gap.**

---

## NEW Findings

### TE-R7C2-01 — Browser upload path's GPS-toggle guard has NO test (asymmetric with LR path) [MEDIUM]

**Location:** `apps/web/src/app/actions/images.ts:311`

```ts
// Strip GPS coordinates using the upload-start config snapshot.
if (uploadConfig.stripGpsOnUpload) {
    exifDb.latitude = null;
    exifDb.longitude = null;
    // PP-BUG-3: also strip GPS EXIF from the on-disk original so
    // the paid-download endpoint doesn't leak protected locations.
    await stripGpsFromOriginal(path.join(UPLOAD_DIR_ORIGINAL, data.filenameOriginal));
}
```

**Why it matters — this is the privacy-critical regression surface.** This guard is the ONLY thing preventing a photographer's home GPS coordinates from being baked into the on-disk ORIGINAL file that the paid-download route (`/api/download/[imageId]`) streams byte-for-byte to customers. `strip_gps_on_upload` defaults to `false` (see `gallery-config.test.ts:78`), so the guard is the sole gate. The privacy contract documented in CLAUDE.md ("Privacy" → "`strip_gps_on_upload` additionally scrubs the on-disk ORIGINAL") depends entirely on this conditional executing when the toggle is on AND not executing (preserving the original) when off.

**The asymmetry:** The PARALLEL Lightroom-plugin upload path has a source-contract pin:

- `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:95-100` — `it('guards the GPS-original strip behind config.stripGpsOnUpload')` asserts the LR route source places `stripGpsFromOriginal(` after the `config.stripGpsOnUpload` guard.

But the browser upload path (the primary upload surface — `uploadImages()` in `images.ts`) has **zero** test references to `uploadConfig.stripGpsOnUpload`:

```
grep "uploadConfig.stripGpsOnUpload" apps/web/src/__tests__/ → (no results)
```

The existing GPS tests cover:
- `gallery-config.test.ts` — config RESOLUTION (DB row → boolean), not the upload-action wiring.
- `process-image-exif-strip.test.ts` — AVIF/WebP/JPEG DERIVATIVE EXIF stripping (the encoder path), not the original-file path or the toggle guard.
- `strip-gps-from-original.test.ts` — the byte-surgery LIBRARY in isolation (28 tests, excellent), but never invoked through the toggle guard.

**Regression scenario:** A refactor of `uploadImages()` (e.g. extracting the per-file processing into a helper, or changing the `uploadConfig` snapshot timing) could drop the `if (uploadConfig.stripGpsOnUpload)` guard or move the `stripGpsFromOriginal` call outside it. The entire test suite would stay green, but uploads under `strip_gps_on_upload=true` would silently leave GPS in originals served to paying customers. This is the same class of regression that PP-BUG-3 (the original bug this guard fixed) protected against — and it currently has no executable guard.

**Suggested test (source-contract, matching the LR path's pattern for symmetry):**

```ts
// apps/web/src/__tests__/images-action-gps-toggle-wiring.test.ts
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(
    path.resolve(__dirname, '..', 'app', 'actions', 'images.ts'),
    'utf8',
);

describe('uploadImages GPS-toggle wiring (TE-R7C2-01)', () => {
    it('imports stripGpsFromOriginal from @/lib/process-image', () => {
        expect(SRC).toMatch(/import\s*\{[^}]*\bstripGpsFromOriginal\b[^}]*\}\s*from\s*['"]@\/lib\/process-image['"]/);
    });

    it('guards stripGpsFromOriginal behind uploadConfig.stripGpsOnUpload', () => {
        const guardIndex = SRC.indexOf('uploadConfig.stripGpsOnUpload');
        const stripIndex = SRC.search(/stripGpsFromOriginal\(/);
        expect(guardIndex).toBeGreaterThan(-1);
        expect(stripIndex).toBeGreaterThan(-1);
        // The strip call must appear AFTER (inside) the toggle guard.
        expect(stripIndex).toBeGreaterThan(guardIndex);
    });

    it('nulls exifDb.latitude and longitude inside the same guard', () => {
        const guardIndex = SRC.indexOf('if (uploadConfig.stripGpsOnUpload)');
        const blockEnd = SRC.indexOf('}', guardIndex);
        const block = SRC.slice(guardIndex, blockEnd);
        expect(block).toMatch(/exifDb\.latitude\s*=\s*null/);
        expect(block).toMatch(/exifDb\.longitude\s*=\s*null/);
        expect(block).toMatch(/stripGpsFromOriginal/);
    });
});
```

**Confidence:** HIGH that the gap exists (verified by grep across all 237 test files). MEDIUM that source-contract is the right tier (behavioral would require mocking the full `uploadImages` server action with `getGalleryConfig`, `saveOriginalAndGetMetadata`, and the DB insert — heavy; the LR path chose source-contract for the same reason, and symmetry argues for the same tier here).

---

### TE-R7C2-04 — `logAuditEvent` metadata-truncation logic is untested [LOW]

**Location:** `apps/web/src/lib/audit.ts:8-51`

The fire-and-forget audit writer has three non-trivial code paths with ZERO direct unit tests:

1. **Surrogate-pair-safe truncation** (lines 24-40): when `serializedMetadata.length > 4096`, it spreads to code points (`[...serializedMetadata]`), slices 4000, and re-wraps in `{ truncated: true, preview: ... }`. The comment cites `C3L-CR-01` (surrogate-pair bisection fix) and `C14-AGG-01` (intentional invalid-JSON preview). This is exactly the kind of subtle Unicode handling that regresses silently.
2. **Serialization-failure fallback** (lines 20-22): `JSON.stringify` throwing → falls back to `{ note: 'metadata serialization failed' }`. Untested.
3. **The insert itself** (lines 43-50): no test asserts the row shape reaches `db.insert(auditLog)`.

**Why it matters:** `logAuditEvent` is called from 10 admin-action files (`tags.ts`, `sharing.ts`, `topics.ts`, `images.ts`, `settings.ts`, `admin-backfill.ts`, `admin-users.ts`, `seo.ts`, plus the LR upload route). It is the sole audit trail for admin mutations. A regression in the truncation path could either (a) throw and break the calling admin action (callers use `.catch(console.debug)` so it's swallowed, but the audit row is lost), or (b) produce a malformed `metadata` column. The sibling `purgeOldAuditLog` IS tested (`audit-retention.test.ts`, 5 tests, including the negative-retention guard) — the asymmetry is conspicuous.

**Regression scenario:** Someone "optimizes" the truncation from `[...str].slice(0, 4000).join('')` back to `str.slice(0, 4000)` (the "obvious" form). A metadata payload containing an emoji at position 3999 would then bisect a surrogate pair, producing a malformed UTF-16 string that MySQL stores but JSON parsers reject. No test fails.

**Suggested test** (behavioral, mocked DB):

```ts
// apps/web/src/__tests__/audit-log-event.test.ts
import { describe, it, expect, vi } from 'vitest';
const insertMock = vi.fn(async () => ({}));
vi.mock('@/db', () => ({ db: { insert: () => ({ values: insertMock }) }, auditLog: {} }));

import { logAuditEvent } from '@/lib/audit';

describe('logAuditEvent metadata handling (TE-R7C2-04)', () => {
    it('serializes normal metadata to JSON', async () => {
        await logAuditEvent(1, 'test', 'image', '1', undefined, { foo: 'bar' });
        expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ metadata: '{"foo":"bar"}' }));
    });

    it('truncates metadata > 4096 chars with a surrogate-pair-safe preview', async () => {
        // 5000-char string with an emoji (surrogate pair) near the slice boundary
        const big = 'x'.repeat(3998) + '😀' + 'y'.repeat(1000);
        await logAuditEvent(1, 'test', 'image', '1', undefined, { big });
        const row = insertMock.mock.calls.at(-1)[0];
        const parsed = JSON.parse(row.metadata);
        expect(parsed.truncated).toBe(true);
        expect(parsed.preview.endsWith('…')).toBe(true);
        // No lone surrogate — the string is valid UTF-16
        expect(() => JSON.parse(JSON.stringify(parsed.preview))).not.toThrow();
    });

    it('falls back to a note when metadata cannot be serialized', async () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        await logAuditEvent(1, 'test', 'image', '1', undefined, circular);
        const row = insertMock.mock.calls.at(-1)[0];
        expect(JSON.parse(row.metadata)).toEqual({ note: 'metadata serialization failed' });
    });
});
```

**Confidence:** HIGH. The gap is verified (`ls __tests__ | grep audit` returns only `audit-retention.test.ts`); the function is pure-ish and trivially testable with a mocked `db.insert`.

---

## RE-RAISED Findings (from Run-7 Cycle-1, with NEW evidence)

### TE-R7C2-02 — Stripe webhook route: 100% source-contract, 0% behavioral [LOW, re-raised]

**Was:** TE-R7C1-02 (deferred as LOW). **New evidence below.**

**Location:** `apps/web/src/app/api/stripe/webhook/route.ts` (454 lines) vs `apps/web/src/__tests__/stripe-webhook-source.test.ts` (181 lines, 9 tests).

**The new evidence — every single webhook test is source-text string matching, none exercise the POST handler:**

| Test (stripe-webhook-source.test.ts) | Mechanism |
|---------------------------------------|-----------|
| `imports isPaidLicenseTier` (L21) | `regex.match(WEBHOOK_SRC)` |
| `calls isPaidLicenseTier before INSERT` (L25) | `indexOf` on source string |
| `rejects invalid tier with 200` (L34) | regex on source block |
| `validates customer email shape` (L51) | `indexOf('EMAIL_SHAPE')` vs `indexOf('db.insert')` |
| `email regex rejects whitespace` (L59) | regex on the `/.../ ` literal in source |
| `plaintext token gated by env` (L72) | regex on source |
| `manual-distribution logs resolvedEmail` (L86) | regex on source |
| `affectedRows && insertId gate` (L101) | regex on source |
| `deleted-image 200 before INSERT` (L126) | `indexOf` + regex on source |
| `catch converts FK to 200` (L150) | regex on source |
| `default log has no plaintext token` (L169) | line-by-line source scan |

**ZERO** calls to `POST()`. The entire 454-line money-handling route — signature verification, payment_status gating, email validation/truncation/lowercasing, tier allowlist, zero-amount rejection, idempotency SELECT, the dup-key `affectedRows/insertId` disambiguation, the deleted-image FK race — is "tested" only by asserting that certain strings appear in the source file.

**Why this is the wrong tier for a money path (and weaker than every parallel surface):**
- The **checkout route** (`/api/checkout/[imageId]`) has `checkout-route.test.ts` (309 lines, 12 behavioral tests) + `checkout-db-error-rollback.test.ts` — both call `POST()` with mocked Stripe/DB.
- The **download route** has behavioral helper tests (`download-route-get-behavior.test.ts`, 35 tests on token shape + interstitial).
- The **semantic route** has `semantic-search-route.test.ts` (15 behavioral tests calling `POST()`).
- The **Stripe webhook** — the route that actually MINTS the entitlement and the download token — has only string matching.

**Concrete regressions that source-contract CANNOT catch but behavioral would:**
1. A logic bug where `payment_status === 'unpaid'` returns the wrong status code (the source-contract test only checks the branch "contains `received: true`", not that a constructed request returns 200).
2. The `customerEmail.slice(0, 255).toLowerCase()` producing the wrong value for a mixed-case input (no test constructs a request and inspects the inserted row).
3. The idempotency SELECT-then-INSERT race: the `insertedFresh` gate logic is source-matched, but no test mocks the DB to return the dup-key-loser shape and asserts the `[manual-distribution]` line is NOT emitted.
4. The `resolvedEmail` sentinel (`unknown+${sessionId}@stripe.local`) being constructed correctly when `customerEmail` is empty.

**Mitigation context (why this is LOW not MEDIUM):** The route's externally-observable behavior is hard to test without a real Stripe signing secret (signature verification rejects forged payloads before any DB work). The cycle-1 reviewer correctly noted this. The source-contract tests ARE valuable as drift detectors. But the gap is real: the route could be refactored to call a helper and every test would stay green even if the helper had a bug. The checkout/download routes show the pattern IS achievable with `vi.mock('@/lib/stripe', ...)` returning a `constructStripeEvent` that returns a controlled `Stripe.Event` — exactly what a behavioral webhook test would do.

**Suggested test (sketch):** Mock `@/lib/stripe` so `constructStripeEvent` returns a hand-built `{ type: 'checkout.session.completed', data: { object: { id: 'cs_test', payment_status: 'paid', metadata: { imageId: '1', tier: 'personal' }, amount_total: 500, customer_details: { email: 'CUST@Example.com' } } } }`; mock `@/db` to capture the `entitlements` insert values; assert the row has `customerEmail: 'cust@example.com'` (lowercased), `tier: 'personal'`, `amountTotalCents: 500`, and a non-null `downloadTokenHash`. Then a second test mocking the dup-key shape (`affectedRows: 1, insertId: 0`) asserting the manual-distribution log is suppressed. ~6-8 behavioral tests would close the highest-value half of this gap.

**Confidence:** HIGH that the gap is real and material. Recommendation stands at LOW only because (a) the route requires Stripe signature verification to reach the interesting branches (raising mock complexity) and (b) the source-contract tests do catch the documented historical regressions (COR-R4C18-02, COR-R4C3-02, etc.) that motivated them. A future cycle that adds even 3-4 behavioral tests for the payment_status/email/idempotency branches would convert this to a non-finding.

---

### TE-R7C2-03 — Semantic route: malformed-embedding row-skip is unit-tested but not route-tested [LOW, re-raised]

**Was:** TE-R7C1-03 (deferred as LOW). **New evidence below.**

**Location:** `apps/web/src/app/api/search/semantic/route.ts:272-279`

```ts
const scored = rows
    .map((row) => {
        const imgEmbedding = decodeEmbeddingColumn(row.embedding);
        if (imgEmbedding === null) return null;   // ← this skip
        const score = similarity(queryEmbedding, imgEmbedding);
        return { imageId: row.imageId, score };
    })
    .filter((m): m is { imageId: number; score: number } => m !== null);
```

**New evidence — the unit test covers the helper but NOT the route integration:**

- `apps/web/src/__tests__/clip-embedding-column-roundtrip.test.ts:89` — `expect(decodeEmbeddingColumn(null)).toBeNull()`. This tests the DECODER in isolation. It proves the decoder returns null for bad input.
- `apps/web/src/__tests__/semantic-search-route.test.ts` — the route-level test (15 behavioral tests) has NO case where `db.select(...).from(imageEmbeddings)` returns a row whose `embedding` is null/malformed. Every test either returns `[]` or a valid base64 embedding. The "returns 200 with enriched results" test (L223) returns exactly ONE valid row.

**The gap:** Nothing at the route level proves that a MIXED result set (one valid row + one malformed-null row) returns 200 with the valid result intact rather than 500-ing or dropping everything. The comment at route.ts:263-265 ("malformed rows decode to null and are skipped — previously every row was silently dropped") describes a historical bug fix that has no route-level regression test.

**Regression scenario:** Someone changes the `.map().filter()` to a `.flatMap()` or refactors the null check, accidentally making a single null embedding throw inside the map (e.g. `similarity(query, null)`). The unit test on `decodeEmbeddingColumn` still passes (the decoder is fine), but the route now 500s whenever ANY row in the scan set is malformed. With ~445 production embeddings, a single corrupted row would take semantic search down for everyone.

**Suggested test** (extends the existing route test file):

```ts
it('skips malformed-embedding rows and returns the valid ones (TE-R7C2-03)', async () => {
    const validBuf = Buffer.alloc(2048);
    for (let i = 0; i < 512; i++) validBuf.writeFloatLE(0.5, i * 4);

    dbSelectMock.mockImplementation(() => ({
        from: (table: Record<string, unknown>) => {
            if ('embedding' in table) {
                return {
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([
                                { imageId: 1, embedding: validBuf.toString('base64') },  // valid
                                { imageId: 2, embedding: null },                          // malformed
                                { imageId: 3, embedding: '!!!not-base64!!!' },             // malformed
                            ]),
                        }),
                    }),
                };
            }
            // image enrichment returns only id=1
            return { leftJoin: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([
                { id: 1, title: 'Valid', /* ... */ },
            ]) }) };
        },
    }));
    embedTextStubMock.mockReturnValue(new Float32Array(512).fill(0.5));

    const response = await POST(mockRequest({ query: 'mountain landscape' }));
    expect(response.status).toBe(200);  // NOT 500
    const json = await response.json();
    expect(json.results.length).toBe(1);
    expect(json.results[0].imageId).toBe(1);  // valid row survives, malformed rows skipped
});
```

**Confidence:** HIGH. This is a 1-test addition to an existing well-structured behavioral test file. The mock scaffolding is already in place (the table-keyed dispatch at L237).

---

## Informational / TDD-Opportunity Findings

### TE-R7C2-05 — `embeddings` server action has no dedicated test [LOW, informational]

**Location:** `apps/web/src/app/actions/embeddings.ts`

Every other file in `apps/web/src/app/actions/` has either a dedicated test or is covered by a `*-source-contracts.test.ts` cycle fixture — except `embeddings.ts`. The CLIP embedding backfill path is covered indirectly (`backfill-clip-embeddings-reembed.test.ts`, `image-queue-embed-wiring.test.ts`), but the action's own server-action entry (the one an admin triggers from the UI) has no direct test. This is LOW because (a) the heavy lifting lives in tested libs (`clip-embeddings.ts`, `clip-inference.ts`) and (b) the `action-origin` lint gate enforces the `requireSameOriginAdmin()` guard statically. But if the action grows branching logic (e.g. a "re-embed single image" path), it would land untested. Worth a source-contract pin or a behavioral test next time the action is touched.

### TE-R7C2-06 — Test-suite observations (no action required) [LOW, informational]

- **Suite is fast and deterministic.** 2231 tests in 31.88s, no flaky tests observed across two full runs. The `process-image-*` tests use real Sharp encoders on tmp-dir fixtures (the heaviest tier) but complete cleanly with proper `afterAll` cleanup.
- **The 4 skipped tests** (`237 passed | 2 skipped` files, `2231 passed | 4 skipped` tests) are intentional — worth a future cycle confirming each skip has a documented reason (none appeared broken).
- **No tests-asserting-wrong-behavior found.** I specifically swept the color/matrix/transfer-function assertion surface (the NCLX bug class) across all `__tests__/` files. Every `matrixCoefficients` assertion matches the corrected map. The `color-pipeline-decision-i18n` parity test and the `color-details-section-delivered` label test are consistent with the `ycgco` enum value.
- **e2e surface is thin but appropriate.** 5 specs (admin, public, origin-guard, nav-visual, test-fixes) — these guard the cross-cutting concerns (auth redirect, same-origin, visual nav) that unit tests can't. The money path (checkout → webhook → download) has no e2e, which is expected (it requires a real Stripe test-mode key and is better covered by the unit-tier behavioral tests called out in TE-R7C2-02).

---

## TDD Discipline Assessment

**No violations found.** The recently-added/modified files in the cycle-1/2 window (`color-detection.ts`, `gallery-config.ts`, `use-display-capability.ts`, `color-details-section.tsx`, `similar-photos.tsx`) all carry corresponding test coverage that was updated alongside. The NCLX fix (commit `60a5690c`) shipped the behavioral test (`color-detection.test.ts:296`) in the same commit as the one-line source fix — correct Red-Green discipline. No "code-first, test-mirror" patterns detected.

---

## Recommendations (priority order)

1. **TE-R7C2-01 (MEDIUM):** Add `images-action-gps-toggle-wiring.test.ts` — 3 source-contract tests mirroring `lr-upload-hdr-gate.test.ts:95-100`. This closes the privacy-guard asymmetry between the two upload paths. ~15 lines of test code, blocks the same class of regression that PP-BUG-3 fixed.
2. **TE-R7C2-03 (LOW):** Add 1 behavioral test to `semantic-search-route.test.ts` for the mixed valid/malformed embedding row case. ~30 lines using existing mock scaffolding.
3. **TE-R7C2-04 / TE-R7C2-05 (LOW):** Add `audit-log-event.test.ts` (3 tests for truncation/fallback/insert) — pure TDD opportunity on an untested security-adjacent lib.
4. **TE-R7C2-02 (LOW, deferred-OK):** Convert 3-4 of the highest-value webhook source-contract tests to behavioral (payment_status gating, idempotency dup-key, email lowercasing). Higher effort (Stripe signature mock) but highest residual value on the money path.

---

## Files Referenced

- `apps/web/src/app/actions/images.ts:311` — GPS toggle guard (TE-R7C2-01)
- `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:95-100` — LR path GPS source-contract (the asymmetric sibling)
- `apps/web/src/app/api/stripe/webhook/route.ts` — full 454-line webhook (TE-R7C2-02)
- `apps/web/src/__tests__/stripe-webhook-source.test.ts` — 9 source-contract tests, 0 behavioral (TE-R7C2-02)
- `apps/web/src/app/api/search/semantic/route.ts:272-279` — malformed-embedding skip (TE-R7C2-03)
- `apps/web/src/__tests__/semantic-search-route.test.ts` — 15 behavioral tests, missing mixed-row case (TE-R7C2-03)
- `apps/web/src/__tests__/clip-embedding-column-roundtrip.test.ts:89` — unit-level null test (TE-R7C2-03)
- `apps/web/src/lib/audit.ts:8-51` — `logAuditEvent` untested truncation/fallback (TE-R7C2-04)
- `apps/web/src/__tests__/audit-retention.test.ts` — sibling `purgeOldAuditLog` IS tested (asymmetry evidence)
- `apps/web/src/lib/color-detection.ts:207` — YCgCo fix (TE-R7C1-01 verified)
- `apps/web/src/__tests__/color-detection.test.ts:294-299` — YCgCo behavioral regression test (cycle-1 fix verified)
- `apps/web/src/app/actions/embeddings.ts` — no dedicated action test (TE-R7C2-05)

---

**Final sweep complete.** No CRITICAL or HIGH findings. The suite is in strong shape; the MEDIUM finding (TE-R7C2-01) is the only one I'd schedule for this cycle's fix pass, and it's a ~15-line source-contract test. The two re-raised LOWs remain correctly scoped — TE-R7C2-02 (webhook behavioral) is the highest residual value but also the highest effort, so it can continue to defer unless a webhook refactor is planned.
