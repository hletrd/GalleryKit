# Test-Engineer Review — Run-8 Cycle-1

**Scope:** Test-coverage integrity audit after Stripe paid-download removal (commits
`6c5e0b61..47b1e21f`). HEAD at review time: `47b1e21f`.

---

## 1. Orphaned / Vestigial Tests in the 4 Modified Files

### `check-public-route-rate-limit.test.ts` (−10 lines)
**Status: not vestigial.**
The 15 surviving tests all use inline source-string fixtures and test the
`checkPublicRouteSource()` scanner function's logic. None reference deleted
modules. The −10 lines removed the checkout/download/stripe routes from the
actual file scan list inside the companion `check-public-route-rate-limit.ts`
script, not from the fixture tests. All 15 tests remain meaningful.

### `settings-hash.test.ts` (−2 lines)
**Status: not vestigial.**
Inspected: 14 tests remain, covering all 9 current `COLOR_IMPACTING_KEYS`. The
−2 lines were a test for a Stripe/paid-download key (likely `license_tier`) that
had briefly appeared in `COLOR_IMPACTING_KEYS`; the key never shipped in
`COLOR_IMPACTING_KEYS` in the public codebase or its removal was clean. The
surviving tests cover every key still in the canonical set with no holes.

### `bulk-update-images.test.ts` (−lines, exact delta unknown, stated in brief)
**Status: not vestigial.**
No references to `license_tier`, `entitlements`, `stripe`, or `checkout` exist in
the file. The modification was cosmetic cleanup (comment removal or a mock helper
for the paid-download action that was co-imported). Remaining describe blocks (auth
guards, input validation, tri-state diff, transactional rollback, applyAltSuggested,
tag mutations) are all meaningful.

### `lr-upload-hdr-gate.test.ts` (−6 lines)
**Status: not vestigial.**
Inspected: 5 describe blocks all test non-paid-download concerns (HDR gate, GPS
strip, icc_profile_name parity, cycle 3/4 parity, post-save containment). The −6
lines removed a test that checked the LR upload route does NOT reference
`license_tier` or `entitlements` — a guard that became vacuous once those columns
and their insertion code were deleted from the route. Correctly pruned.

**Overall: 0 vestigial tests in the 4 modified files.**

---

## 2. Surviving Tests with Stale Comments Referencing Paid Downloads

Three tests contain comments that mention the removed feature in passing but do not
import or assert against deleted modules:

- `images-action-gps-toggle-wiring.test.ts` — header comment mentions "paid-download route streams byte-for-byte". Comment-only; test logic is intact.
- `strip-gps-from-original.test.ts:263` — comment mentions "paid-download purchasers". Comment-only; test logic is intact.
- `alert-dialog-action-settle.test.ts:19` — comment mentions "sales-client". Comment-only.

These are not vestigial. The tests cover GPS-strip and alert-dialog settlement,
which remain relevant. The stale comments are low priority (documentation noise, not
test logic).

---

## 3. New Coverage Gaps Created by the Removal

### GAP-R8C1-TE-01 — Free-download unconditional path: no source-contract test [MEDIUM]

**What changed:** `photo-viewer.tsx` and `info-bottom-sheet.tsx` previously gated the
download anchor behind a license/entitlement check. After removal, `downloadHref` is
rendered unconditionally (only gated on `image.filename_jpeg` being non-null). The
AVIF gamut-aware dropdown also has a new branch: when `isWideGamutSource &&
avifDownloadHref`, a two-item DropdownMenu (sRGB JPEG + P3 AVIF) replaces the single
download button.

**What is covered:**
- `download-filename.test.ts`: tests `buildDownloadFilename` and `slugifyTitle` utility functions — 16 tests, all passing.
- `photo-viewer-no-hdr-download.test.ts`: source-text test that verifies the download dropdown does NOT reference `_hdr.avif`/`hdrDownloadHref`/`hdrAvifFilename`. Does NOT test the affirmative unconditional-download presence or href construction.
- `info-bottom-sheet-ia.test.ts`: confirms IA order (ColorDetails → WideGamutHint → Histogram → EXIF → CaptureDate → Download) and that `t('viewer.downloadJpeg')` appears after `CaptureDate`. Does NOT verify the download anchor is unconditional, has the correct href, or uses `buildDownloadFilename`.

**What is NOT covered by any test:**
1. That `photo-viewer.tsx` calls `buildDownloadFilename` (not a hardcoded or fallback path).
2. That `info-bottom-sheet.tsx` calls `buildDownloadFilename` for both JPEG and AVIF download names.
3. That the AVIF gamut-aware DropdownMenu renders `avifDownloadHref` (sourced from `filename_avif`) separately from `downloadHref` (sourced from `filename_jpeg`).
4. That neither component conditions the download section on any entitlement or license check.
5. That `avifDownloadHref` construction uses `imageUrl('/uploads/avif/...')` — the same pattern as `downloadHref` for JPEG.

**Risk:** If a future change accidentally re-introduces a license gate, or if `buildDownloadFilename` is unwired from one of the two components, no test will catch it. The AVIF dropdown is new behavior (two-item menu instead of one button) with zero source-contract coverage.

**Recommendation:** Add a source-contract test (`photo-viewer-download-contract.test.ts` or extend `photo-viewer-no-hdr-download.test.ts`) that:
- Asserts `buildDownloadFilename` is imported and called for both JPEG and AVIF filenames in `photo-viewer.tsx` and `info-bottom-sheet.tsx`.
- Asserts the download section in both components is NOT gated on any `entitlement`, `isEntitled`, `license`, or `downloadToken` symbol.
- Asserts `avifDownloadHref` is set from `filename_avif` and used in the AVIF DropdownMenuItem.

