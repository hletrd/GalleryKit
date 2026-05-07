-- US-CM01: Add color_pipeline_decision column for encoder observability.
-- Tracks which color pipeline branch was taken so operators can audit
-- wide-gamut coverage and unknown-profile rates.

ALTER TABLE `images` ADD COLUMN `color_pipeline_decision` varchar(64) DEFAULT NULL AFTER `bit_depth`;
