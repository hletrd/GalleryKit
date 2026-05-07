-- US-CM04: CICP/HDR foundation columns.
-- color_primaries, transfer_function, matrix_coefficients support future
-- HDR AVIF delivery without a schema migration. is_hdr gates UI badges.

ALTER TABLE `images`
    ADD COLUMN `color_primaries` varchar(32) DEFAULT NULL AFTER `color_pipeline_decision`,
    ADD COLUMN `transfer_function` varchar(16) DEFAULT NULL AFTER `color_primaries`,
    ADD COLUMN `matrix_coefficients` varchar(16) DEFAULT NULL AFTER `transfer_function`,
    ADD COLUMN `is_hdr` boolean NOT NULL DEFAULT FALSE AFTER `matrix_coefficients`;
