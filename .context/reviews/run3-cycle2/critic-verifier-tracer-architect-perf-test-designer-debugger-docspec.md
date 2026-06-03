# Consolidated angles — Run-3 Cycle 2 (HEAD 2feba5ae)

critic, verifier, tracer, architect, perf-reviewer, test-engineer, designer,
debugger, document-specialist — executed directly by the orchestrator (Task
subagent fan-out unavailable in this nested context, same as run-2/run-3-cycle-1).

## tracer — GPS data flow (confirms F1)

upload (LR PAT) → `saveOriginalAndGetMetadata` writes original w/ GPS to disk →
DB columns nulled when `stripGpsOnUpload` → original UNCHANGED on disk →
`license_tier` set later → `/api/download/[imageId]` `createReadStream` of
`filename_original` → customer gets GPS. The break is the missing
`stripGpsFromOriginal()` call; every other node in the path is correct. Browser
path has the node; LR path does not.

## verifier — honesty / scope check

F1 is a privacy/data-leak finding (precise geolocation PII), NOT a public-honesty
color/HDR issue and NOT a HARD-SCOPE editing feature. The fix restores an
EXISTING privacy gate on a second ingest path — no new feature, no
edit/cull/score surface. Scope-clean to implement.

## architect — root cause

Two parallel upload insert paths with no shared ingest-policy helper. R8 plan
predicted exactly this (it predicted the HDR drift cycle 1 fixed, and the same
structural cause produces the GPS drift). Recorded as a follow-up refactor
(extract `applyIngestPolicy`) but the minimal port is the correct fix this
cycle — a refactor under time pressure risks regressing the browser path.

## test-engineer — coverage

The LR route gained its first test in cycle 1 (`lr-upload-hdr-gate.test.ts`,
source-contract style). F1 needs an analogous source-contract assertion: the LR
route source must contain a `stripGpsFromOriginal(` call guarded by
`config.stripGpsOnUpload`, and the import must be present. Full multipart+Sharp
integration is heavier than the repo convention (matches
`og-route-source-contracts.test.ts`, `stripe-webhook-source.test.ts`). Extend
the existing `lr-upload-hdr-gate.test.ts` rather than add a new file — same
route, same contract family.

## perf-reviewer — no new findings

`stripGpsFromOriginal` adds one Sharp re-encode of the original per LR upload
when `stripGpsOnUpload` is on (default off). Identical cost to the browser path,
which already pays it. Off the hot path for the common (GPS-strip-off)
deployment. No concern.

## designer — no UI delta

F1 is server-side; no component, route, focus, contrast, or i18n change. The
admin "GPS stripping" setting copy already promises the behavior the fix
delivers; no UI doc change needed. Prior cycles' UI audit (touch targets, WCAG)
unchanged this cycle.

## debugger — repro reasoning

With `strip_gps_on_upload=true`, POST a geotagged JPEG/HEIC to
`/api/admin/lr/upload`; `exiftool` the resulting file in
`data/uploads/original/` → GPS tags present (bug). Same file via browser upload
→ GPS tags absent (correct). After fix, both absent.

## document-specialist — doc/code consistency

CLAUDE.md Privacy section and the `strip_gps_on_upload` admin tunable both imply
GPS is removed at ingest. The LR path violated that implied contract. The fix
brings code back in line with docs; no doc edit required beyond the in-code
comment. (The `stripGpsFromOriginal` JSDoc already notes "only the
download-original path remains at risk" if the strip is skipped — exactly this
case.)

## Net
- 1 net-new actionable HIGH (F1, GPS-original leak on LR path).
- 3 LOW divergences (F2 restore-maintenance, F3 disk pre-check, F4 cumulative
  window) — recorded, deferred with exit criteria (PAT-trust + single-writer).
