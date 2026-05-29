# Document Specialist — Run-2 Cycle 2 (HEAD 317126cf)

Angle: doc/code mismatch against authoritative repo sources.

## DOC2-01 — CLAUDE.md backfill equivalence note is now imprecise on the failure path (LOW, Medium) — folds into CR2-01 fix

The cycle-1 doc note (commit b2362d60) added to CLAUDE.md "Color & HDR Pipeline →
Backfill" states the in-app button and the sidecar script persist the SAME
columns. After CR2-01 this is true ONLY on the success path — on the
detection-failure branch the script writes nothing while the runner writes
`avif_10bit`/`was_downscaled`. Once CR2-01 is fixed (both paths persist the
derivative columns on detection failure), the note becomes fully accurate again;
no separate doc change needed beyond confirming the note holds after the fix. If
CR2-01 is deferred instead of fixed, the note should be qualified to "on the
success path." Recommend: fix CR2-01 so the note stays true as written.

## Verified clean
- CLAUDE.md numeric/name claims still accurate: pipeline v7, avif_effort 6,
  wide_gamut_max_source_pixels 50M, advisory lock names, `_PrivacySensitiveKeys`
  union (incl. `was_downscaled` admin-only, `avif_10bit` public — matches
  data.ts:254 / :390).
- The runner header's "pick up where it left off" resume contract now matches
  code on BOTH the success and detection-failure branches (cycle-1 AGG-01 fix).
