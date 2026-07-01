# Cycle 64 Photographer Product / Critic Review

Start HEAD: `efdbaf9a4971e8c59051fe422c8b44d6e9dd455f`

## Scope

Read-only review focused on photographer-product risk: color/HDR honesty, no edit/culling/scoring drift, sharing/privacy expectations, public gallery trust, admin workflow clarity, docs mismatch, and weak assumptions.

## Findings

### C64-PP-01 - Saved color/quality setting changes can lose their backfill warning before existing derivatives are actually updated

- Severity/confidence: Medium / High.
- File/line: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:328`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:270`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:275`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:279`, `apps/web/src/lib/admin-backfill-runner.ts:49`, `apps/web/src/lib/admin-backfill-runner.ts:387`, `apps/web/messages/en.json:788`, `CLAUDE.md:339`.
- Evidence: the Settings page correctly knows that color/quality settings affect existing photo bytes, and it shows a "Backfill required" warning while one of those fields is dirty. On successful save it immediately folds the persisted settings into `baseline` with `setBaseline(nextSettings)`, which clears `hasDirtyBackfillField` and removes the warning. That happens even though the in-app backfill selects only `processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < IMAGE_PIPELINE_VERSION)`, so settings-only byte changes for rows already at the current pipeline version are not re-encoded by the visible "Re-encode now" button.
- Failure scenario: a photographer/admin changes JPEG quality, AVIF effort, chroma subsampling, or force-sRGB behavior, saves successfully, sees the warning disappear, optionally clicks the in-app re-encode button and gets "nothing to do", while existing public derivatives still serve old bytes.
- Fix direction: keep an "existing derivatives need force re-encode" obligation visible after successful saves of byte-impacting settings, or implement an explicit force-reencode in-app mode. At minimum, do not clear the visible obligation merely because the form baseline was saved.

## Non-Findings / Checked Assumptions

- Public HDR honesty is intact in the inspected surfaces: `CLAUDE.md` states public HDR badges stay hidden until real HDR delivery exists, and `ColorDetailsSection` gates HDR rows on `isAdmin && isHdr`.
- Public/shared privacy split is strongly guarded: public selects omit GPS, original filenames, ICC profile names, pipeline version, transfer/HDR internals, and shared single/group queries use those public select fields.
- Share pages use generic/noindex metadata and rate-limited key lookup; no new public gallery trust issue was found there.
- No edit/culling/scoring drift found. The current adjacent AI/product surfaces are labelled as EXIF alt-text hints, stub semantic search, or operator-gated production semantic search.
