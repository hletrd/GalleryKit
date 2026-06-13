# Architecture + Doc-Code Consistency Review — Run-2 Cycle 4 (HEAD 2508f132)

Date: 2026-05-30
Method: direct orchestrator review (Task fan-out unavailable in nested context).

## Verdict: ZERO net-new findings (CRIT 0 / HIGH 0 / MED 0 / LOW 0)

## CLAUDE.md documented invariants verified against code

| Doc claim | Verified |
|---|---|
| `IMAGE_PIPELINE_VERSION = 7` | Matches `lib/process-image.ts`; backfill selects `pipeline_version < 7`. |
| Privacy guard: every admin-only column in `_omit` + `_PrivacySensitiveKeys` + `SENSITIVE_KEYS` fixture | True. Latest admin-only cols (color_space, icc_profile_name, pipeline_version, has_gain_map, was_downscaled, uploaded_by, processing_error, failed_at, bit_depth, GPS, filenames) all present in all three. `avif_10bit` intentionally public (delivered chip) and correctly excluded from SENSITIVE_KEYS — symmetric test enforces this. |
| Migration runbook: hash-coverage not `MAX(created_at)`, reconcile mirrors schema, post-condition assertion | `migrate.js` implements all three; non-monotonic journal `when` at idx 7 defended. `reconcileLegacySchema` mirrors current schema incl. 0020_avif_10bit. |
| Journal monotonicity "add new entry with `when` > max" | Latest entry 0020_avif_10bit `when=1779494400001` is the max; adding-migration contract intact. |
| Advisory-lock names (db_restore, upload_processing_contract, topic_route_segments, admin_delete, color_pipeline_backfill, image-processing:{jobId}) | `lib/advisory-locks.ts` constants match doc names; backfill uses `LOCK_COLOR_PIPELINE_BACKFILL` in both runner + script. |
| Lint gates (api-auth, action-origin) blocking in CI | Both present, both pass, both fixture-tested. |
| Composite indexes on `images` | Schema declares the documented indexes incl. `idx_images_uploaded_by`. |
| Backfill in-app/sidecar equivalence | Runner + script persist identical column sets on both branches (documented in both file headers; matches code). |

## Architecture posture
- Layering intact: server actions → lib runtime modules → db; client components
  use client-safe predicates (`color-pipeline-decisions.ts`, `color-primaries.ts`).
- Single-web-instance/single-writer topology documented and respected
  (process-local queue + backfill state by design, not a scaling bug).
- No doc-code drift found. Code changed since cycle-3 review HEAD (420b7852..HEAD)
  is docs-only (the cycle-3 review artifacts).

## Note on honesty
No stale doc claim, untested invariant, or layering violation found. No findings.
