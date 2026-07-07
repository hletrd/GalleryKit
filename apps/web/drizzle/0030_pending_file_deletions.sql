CREATE TABLE `pending_file_deletions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`image_id` int,
	`filename_original` varchar(255) NOT NULL,
	`filename_webp` varchar(255) NOT NULL,
	`filename_avif` varchar(255) NOT NULL,
	`filename_jpeg` varchar(255) NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`last_error` text,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pending_file_deletions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_pending_file_deletions_image_id` ON `pending_file_deletions` (`image_id`);
--> statement-breakpoint
CREATE INDEX `idx_pending_file_deletions_updated_at` ON `pending_file_deletions` (`updated_at`);
--> statement-breakpoint
CREATE INDEX `idx_images_processed_pipeline_version` ON `images` (`processed`,`pipeline_version`,`id`);
