-- US-CM11: Pipeline version marker for idempotent backfill.
-- Images processed before this migration have NULL pipeline_version.
-- The backfill script updates this to 5 after re-encoding derivatives.

ALTER TABLE `images`
    ADD COLUMN `pipeline_version` int DEFAULT NULL AFTER `is_hdr`;
