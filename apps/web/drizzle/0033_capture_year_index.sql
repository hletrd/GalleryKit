ALTER TABLE `images`
    ADD COLUMN `capture_year` smallint unsigned GENERATED ALWAYS AS (YEAR(`capture_date`)) STORED AFTER `capture_day`;
--> statement-breakpoint
CREATE INDEX `idx_images_processed_capture_year` ON `images` (`processed`,`capture_year`);
