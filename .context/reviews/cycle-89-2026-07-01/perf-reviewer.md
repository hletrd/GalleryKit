# Cycle 89 Performance Reviewer

Start HEAD: `10cd16622c9c7d1d2b26dd45e9e6afe34b21b3e5`.

## Inventory

Reviewed image-processing bounds, sidecar and in-app color backfill, Sharp fan-out, CLIP inference limits, semantic/similar scan caps, OG fetch budgets, derivative serving cache behavior, and the existing semantic embedding deferred record.

## Findings

### C89-02 - Color backfill detection ignores the operator-tuned full-image pixel cap

- Severity: Medium.
- Confidence: High.
- Citations: `apps/web/scripts/backfill-color-pipeline.ts:275`, `apps/web/src/lib/admin-backfill-runner.ts:591`, `apps/web/src/lib/process-image.ts:352`, `apps/web/src/lib/process-image.ts:1109`, `apps/web/src/lib/process-image.ts:1280`.
- Problem: The encode path uses env-backed `MAX_INPUT_PIXELS`, but both post-reencode color-detection paths hard-code `256 * 1024 * 1024`.
- Failure scenario: An operator raises `IMAGE_MAX_INPUT_PIXELS` to accept/reprocess very large panoramas. Encoding succeeds under the raised cap, but backfill detection still rejects at 256M pixels, leaves `pipeline_version` stale, and retries the same expensive row on later backfills.
- Suggested fix: Import and use `MAX_INPUT_PIXELS` in both color-backfill detection `sharp()` constructors and add a source-contract test.

## Non-Findings

`C88-03` semantic embedding row shape remains a valid deferred schema/data migration item and was not re-raised as a Cycle 89 narrow fix.
