# CRITIC — run-7 cycle-6 adversarial review

**Agent:** oh-my-claudecode:critic
**Date:** 2026-06-20
**HEAD:** 1463f219 (src/scripts/drizzle byte-identical to converged cycle-5 source @ e855e6ee)
**Mode:** THOROUGH (no escalation to ADVERSARIAL warranted — zero CRITICAL/MAJOR findings surfaced)

## VERDICT: ACCEPT — 0 actionable findings. Convergence hypothesis SURVIVED.

## Overall Assessment

The convergence claim holds under adversarial verification. `git diff e855e6ee..HEAD -- apps/web/src apps/web/scripts apps/web/drizzle` is empty; the only two commits since cycle-5 are a review doc and a `public/sw.js` SW-version stamp (outside the reviewed tree). I attacked the four highest-risk surfaces FROM CODE (not comments) and ran the real CI gates. All four surfaces are verified-correct. One non-deterministic test flake surfaced in a full-suite run but does NOT reproduce on re-run and passes deterministically in isolation — it is a test-harness shared-directory race, not a source-logic regression, and is at most a LOW deferral.

## Convergence Hypothesis (pre-commitment)

> H: cycle-5 converged; the only real findings across cycles 1-5 were 4 small color-spec test/value pins (all landed); the source is correct and the CI gates are green; expected outcome is ZERO new actionable findings.

Predicted most-likely falsification points before investigating:
1. An NCLX map value that diverges from ITU-T H.273 (the recurring finding class cycles 1-5). → CHECKED, all spec-correct.
2. A `COLOR_IMPACTING_KEYS` byte-impacting setting omission (ETag desync). → CHECKED, 9 keys, guard real, no omission found.
3. A PII guard that is a dead type alias (never asserted). → CHECKED, guard is a real `const` assignment that fails tsc.
4. A money-path gap (async-payment, idempotency race, $0 coupon). → CHECKED, all closed in code.
5. Migration post-condition that doesn't actually throw. → CHECKED, throws and aborts deploy.

Actual vs predicted: every predicted falsification point was investigated and refuted from code. No prediction landed a finding.

## Verification performed (FROM CODE)

### 1. Color / HDR pipeline correctness — VERIFIED CORRECT
- **NCLX maps (`lib/color-detection.ts:170-220`)** cross-checked against ITU-T H.273:
  - Primaries `{1:bt709, 9:bt2020, 11:dci-p3, 12:p3-d65}` — matches Table 2 (11=SMPTE RP 431-2 DCI-P3, 12=SMPTE EG 432-1 Display-P3 D65). ✓
  - Transfer `{1:srgb, 4:gamma22, 5:gamma28, 6:gamma22, 7:gamma22, 8:linear, 11:srgb, 13:srgb, 14/15:gamma24, 16:pq, 17:gamma26, 18:hlg}` — matches Table 3. Code 5 = BT.470BG (PAL/SECAM gamma 2.8) correct; code 4 = BT.470M (System M) correctly NOT labelled gamma28; 13 = sRGB (the prior pq mislabel is fixed); 17 = ST 428-1 DCI gamma 2.6. ✓
  - Matrix `{0:identity, 1:bt709, 8:ycgco, 9:bt2020-ncl, 10:bt2020-cl}` — matches Table 4. Code 8 = YCgCo (the AGG-R7C1-01 fix from BT.2020-NCL→YCgCo is correct; 9 is BT.2020-NCL). ✓