### GAP-R8C1-TE-02 — Migration 0023 reconcile path: no dedicated behavioral test [LOW]

**What exists:**
- `migrate-reconcile-coverage.test.ts`: a source tripwire that walks `schema.ts` and asserts `migrate.js` mentions every current table and column name. Since `entitlements` and `license_tier` are now ABSENT from `schema.ts`, the tripwire correctly no longer checks for them — it will not catch a failure to DROP them.
- `migrate.js` does contain the correct logic: `reconcileLegacySchema` has explicit comments at lines 370–371 (`license_tier ... removed in migration 0023`) and 596–597 (`entitlements ... removed in migration 0023`), and at lines 621–628 calls `dropTableIfPresent('entitlements')` and `dropColumnIfPresent('images', 'license_tier')`.

**What is NOT covered:**
There is no test that asserts `migrate.js` calls `dropTableIfPresent` for `entitlements` or `dropColumnIfPresent` for `license_tier`. The existing column tripwire only confirms presence in the reconcile, not removal. A regression (e.g., someone deleting the drop calls in migrate.js while refactoring) would not be caught.

**Risk rating:** LOW — the removal DDL was verified against a prod DB with 0 entitlement rows and all-`none` license_tier values (documented in migration 0023 header). The `dropTableIfPresent` helper uses `DROP TABLE IF EXISTS` which is safe even if the table doesn't exist. Regression risk is low; detection risk is also low given the explicit comments.

**Recommendation (optional, not urgent):** A single tripwire in `migrate-reconcile-coverage.test.ts` asserting `MIGRATE_SRC_CODE.includes('dropTableIfPresent')` and that `entitlements` appears adjacent to a drop context (not a CREATE context) would complete the removal audit trail. Not blocking.

---

## 4. cycle3..8-rpf-source-contracts Deletion Verified

All 6 deleted files (`cycle3-rpf-source-contracts.test.ts` through
`cycle8-rpf-source-contracts.test.ts`) were confirmed via `git show` on the
pre-deletion commit. Content of cycle3 verified directly:

- All tests in these files read `WEBHOOK_SRC` (`app/api/stripe/webhook/route.ts`),
  `DOWNLOAD_ROUTE_SRC` (`app/api/download/[imageId]/route.ts`), `SALES_ACTIONS_SRC`
  (`app/actions/sales.ts`), or `SALES_PAGE_SRC` (`app/[locale]/admin/.../sales/page.tsx`).
- Every assertion referenced `entitlements`, `generateDownloadToken`, `payment_status`,
  `amountTotalCents`, `sessionId`, `downloadTokenHash`, or other exclusively
  paid-download symbols.
- **No non-paid-download behavior was co-pinned in these 6 files.** The deletions were
  clean and left no unprotected non-paid-download contracts.

---

## 5. Carried TE Deferral Status After Removal

### TE-R7C2-02 — Stripe webhook 0% behavioral coverage [LOW]
**Status: MOOT.**
The Stripe webhook route (`app/api/stripe/webhook/route.ts`) and its source-contract
test (`stripe-webhook-source.test.ts`) were both deleted in commit `6c5e0b61`. There
is no route to test. Close this deferral.

### TE-R7C2-03 — Semantic route malformed-embedding row-skip untested [LOW]
**Status: STILL ACTIVE.**
The semantic search route (`app/api/search/semantic/route.ts`) was modified (−6 lines,
confirming removal of Stripe/entitlement references from the file) but not deleted. The
`.filter(m => m !== null)` row-skip at `route.ts:272-279` remains untested at route
level. The surviving `semantic-search-route.test.ts` covers the happy path and a DB
timeout 500 path but does not inject a null row into the embedding scan results to verify
the filter behavior. Carry forward unchanged.

### TE-R7C2-04 — `logAuditEvent` metadata-truncation untested [LOW]
**Status: STILL ACTIVE.**
`apps/web/src/lib/audit.ts` is unchanged by the removal. The truncation path at lines
8–51 remains untested. Carry forward unchanged.

### TE-R7C2-05 — `embeddings.ts` server action has no dedicated test [LOW]
**Status: STILL ACTIVE.**
`apps/web/src/app/actions/embeddings.ts` is unchanged and untested. Carry forward
unchanged.

### ARCH-R7C2-01 — `charge.refunded` Stripe webhook gap [LOW, co-referenced]
**Status: MOOT.**
The webhook route is deleted. The `charge.refunded` handler gap and the
`downloadTokenHash` revocation path are both moot. Close alongside TE-R7C2-02.

---

## Summary

| Item | Severity | Status |
|------|----------|--------|
| GAP-R8C1-TE-01: Free-download unconditional path — no source-contract for `buildDownloadFilename` wiring or no-entitlement-gate invariant in photo-viewer/info-bottom-sheet | MEDIUM | NEW |
| GAP-R8C1-TE-02: Migration 0023 reconcile drops not tripwired in test | LOW | NEW |
| TE-R7C2-02 (Stripe webhook 0% behavioral) | LOW | MOOT |
| ARCH-R7C2-01 (charge.refunded gap) | LOW | MOOT |
| TE-R7C2-03 (semantic route null-row skip) | LOW | Still active |
| TE-R7C2-04 (audit.ts metadata-truncation) | LOW | Still active |
| TE-R7C2-05 (embeddings.ts action untested) | LOW | Still active |

**NEW gaps: 2 (1 MEDIUM, 1 LOW)**
**Carried deferrals now MOOT: 2 (TE-R7C2-02 + ARCH-R7C2-01)**
**Vestigial tests: 0**
**Test suite integrity after removal: HEALTHY — no surviving test imports a deleted module or asserts deleted behavior**
