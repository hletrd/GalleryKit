# Cycle 55 Correctness and Data-Flow Review

Current HEAD reviewed: `4dbbbf9b93fc345dc2979b011d0b6cfb1066b3df` on `master`.

## Inventory Examined

- `apps/web/src/lib/settings-submit-payload.ts`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/__tests__/settings-submit-payload.test.ts`
- `apps/web/src/__tests__/settings-image-sizes-lock.test.ts`

## Findings

### C55-03 - Settings diff can send a false `image_sizes` mutation when the stored baseline is non-canonical

- Severity: Medium
- Confidence: High
- Files: `apps/web/src/lib/settings-submit-payload.ts:10`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:265`, `apps/web/src/app/actions/settings.ts:71`
- Failure scenario: `buildChangedGallerySettingsPayload` canonicalizes the current `image_sizes` form before comparing it to the raw baseline. If the DB contains a valid but non-canonical value such as `1536, 640`, and the UI current value is canonical `640,1536`, the helper emits `{ image_sizes: '640,1536' }` even though the upload-processing contract is unchanged. `updateGallerySettings` treats the mere presence of `image_sizes` as a contract mutation before it compares DB-normalized values, so an unrelated Settings save can be rejected with `uploadSettingsLocked` while uploads are active or forced through the upload-processing advisory lock unnecessarily.
- Suggested fix: Canonicalize both the current value and baseline for `image_sizes` before diffing, and add a regression test for non-canonical stored baselines.

## Final Sweep

The existing test covered current-value canonicalization but not baseline canonicalization. The fix is narrow and preserves true `image_sizes` changes because unequal canonical forms still emit the canonical requested value.
