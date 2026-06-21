# Test Engineer Review — Run-8 Cycle-2 (HEAD `f63af3b9`)

**Date:** 2026-06-21
**Agent:** test-engineer
**Scope:** Coverage-gap review focused on what the paid-download REMOVAL changed and any
genuinely NEW gap not already carried as TE-R7C2-03/04/05.

---

## Gate state (verified fresh)

```
npm test --workspace=apps/web -- --run
Test Files  222 passed | 2 skipped (224)
Tests       2036 passed | 4 skipped (2040)
Duration    32.94s
```

The 2 skipped files / 4 skipped tests are exclusively the CLIP-weight-gated suites
(`clip-offline-load.test.ts` ×2, `clip-semantic-integration.test.ts` ×2), gated by
design on `SEEDED`/`RUN` env vars. Zero failures. Zero regressions from removal.

---

## Context: HEAD unchanged from cycle-1 close

`git diff --name-only f63af3b9..HEAD` = empty. HEAD `f63af3b9` IS the cycle-1 close
commit. No new source code has landed since cycle-1. This cycle-2 review runs against
the same artifact that cycle-1 left, with all 5 scheduled findings already implemented:

- FIND-R8C1-01 DONE: `downloadPage` i18n namespace deleted from both locales (commit `7fade6df`)
- FIND-R8C1-02 DONE: stale "paid-download / paid deliverable" comments replaced in
  `process-image.ts:1547` and 3 test docstrings (commit `1d1cc118`)
- FIND-R8C1-03 DONE: dead `licensePrices` fixture line removed from
  `serve-upload-settings-debounce.test.ts:34` (commit `8bfa0873`)
- FIND-R8C1-04 DONE: `free-download-contract.test.ts` added — 10 tests, all green
  (commit `56a4cc32`)
- FIND-R8C1-05 DONE: migration-0023 DROP tripwire added to `migrate-reconcile-coverage.test.ts`
  — 2 tests, all green (commit `4e72d0f4`)

---

## Validation of the cycle-1 test additions

### `free-download-contract.test.ts` — correct and sufficient for its stated scope

Verified by reading the source and running the test:

- Import assertion: regex matches the actual `import { buildDownloadFilename }` in both
  components — confirmed present at `photo-viewer.tsx:37` and `info-bottom-sheet.tsx`
  (implicitly — `buildDownloadFilename(` is called in both).
- `filename_jpeg` / `/uploads/jpeg/`: present in both components — confirmed.
- `avifDownloadHref` / `filename_avif` / `/uploads/avif/`: present in both — confirmed.
- Forbidden-symbol scan (entitlement / licenseTier / license_tier / downloadToken /
  isPaid / isUnlocked / checkout): no false positives — `license_tier` was deleted from
  both components in the removal; grep confirms zero matches.
- The test correctly uses `describe.each(Object.entries(COMPONENTS))` so both components
  are fully covered by the same 5 assertions.

One deliberate non-coverage: `isP3Pipeline(image.color_pipeline_decision)` drives the
DOWNLOAD BUTTON LABEL (showing "Download P3 JPEG" vs "Download JPEG") but is NOT
asserted by `free-download-contract.test.ts`. This is intentional and correct — that
label logic is already covered by `color-details-section-delivered.test.ts` (which pins
`isP3Pipeline` usage patterns in the codebase broadly). The IA-order test
(`info-bottom-sheet-ia.test.ts`) confirms the download section exists and is ordered
after capture-date. No gap here.

### `migrate-reconcile-coverage.test.ts` DROP tripwire — correct and sufficient

- `dropTableIfPresent(connection, 'entitlements')` at `migrate.js:627` — confirmed present
  in executable code; comment-stripped regex passes.
- `dropColumnIfPresent(connection, dbName, 'images', 'license_tier')` at `migrate.js:628`
  — confirmed present; regex passes.
- The `MIGRATE_SRC_CODE` (comment-stripped) approach correctly prevents a comment-only
  citation satisfying the tripwire.

---

## Surviving stale comments NOT missed by FIND-R8C1-02

Two phrases matching "download-original path" survive in `process-image.ts` after the
FIND-R8C1-02 fix:

- Line 1570: "public gallery does not leak GPS; only the download-original path remains
  at risk in that case."
- Line 1646: "Only the download-original path leaks, and failing the upload entirely
  would be worse."

Both are ACCURATE post-removal. "download-original path" refers to the admin-accessible
path that streams the on-disk original (the admin can still download originals via the
authenticated backup path and the CLIP/backfill pipeline reads from it). The paid-download
route was the PUBLICLY ACCESSIBLE consumer — that is gone. The admin-internal reader
still exists and "download-original path leaks" (GPS retained on best-effort-fail) is
correct risk framing for the admin surface. NOT a stale-comment finding.

