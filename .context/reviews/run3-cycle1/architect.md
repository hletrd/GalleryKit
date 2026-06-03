# Architect Review — Run-3 Cycle 1 (HEAD 2508f132)

Date: 2026-06-04
Method: direct orchestrator review (Task fan-out unavailable; see
test-engineer.md preamble).

## Findings

### F2 (architecture angle) — browser vs Lightroom upload-path divergence — MEDIUM

The two ingest paths (`app/actions/images.ts` browser action and
`app/api/admin/lr/upload/route.ts` PAT route) duplicate the "build insert
values + enqueue" logic instead of sharing a helper. R8-H2 already partially
synced them (color signal storage) and the R8 plan explicitly recommended
extracting a shared helper to *prevent future drift*. That extraction never
happened, and the predicted drift materialized as F2 (HDR ingest gate present in
one path, absent in the other).

Architectural recommendation (NOT in scope as a new feature — a refactor that
the repo's own R8 plan already called for): after fixing F2 minimally (port the
gate), consider extracting a `buildImageInsertValues(data, config)` +
`shouldRejectIngest(data, config)` helper consumed by both paths so the next
admin-setting that gates ingest cannot diverge again. Track as a follow-up; the
minimal gate port is the immediate fix.

## Re-verified clean

- Layering: lib (pure / IO-light) → actions/routes (auth + orchestration) →
  db (Drizzle). `serve-upload`/`image-queue`/`backfill-runner` respect it.
- Single-writer topology assumptions documented in CLAUDE.md and matched by
  process-local queue/backfill state + MySQL advisory locks for cross-process
  serialization.
- Advisory-lock namespace (server-scoped, not DB-scoped) documented; image
  processing claim, restore, backfill, upload-contract, topic-rename,
  admin-delete locks all paired with release.
- No new coupling or circular-dependency introduced (diff since last review is
  docs-only).
