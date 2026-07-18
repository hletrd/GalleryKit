# Cycle 11/100 Deferred Findings — 2026-07-18

Source: `.context/reviews/_aggregate.md`, Cycle 11 provenance reviews, and
`.context/plans/deferred-carry-forward.md`

## New Cycle 11 findings

None deferred. `COR-C11-01`, `TEST-C11-02`, and `PERF-C11-03` are scheduled in
`cycle-11-2026-07-18-plan.md` with their original severity and confidence.

## Fired schema-cycle carry-forward items

- `C2-16` (Medium/Medium) is scheduled: migration 0031 fired its next-schema-
  touching-cycle criterion.
- `AGG-C20-12` (Medium/Medium) is scheduled: migration 0031 fired its next-
  schema/index-migration criterion.
- `C19-07`, `AGG-C20-28`, and `AGG-C21-08` (High/High) are deduplicated into
  scheduled `TEST-C11-02`, the disposable-MySQL convergence gate.

## Carry-forward corrections

- `C2-21` is already implemented by migration 0029 and current
  `idx_images_processed_updated_at` / `idx_images_topic_updated_at` definitions;
  remove it from the open register during implementation.
- `C8b-04/PERF8-BF-01` is already implemented by migration 0030 and
  `idx_images_processed_pipeline_version(processed, pipeline_version, id)`;
  remove it from the open register during implementation.

## Medium-age checkpoint re-justification

`C94-10/C88-03` remains **Medium / High** with citations in
`cycle-96-2026-07-01-deferred.md:137-145`. Its concrete exit criterion is a
dedicated migration to store one embedding per `(image_id, model_version)` and
the corresponding write/query/backfill/garbage-collection semantics. The
current image-delivery and listing-index DDL does not satisfy that product/data
decision. Folding it opportunistically would expand this cycle into a semantic-
search storage migration and could destructively alter current active-vector
replacement behavior. Reopen when that dedicated multi-model rollout/rollback
project is approved. Original severity/confidence is unchanged.

All eventual work remains subject to `AGENTS.md`: GPG-signed gitmoji
Conventional Commits, pull/rebase before push, no verification/signing bypass,
all configured gates, and the configured per-iteration deploy policy.
