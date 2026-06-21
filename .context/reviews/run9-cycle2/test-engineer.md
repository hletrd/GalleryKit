# Test Engineer Review — Run 9 Cycle 2

**Date:** 2026-06-21
**Reviewer:** test-engineer (oh-my-claudecode)
**Scope:** Full test surface audit; primary focus on verifying TE-R9C1-01/02 (the two test files scheduled by last cycle) and identifying any new correctness/security-adjacent gaps not already in the deferral register.

---

## Verification of New Test Files

### TE-R9C1-01 — `upload-tracker-state.test.ts`

**Source module:** `apps/web/src/lib/upload-tracker-state.ts`

**Assessment: SOUND — no false confidence.**

The test file covers all three exported functions with meaningful assertions:

- `pruneUploadTracker`: boundary condition at `> 2x window` (expired vs. kept-at-boundary vs. fresh), plus the MAX_KEYS hard-cap eviction with insertion-order verification (first-inserted keys evicted, last survive).
- `resetUploadTrackerWindowIfExpired`: boundary condition at `> 1x window` (reset vs. kept-at-boundary). In-place mutation verified.
- `hasActiveUploadClaims`: empty tracker, count>0, bytes>0 (with count=0), and the critical stale-window-but-not-yet-pruned case — verifies the in-place window reset zeroes the entry AND that the function returns `false` after zeroing.

The stale-window test is particularly important: it covers the path where `hasActiveUploadClaims` calls `pruneUploadTracker` first (which does NOT remove the entry because it is within the 2x grace) then calls `resetUploadTrackerWindowIfExpired` in-place (which zeroes it because it is past 1x). Without this test the guard could silently treat a stale-window entry as an active claim. Test is deterministic via injectable `now`.

globalThis Symbol isolation (`getUploadTracker().clear()` in `beforeEach`) correctly prevents cross-test Map contamination.

**All 10 tests pass.**

### TE-R9C1-02 — `upload-processing-contract-lock.test.ts`

**Source module:** `apps/web/src/lib/upload-processing-contract-lock.ts`

**Assessment: SOUND — no false confidence.**

Covers:
- Numeric `1` acquisition arm (happy path, GET_LOCK → RELEASE_LOCK → connection.release sequence verified).
- `BigInt(1)` acquisition arm — the previously unexercised defensive branch at line 32.
- `0` (lock held by another) — null return, no RELEASE_LOCK issued, connection.release called once.
- `null` (timeout/unhealthy) — null return, connection.release called once.
- `getConnection` itself throwing — null return, no release attempted.
- POST-connect GET_LOCK query throwing — null return, connection.release called once.
- Double-release idempotency — RELEASE_LOCK issued exactly once on second `release()` call.

The `makeConn` helper correctly routes GET_LOCK vs. RELEASE_LOCK by SQL text, so the spy tracks all query calls independently.

**All 8 tests pass. Total: 18 tests, 0 failures.**

---

## Full Test Surface Inventory

### Test file count
212 test files in `apps/web/src/__tests__/`.

### Production modules with no corresponding dedicated test file

The following `lib/` modules have no `<name>.test.ts` counterpart but ARE covered indirectly:

