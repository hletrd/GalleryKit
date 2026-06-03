# Aggregate Review — Run-3 Cycle 2 (HEAD 2feba5ae)

Date: 2026-06-04
Method: direct orchestrator deep review across all reviewer angles (Task-based
subagent fan-out unavailable in this nested execution context —
`No such tool available: Task` — same constraint as run-2 cycles 1-4 and run-3
cycle 1). Every angle executed directly with provenance files. No angle dropped.

Per-angle provenance:
- `security-reviewer.md` (lead — full constraint matrix)
- `code-reviewer.md`
- `critic-verifier-tracer-architect-perf-test-designer-debugger-docspec.md`
  (critic, verifier, tracer, architect, perf-reviewer, test-engineer, designer,
  debugger, document-specialist consolidated)

Baseline: 157 test files / 1486 tests; lint 0 errors; lint:api-auth OK;
lint:action-origin OK (from cycle-1 close-out). i18n EN/KO parity verified clean
(812/812 keys). Diff since last reviewed HEAD (`2508f132..HEAD`) = cycle-1 fix +
docs.

## Headline

**1 net-new actionable finding (CRIT 0 / HIGH 1 / MED 0 / LOW 0 actionable);
3 LOW divergences deferred with exit criteria.**

This cycle followed the run-context lead: the cycle-1 fix closed only the
`allow_hdr_ingest` divergence between the browser and Lightroom PAT upload
paths. A systematic constraint-by-constraint comparison found the PAT path
STILL diverges — most importantly on **GPS stripping of the on-disk original**,
a privacy leak into the paid-download endpoint.

| ID | Sev | Conf | Angles agreeing | Title |
|----|-----|------|-----------------|-------|
| F1 | HIGH | High | security, code-reviewer, tracer, verifier, architect, test-engineer, debugger, document-specialist (8) | Lightroom PAT upload leaks GPS in the on-disk original despite `strip_gps_on_upload`; surfaces via `/api/download/[imageId]` |
| F2 | LOW | High | security | LR path ignores restore-maintenance window (deferred) |
| F3 | LOW | Med | security | LR path skips 1 GB disk-space pre-check (deferred) |
| F4 | LOW | Med | security | LR path outside cumulative upload-tracker window (deferred) |

### F1 — GPS leak on Lightroom PAT upload (HIGH, scheduled for fix this cycle)

`app/api/admin/lr/upload/route.ts:131-135` nulls `latitude`/`longitude` DB
columns when `config.stripGpsOnUpload` is true, but never calls
`stripGpsFromOriginal()` on the saved file. The browser path
(`app/actions/images.ts:318-324`) does both, with the comment
"PP-BUG-3: also strip GPS EXIF from the on-disk original so the paid-download
endpoint doesn't leak protected locations." The paid-download route
(`api/download/[imageId]/route.ts:218`) streams `filename_original` verbatim, so
a purchased original carries the photographer's GPS coordinates even though the
admin enabled GPS stripping. Privacy / sensitive-data-leak class → NOT
deferrable per CLAUDE.md.

**Fix:** in the LR route, when `config.stripGpsOnUpload`, call
`await stripGpsFromOriginal(path.join(UPLOAD_DIR_ORIGINAL, data.filenameOriginal))`
(best-effort; never aborts the upload). Add a source-contract assertion to the
existing `lr-upload-hdr-gate.test.ts` (rename or extend) so a future refactor
cannot silently re-drop it.

### F2-F4 — LOW divergences (DEFERRED)

The PAT path also lacks the restore-maintenance guard, the disk-space pre-check,
and cumulative-window tracking. All LOW: the PAT is an authenticated admin scope,
the shared per-file 200 MB cap + decompression-bomb `limitInputPixels` (both in
`saveOriginalAndGetMetadata`) bound the real DoS/abuse surface, and the
single-writer topology (CLAUDE.md) keeps the restore-window race narrow.
Recorded in `.context/plans/run3-cycle2/_deferred.md` with severity preserved
and concrete re-open criteria. Per CLAUDE.md runtime-topology + Permanently
Deferred policy, deferral of LOW operational-hardening on a trusted admin scope
is permitted; no security/correctness/data-loss item is deferred (F1 is fixed).

## Severity tally
- CRIT 0 | HIGH 1 (F1, fixed this cycle) | MED 0 | LOW 3 (deferred)
- Carryover deferrals from run-2/run-3 ledgers: re-verified, none of their exit
  criteria fired this cycle.

## Cross-angle agreement
- F1: 8 angles agree, traced end-to-end against the download route source —
  high signal, unanimous HIGH after verifier confirmed it is a privacy leak
  (not a HARD-SCOPE feature, not a public-honesty color issue).

## AGENT FAILURES
Task-based subagent fan-out unavailable in this nested execution context; all
angles executed directly by the orchestrator into provenance files. No retry
needed; no angle dropped.
