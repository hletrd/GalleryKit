# Run-4 Cycle 11 — document-specialist angle

## Inventory
- CLAUDE.md "Runtime topology" shared-group analytics note vs. `data.ts`
  flush behavior.
- CLAUDE.md "Color & HDR Pipeline" gps-strip trailer docblock vs.
  `gps-exif-strip.ts` (post c10).
- `audit_log` delete contract vs. `deleteAdminUser` (post c10).

## Findings
- **DOC-R4C11-01 (LOW, folds into COR-R4C11-01).** CLAUDE.md documents the
  shared-group `view_count` as best-effort approximate "increments are
  buffered in process memory and flushed asynchronously, so a crash, process
  kill, or extended DB outage can undercount." That sentence covers the
  *undercount-during-outage* mode but not the *stranded-timer-stops-draining*
  mode this cycle's COR-R4C11-01 fix addresses (the flush ceases entirely,
  not just undercounts, until restart). No doc change is required once the
  code is fixed — the fix restores the documented "flushed asynchronously"
  contract, so the existing wording becomes accurate again. Recorded for
  provenance only; no standalone doc edit scheduled.

## Verified accurate (no drift)
- The c10 `gps-exif-strip.ts` docblock (lines 23-27) correctly describes the
  post-EOI trailer → null → re-encode behavior.
- The c10 admin-delete inline comment accurately states the FK reason and the
  no-migration rationale; schema confirms `target_id` carries no FK so the
  "detaches the actor linkage" claim is complete.
- CLAUDE.md IMAGE_PIPELINE_VERSION = 7 matches `gallery-config-shared.ts`.