---

## `privacy-fields.test.ts` SENSITIVE_KEYS — correct after removal

`license_tier` is NOT listed in `SENSITIVE_KEYS` and is NOT in the schema — the column
was dropped. The symmetric privacy guard (`_SensitiveKeysInPublic` compile-time type
assertion) remains intact. `privacy-fields.test.ts` passes. No gap here.

---

## Carried deferral status re-check (TE-R7C2-03 / 04 / 05)

**TE-R7C2-03 [LOW, conf HIGH]** — semantic route malformed-embedding row-skip untested
at route level. Route confirmed unchanged: `semantic/route.ts:274-279` still has the
`.filter(m => m !== null)` after `decodeEmbeddingColumn(row.embedding)`. The removal
touched this file `−6 lines = comment-only` (verified: grep for `license_tier` / `entitle`
in `semantic/route.ts` → zero hits). STILL OPEN. Exit criterion unchanged.

**TE-R7C2-04 [LOW, conf HIGH]** — `logAuditEvent` truncation/serialization-failure
untested. `audit.ts:24-37` unchanged (surrogate-pair-safe truncation at 4096 chars,
serialization-failure fallback). No new test added. STILL OPEN. Exit criterion unchanged.

**TE-R7C2-05 [INFO]** — `embeddings.ts` action no dedicated test. Action unchanged.
STILL OPEN. Exit criterion unchanged.

---

## NEW FINDINGS: 0

Systematic review of every surface the paid-download removal touched:

**`photo-viewer.tsx` + `info-bottom-sheet.tsx` download path** — covered by
`free-download-contract.test.ts` (10 tests, all green). The gamut-aware AVIF dropdown
branch (`isWideGamutSource && avifDownloadHref`) is structurally verified. No gap.

**`gps-exif-strip.ts`** — removal touched only `−2 comment` lines (functional logic
byte-identical, confirmed by prior cycle's debugger/security-reviewer). The surviving
anomalous-HEIC branch (`process-image.ts:1628-1634`) is covered by
`strip-gps-from-original.test.ts` and the GPS-toggle wiring test
(`images-action-gps-toggle-wiring.test.ts`). No new untested branch. No gap.

**`process-image.ts` strip path** — `stripGpsFromOriginal` behavior is covered by
`strip-gps-from-original.test.ts`; wiring to the upload action is covered by
`images-action-gps-toggle-wiring.test.ts`. No new branch became reachable. No gap.

**`serve-upload.ts`** — removal made no change to serve-upload.ts (confirmed: no diff
in `6c300402`). ETag logic (`IMAGE_PIPELINE_VERSION` + `settingsHash`) covered by
`serve-upload.test.ts` + `serve-upload-settings-debounce.test.ts`. No gap.

**`data.ts` publicSelectFields** — the only change was deletion of `license_tier` from
`adminSelectFields` (no field moved to `publicSelectFields`). The `_PrivacySensitiveKeys`
compile-time guard + `privacy-fields.test.ts` are intact and passing. No gap.

**`migrate.js` reconcile drops** — pinned by the new DROP tripwire in
`migrate-reconcile-coverage.test.ts`. No gap.

**Semantic route** — TE-R7C2-03 remains the only gap here; it pre-dates the removal and
is carried (not new).

**Deleted tests vs surviving behavior** — reviewed all ~17 deleted paid-download test
files (via commit `6c5e0b61`). None covered behavior that survives in the codebase. The
`checkout-route.test.ts` (card-only pin) is gone with the route. The
`stripe-webhook-source.test.ts` is gone with the route. The free-download surface that
survived is now covered by `free-download-contract.test.ts`. No regression hole.

---

## Summary

**Suite health: HEALTHY.** All 5 cycle-1 findings were implemented correctly. Both new
tests (`free-download-contract.test.ts`, migration DROP tripwire) are correctly asserting
what they claim, pass green, and close the gaps they were written for. No surviving test
imports a deleted module. No paid-gating symbol reappears in the free-download path. No
new coverage gap was created by the removal that cycle-1 did not already schedule and
close.

The three carried deferrals (TE-R7C2-03/04/05) remain open and unchanged — no new
evidence, no exit criterion met, no escalation warranted.

**NEW FINDINGS: 0**

Carry forward register unchanged from `deferred.md`:
- TE-R7C2-03 [LOW, conf HIGH] — STILL OPEN
- TE-R7C2-04 [LOW, conf HIGH] — STILL OPEN
- TE-R7C2-05 [INFO] — STILL OPEN
