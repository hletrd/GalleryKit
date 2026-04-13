CREATE TABLE IF NOT EXISTS `admin_users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`username` varchar(255) NOT NULL,
	`password_hash` varchar(512) NOT NULL,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `admin_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_users_username_unique` UNIQUE(`username`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `audit_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int,
	`action` varchar(64) NOT NULL,
	`target_type` varchar(64),
	`target_id` varchar(128),
	`ip` varchar(45),
	`metadata` text,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rate_limit_buckets` (
	`ip` varchar(45) NOT NULL,
	`bucket_type` varchar(20) NOT NULL,
	`bucket_start` bigint NOT NULL,
	`count` int NOT NULL DEFAULT 1,
	CONSTRAINT `rate_limit_buckets_ip_bucket_type_bucket_start_pk` PRIMARY KEY(`ip`,`bucket_type`,`bucket_start`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sessions` (
	`id` varchar(255) NOT NULL,
	`user_id` int NOT NULL,
	`expires_at` timestamp NOT NULL,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `topic_aliases` (
	`alias` varchar(255) NOT NULL,
	`topic_slug` varchar(255) NOT NULL,
	CONSTRAINT `topic_aliases_alias` PRIMARY KEY(`alias`)
);
--> statement-breakpoint
ALTER TABLE `images` DROP FOREIGN KEY `images_topic_topics_slug_fk`;
--> statement-breakpoint
ALTER TABLE `images` MODIFY COLUMN `capture_date` datetime;--> statement-breakpoint
ALTER TABLE `images` MODIFY COLUMN `latitude` double;--> statement-breakpoint
ALTER TABLE `images` MODIFY COLUMN `longitude` double;--> statement-breakpoint
ALTER TABLE `images` ADD `user_filename` varchar(255);--> statement-breakpoint
ALTER TABLE `images` ADD `white_balance` varchar(50);--> statement-breakpoint
ALTER TABLE `images` ADD `metering_mode` varchar(50);--> statement-breakpoint
ALTER TABLE `images` ADD `exposure_compensation` varchar(20);--> statement-breakpoint
ALTER TABLE `images` ADD `exposure_program` varchar(50);--> statement-breakpoint
ALTER TABLE `images` ADD `flash` varchar(50);--> statement-breakpoint
ALTER TABLE `images` ADD `bit_depth` int;--> statement-breakpoint
ALTER TABLE `images` ADD `original_format` varchar(10);--> statement-breakpoint
ALTER TABLE `images` ADD `original_file_size` bigint;--> statement-breakpoint
ALTER TABLE `images` ADD `blur_data_url` text;--> statement-breakpoint
ALTER TABLE `shared_group_images` ADD `position` int DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `shared_group_images` AS `current`
SET `position` = (
	SELECT COUNT(*) - 1
	FROM `shared_group_images` AS `earlier`
	WHERE `earlier`.`group_id` = `current`.`group_id`
	  AND `earlier`.`image_id` <= `current`.`image_id`
)
WHERE `current`.`position` = 0;--> statement-breakpoint
ALTER TABLE `shared_groups` ADD `view_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `shared_groups` ADD `expires_at` datetime;--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_user_id_admin_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_admin_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `topic_aliases` ADD CONSTRAINT `topic_aliases_topic_slug_topics_slug_fk` FOREIGN KEY (`topic_slug`) REFERENCES `topics`(`slug`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_user_idx` ON `audit_log` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_action_idx` ON `audit_log` (`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires_at` ON `sessions` (`expires_at`);--> statement-breakpoint
ALTER TABLE `images` ADD CONSTRAINT `images_topic_topics_slug_fk` FOREIGN KEY (`topic`) REFERENCES `topics`(`slug`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_image_tags_tag_id` ON `image_tags` (`tag_id`);--> statement-breakpoint
CREATE INDEX `idx_images_processed_capture_date` ON `images` (`processed`,`capture_date`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_images_processed_created_at` ON `images` (`processed`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_images_topic` ON `images` (`topic`,`processed`,`capture_date`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_images_user_filename` ON `images` (`user_filename`);--> statement-breakpoint
CREATE INDEX `idx_shared_group_images_group_position` ON `shared_group_images` (`group_id`,`position`);