- **Encoder decision (`process-image.ts:661-723`)**: `resolveColorPipelineDecision` is ICC-name-first with NCLX-primaries fallback when ICC absent (`if (!iccProfileName) return resolveDecisionFromPrimaries(...)`). The documented INVERSE precedence vs `detectColorSignals` (audit, NCLX-first) is intentional and load-bearing (delivery = photographer's editing working-space; audit = source container tag). bt709 → 'srgb', unknown → 'srgb-from-unknown'; no path drops a real P3/wide source to sRGB silently. ✓
- **settings-hash (`lib/settings-hash.ts:42-65`)**: exactly 9 `COLOR_IMPACTING_KEYS` (5 color + 3 quality + image_sizes), matching the documented count. `_ColorKeysAreSettingKeys` is a real compile guard (`(typeof ...)[number] extends GallerySettingKey ? true : never` assigned to `true`). `HASH_LENGTH=8`, no `.slice` desync. ✓

### 2. Money path — VERIFIED CORRECT
- **Checkout (`api/checkout/[imageId]/route.ts`)**: per-IP rate limit pre-incremented BEFORE DB work (line 76); `priceCents <= 0` rejected (132); **`payment_method_types: ['card']`** pin present (207), closing the async-payment money-taken-no-goods path operationally. ✓
- **Webhook (`api/stripe/webhook/route.ts`)**: mandatory signature verification (74, returns 400 on failure); `payment_status !== 'paid'` gate with explicit unpaid/unexpected branches (105-118); $0/coupon session rejected (`!Number.isInteger(amountTotalCents) || <= 0`, 299); idempotency via SELECT-by-sessionId (320-331) PLUS `onDuplicateKeyUpdate` belt-and-suspenders (365); fresh-insert discrimination `affectedRows === 1 && insertId > 0` (382, correctly reasoned for mysql2's default FOUND_ROWS flag); deleted-image FK `ER_NO_REFERENCED_ROW_2` → 200+manual-refund log (no Stripe retry storm, 390-397). Dead-token hazard (C3-RPF-07) closed: plaintext token + manual-distribution log line only on the true fresh insert (419-422). ✓

### 3. PII — VERIFIED CORRECT
- **`publicSelectFields` (`lib/data.ts:326-357`)** is a SEPARATE object derived by destructuring-omission from `adminSelectFields`. All sensitive keys omitted: latitude, longitude, filename_original, user_filename, original_format, original_file_size, processed, color_pipeline_decision, is_hdr, has_gain_map, was_downscaled, transfer_function, matrix_coefficients, bit_depth, uploaded_by, processing_error, failed_at, color_space, **icc_profile_name (349)**, pipeline_version. ✓
- **Compile guard is REAL (416-420)**: `_SensitiveKeysInPublic = Extract<keyof publicSelectFields, PrivacySensitiveKeys>`; `const _privacyGuard: _SensitiveKeysInPublic extends never ? true : [error] = true`. If any sensitive key leaks in, the `= true` assignment is a hard tsc error. `publicMapSelectFields` carries a parallel guard and is the only lat/long surface (map_visible-gated). ✓
- typecheck passes (exit 0) — the guard is satisfied today.

### 4. Migration drift runbook — VERIFIED CORRECT
- **`migrate.js:707-722`** post-condition: after drizzle `migrate()`, computes `missing = expectedMigrations.filter(m => !recordedHashes.has(m.hash))` and `throw`s if `missing.length > 0`, aborting the deploy. Real and fails loud. ✓
- Journal `when` timestamps ARE non-monotonic (entry idx 7 = 1746144000000 << preceding 1778304060000) — exactly the documented hazard. This is KNOWN/MITIGATED, not a new finding: per-entry hash baselining (`baselineAllJournalMigrations`, filters on missing-hash Set) + the post-condition assertion above neutralize it. `reconcileLegacySchema` is the idempotent full-schema bootstrap. ✓
- (Note: NF-R7C5-01 baselineAllJournalMigrations duplicate-row was already REFUTED; re-confirmed the `.filter((m) => !haveHashes.has(m.hash))` at line 648/687 — no duplicate-insert path.)

## Empirical CI gate run (strongest falsification)

| Gate | Result |
|---|---|
| `typecheck` (app + scripts) | PASS (exit 0) |
| `lint:api-auth` | PASS |
| `lint:action-origin` | PASS ("All mutating server actions enforce same-origin provenance.") |
| `lint:public-route-rate-limit` | PASS |
| `npm test` (vitest, 2244 tests) | 1st run: 1 FAIL / 2239 pass; **2nd run: 0 FAIL / 2240 pass**; isolated run of the failing file: 11/11 PASS |

## What's Missing / gaps considered

- Webhook `async_payment_succeeded` handler still deferred (plan-316 CRT-R5C1-04) — but the card-only pin closes the exposure operationally, and this is a documented, tracked deferral, NOT a regression. Not actionable this cycle.
- No new byte-impacting admin setting was added (source is byte-identical), so the "forgotten new COLOR_IMPACTING_KEY" hazard has no trigger this cycle.

## Single observation (LOW — deferral, NOT a commit)

**OBS-R7C6-01 — Flaky test under full-suite parallelism: `process-image-color-roundtrip.test.ts > "P3 source with forceSrgbDerivatives=true"`.**
- Evidence: full-suite run #1 failed at `readOutputIccName` → `sharp(filePath).metadata()` with `Input file contains unsupported image format` reading a WebP derivative (test line 122 ← 237). Full-suite run #2: PASS. Isolated file run: 11/11 PASS.
- Root cause (from code): the test writes derivatives to the SHARED, real `UPLOAD_DIR_AVIF/WEBP/JPEG` (`upload-paths.ts`), not a per-test temp dir (only the source TIFF is in a per-test `mkdtemp` dir). Filenames are `trackId`-namespaced so there is no cross-test name collision, but under vitest's parallel worker pool multiple process-image test files encode concurrently into the same physical directories. The transient "unsupported format" on read-back is consistent with a read racing the encoder's atomic-rename window / transient libheif-encoder resource pressure under concurrent load.
- Why this is NOT a source finding: production never hits this — real uploads use unique UUID filenames AND serialize through `PQueue` (default concurrency 1). The race is a property of the test harness writing to shared global dirs under parallelism, not of `process-image.ts`. Source is byte-identical to converged cycle-5; the flake existed (latently) before this cycle and is order/timing-dependent.
- Severity: LOW. Per cycle-6 mandate (a LOW "nice to have" is a deferral at most), this does NOT meet the commit bar. Confidence: HIGH that it is a test-only flake; MEDIUM on the exact race window (atomic-rename vs encoder pressure — both are test-harness contention, neither implicates prod logic).
- Suggested deferral (if ever picked up): isolate each process-image test's outputs into a per-test `UPLOAD_*` override dir, or pin these tests to a single worker (vitest `fileParallelism: false` for the process-image group / `sequential` annotation). No source change.

## Realist Check

No CRITICAL/MAJOR findings to recalibrate. The one observation is already at LOW with a stated mitigation (production serialization + unique filenames). No downgrade needed.

## Items deliberately NOT re-filed (already adjudicated)

MED-R7C2-01 (histogram clip, REFUTED), REJ-R7C3-01 (indexSize, DISPROVED), NF-R7C5-01 (baselineAllJournalMigrations duplicate-row, REFUTED — re-confirmed filter-on-missing-hash), NF-R7C4-01 (code-4 comment, VERIFIED correct — re-confirmed in NCLX_TRANSFER_MAP), the NCLX matrix/transfer pin class (COMPLETE/EXHAUSTED — re-confirmed all values vs H.273).

## Verdict Justification

Operated in THOROUGH mode throughout; no CRITICAL, no MAJOR, no 3+-MAJOR pattern, so no ADVERSARIAL escalation. The convergence hypothesis was attacked at its four named high-risk surfaces from code, cross-checked against the ITU-T H.273 standard and the actual CI gates, and SURVIVED every probe. The sole anomaly (one full-suite test failure) was falsified as a non-deterministic test-harness flake via re-run (passed) and isolated run (passed), with a code-grounded root cause that does not touch production logic. Convergence is real.

**Open Questions (unscored):** none material. The flake's exact contention window (rename vs encoder pressure) is not pinned down, but that does not change the LOW/test-only classification.
