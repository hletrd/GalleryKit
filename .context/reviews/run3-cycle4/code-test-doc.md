# Code-correctness + test-gap + doc-drift review — Run-3 Cycle 4

Reviewer angle: code-reviewer + debugger + test-engineer + document-specialist.

## Doc-code verification (CLAUDE.md spot-checks) — all PASS
- `IMAGE_PIPELINE_VERSION = 7` — confirmed `gallery-config-shared.ts:21`. Matches
  CLAUDE.md "IMAGE_PIPELINE_VERSION = 7". No drift.
- ETag format `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash}"`
  — confirmed `serve-upload.ts:122`. Matches CLAUDE.md ETag section. (The `v6-`
  in the nearby comment is an illustrative example string, not the live value.)
- `avif_effort` default 6 — `gallery-config-shared.ts:128`. Matches.
- `wide_gamut_max_source_pixels` default 50_000_000 — `gallery-config-shared.ts:134`.
  Matches.
- i18n EN/KO parity: 812 keys each, 0 missing either direction. Matches the
  "English, Korean" claim with full parity.

No doc drift found this pass.

## Test gaps
- PAT route has a source-contract test (`lr-upload-hdr-gate.test.ts`) that locks
  every cycle 1-3 fix (HDR gate, GPS strip, icc_profile_name column, uploaded_by,
  contract lock acquire/finally-release, RAW message). This is the established
  guardrail pattern (matches `stripe-webhook-source.test.ts`,
  `og-route-source-contracts.test.ts`).
- GAP (LOW): the three cycle-4 PAT parity fixes (restore-maintenance,
  disk-space pre-check, cumulative upload-tracker) will need equivalent
  source-contract assertions added to the same test file so a future refactor
  cannot silently re-drop them. Tracked as part of the cycle-4 fix.

## Code-correctness sweep (under-reviewed surfaces)
- `serve-upload.ts`: ETag derivation, 304 handling, path containment — no logic
  bug found. Range handling delegated to Next, header parsing handles both
  single-tag and comma-list. OK.
- `image-queue.ts`: per-job advisory lock + `WHERE processed = false` conditional
  UPDATE + orphan cleanup — invariants hold. OK.
- `data.ts`: `tagNamesAgg` GROUP_CONCAT shape locked by
  `data-tag-names-sql.test.ts`; public/admin field separation guarded. OK.
- `uploadImages` (browser) restore-maintenance is checked at THREE points (entry,
  post-save cleanup, post-GPS-strip late re-check). The PAT path mirror must
  replicate all three to be faithful (informs the fix shape).

## Summary
- CRIT 0, HIGH 0, MED 0, LOW 1 (cycle-4 PAT parity test-lock gap, folded into the
  fix). No doc drift. No net-new correctness bug in the under-reviewed surfaces.
