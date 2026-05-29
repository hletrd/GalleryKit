# Document Specialist — Run-2 Cycle 3 (HEAD 420b7852)

Angle: doc/code mismatches against authoritative sources (CLAUDE.md, AGENTS.md,
in-code contracts).

## Findings
NONE net-new actionable.

### Verified doc↔code alignment
- CLAUDE.md "Color & HDR Pipeline → Backfill" equivalence note (added cycle-1
  TASK 5, commit b2362d60): still accurate after cycle-2's AGG2-01 fix — both
  the in-app runner and sidecar script now persist the same columns on BOTH the
  success and detection-failure branches. The note's "both persist the same
  columns" claim holds.
- `IMAGE_PIPELINE_VERSION = 7`: consistent across `process-image.ts` (source of
  truth), CLAUDE.md (documented as 7), serve-upload ETag, both backfill paths,
  and the backfill script header comment ("currently 7"). No drift.
- ETag formula in CLAUDE.md ("ETag / cache invalidation" section):
  `W/"v${IMAGE_PIPELINE_VERSION}-${mtimeMs}-${size}-${settingsHash.slice(0,8)}"`
  matches `serve-upload.ts:122` (the implementation uses the full
  `getColorSettingsHash(config)` which is already 8-char per `settings-hash.ts`).
  Consistent.
- Color/HDR honesty rule (is_hdr / transfer_function / matrix_coefficients
  admin-only until WI-09): re-verified — these remain in the `_PrivacySensitiveKeys`
  guard / `_omit` block per data.ts contract. No premature public exposure.
- Advisory-lock list in CLAUDE.md (C8R-RPL-06): matches the lock names used in
  db-actions.ts, image-queue.ts, admin-backfill-runner.ts. No new lock added.

Confidence: High.
