ALTER TABLE `images`
    ADD COLUMN `capture_month` tinyint unsigned GENERATED ALWAYS AS (MONTH(`capture_date`)) STORED AFTER `capture_date`,
    ADD COLUMN `capture_day` tinyint unsigned GENERATED ALWAYS AS (DAY(`capture_date`)) STORED AFTER `capture_month`;
--> statement-breakpoint
CREATE INDEX `idx_images_processed_capture_month_day` ON `images` (`processed`,`capture_month`,`capture_day`,`capture_date`,`created_at`,`id`);
--> statement-breakpoint
DROP INDEX `idx_images_processed_capture_date` ON `images`;
--> statement-breakpoint
CREATE INDEX `idx_images_processed_capture_date` ON `images` (`processed`,`capture_date`,`created_at`,`id`);
--> statement-breakpoint
DROP INDEX `idx_images_topic` ON `images`;
--> statement-breakpoint
CREATE INDEX `idx_images_topic` ON `images` (`topic`,`processed`,`capture_date`,`created_at`,`id`);