| Module | Coverage path |
|---|---|
| `action-result.ts` | Consumer tests import and exercise the result shape |
| `admin-backfill-runner.ts` | 8 dedicated runner tests via matching prefix |
| `analytics-data.ts` | `client-server-only-boundary.test.ts` type import; DB query functions are integration-only |
| `api-auth.ts` | `check-api-auth.test.ts`, `api-auth-response-headers.test.ts` |
| `audit.ts` | `audit-retention.test.ts` covers `purgeOldAuditLog`; `logAuditEvent` metadata-truncation is the open TE-R7C2-04 deferral |
| `avif-support.ts` | `avif-probe-data-url.test.ts` |
| `bulk-edit-types.ts` | Type-only file, no behavioral logic |
| `caption-constants.ts` | Constants only |
| `clip-inference.ts` | `clip-embeddings.test.ts` + `clip-semantic-integration.test.ts` |
| `clip-model.ts` | `clip-model-contract.test.ts`, `clip-model-manifest.test.ts`, `clip-offline-load.test.ts` |
| `clip-model-id.ts` | Covered via clip-model tests |
| `color-pipeline-decisions.ts` | `color-pipeline-decision.test.ts`, `is-p3-pipeline.test.ts` |
| `color-primaries.ts` | `wide-gamut-primaries.test.ts`, `wide-gamut-predicate-wiring.test.ts` |
| `constants.ts` | Referenced in many tests |
| `csp-nonce.ts` | Infrastructure helper; returns `headers().get('x-nonce')` — no security-adjacent logic beyond the Next.js headers API |
| `data.ts` | `data-*.test.ts`, `privacy-fields.test.ts`, `data-tag-names-sql.test.ts` |
| `gps-exif-strip.ts` | `strip-gps-from-original.test.ts`, `process-image-exif-strip.test.ts` |
| `icc-extractor.ts` | `og-image-icc.test.ts`, `process-image-icc-options-lockin.test.ts` |
| `image-types.ts` | Type-only file |
| `ime.ts` | `ime-composition-guard.test.ts` |
| `og-photo-fetch.ts` | `og-photo-fallback.test.ts`, `home-metadata-title.test.ts` |
| `password-hashing.ts` | `password-hashing-policy.test.ts` |
| `process-image.ts` | 10+ `process-image-*.test.ts` files |
| `seo-og-url.ts` | `seo-actions.test.ts` imports `validateSeoOgImageUrl` |
| `theme.ts` | `theme-resolve.test.ts` |
| `utils.ts` | Used across many tests |

### Actions with no dedicated test file

| Module | Coverage status |
|---|---|
| `admin-backfill` | `admin-backfill-*.test.ts` (8 files) |
| `auth` | `auth-*.test.ts`, `session.test.ts`, `session-verify.test.ts` |
| `collections` | `smart-collections.test.ts`, `smart-collection-pagination.test.ts` |
| `embeddings` | Open deferred TE-R7C2-05 |
| `images` | `images-actions.test.ts`, `images-action-*.test.ts` |
| `lr-tokens` | `lr-tokens-action.test.ts` |
| `public` | `public-actions.test.ts` |
| `seo` | `seo-actions.test.ts` |
| `settings` | `settings-image-sizes-lock.test.ts`, `serve-upload-settings-debounce.test.ts`, `upload-tracker-state.test.ts` (guards `hasActiveUploadClaims`), `upload-processing-contract-lock.test.ts` |
| `sharing` | `sharing-source-contracts.test.ts`, `shared-page-title.test.ts` |
| `tags` | `tags-actions.test.ts` |
| `topics` | `topics-actions.test.ts` |

---

## New Gap Analysis

No new gaps found beyond the carried deferral register.

Every candidate examined either:
- Has direct behavioral coverage in a named test file, or
- Has indirect behavioral coverage via consumer/wiring tests, or
- Is type-only / constants-only with no deterministic behavioral logic to pin.

The free-download removal (commits `6c5e0b61`..`1d1cc118`) is cleanly covered: `free-download-contract.test.ts` and `photo-viewer-no-hdr-download.test.ts` together pin the unconditional download path, the filename derivation, and the absence of any entitlement gate. No orphaned test references.

---

## Carried Deferral Register (status unchanged)

| ID | Severity | Module | Description | Status |
|---|---|---|---|---|
| TE-R7C2-03 | LOW | `api/search/semantic/route.ts` | `.filter` block for malformed-embedding row-skip — deterministic but low blast radius (malformed row returns silent filter, not wrong result) | STILL OPEN |
| TE-R7C2-04 | LOW | `lib/audit.ts` | `logAuditEvent` metadata-truncation path (lines 24-39): surrogate-safe code-point slice + `truncated` wrapper. Fire-and-forget, admin-facing only | STILL OPEN |
| TE-R7C2-05 | INFO | `app/actions/embeddings.ts` | No dedicated behavioral test; covered only by the action-origin lint scan | STILL OPEN |

Exit criteria for TE-R7C2-04 would be a test that injects a `metadata` object whose `JSON.stringify` exceeds 4096 chars and asserts the inserted `serializedMetadata` contains `"truncated":true` and a `preview` field truncated at a code-point boundary with no split surrogates.

---

## Verdict

**0 new gaps — convergence confirmed.**

Carried deferrals TE-R7C2-03, TE-R7C2-04, and TE-R7C2-05 remain open and unchanged. No new correctness/security-adjacent guards were found to be untested. The two test files introduced in run-9 cycle-1 are well-constructed with meaningful assertions, covering all branches of their target modules including the previously unexercised BigInt(1) arm of `acquireUploadProcessingContractLock`.
