CREATE TABLE `admin_settings` (
	`key` varchar(255) NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT `admin_settings_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `image_tags` (
	`image_id` int NOT NULL,
	`tag_id` int NOT NULL,
	CONSTRAINT `image_tags_image_id_tag_id_unique` UNIQUE(`image_id`,`tag_id`)
);
--> statement-breakpoint
CREATE TABLE `images` (
	`id` int AUTO_INCREMENT NOT NULL,
	`filename_original` varchar(255) NOT NULL,
	`filename_avif` varchar(255) NOT NULL,
	`filename_webp` varchar(255) NOT NULL,
	`filename_jpeg` varchar(255) NOT NULL,
	`width` int NOT NULL,
	`height` int NOT NULL,
	`original_width` int,
	`original_height` int,
	`title` varchar(255),
	`description` text,
	`share_key` varchar(255),
	`topic` varchar(255) NOT NULL,
	`capture_date` varchar(255),
	`camera_model` varchar(255),
	`lens_model` varchar(255),
	`iso` int,
	`f_number` float,
	`exposure_time` varchar(255),
	`focal_length` float,
	`latitude` float,
	`longitude` float,
	`color_space` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	`processed` boolean DEFAULT true,
	CONSTRAINT `images_id` PRIMARY KEY(`id`),
	CONSTRAINT `images_share_key_unique` UNIQUE(`share_key`)
);
--> statement-breakpoint
CREATE TABLE `shared_group_images` (
	`group_id` int NOT NULL,
	`image_id` int NOT NULL,
	CONSTRAINT `shared_group_images_group_id_image_id_unique` UNIQUE(`group_id`,`image_id`)
);
--> statement-breakpoint
CREATE TABLE `shared_groups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(255) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `shared_groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `shared_groups_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(255) NOT NULL,
	CONSTRAINT `tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `tags_name_unique` UNIQUE(`name`),
	CONSTRAINT `tags_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`slug` varchar(255) NOT NULL,
	`label` varchar(255) NOT NULL,
	`order` int DEFAULT 0,
	`image_filename` varchar(255),
	CONSTRAINT `topics_slug` PRIMARY KEY(`slug`)
);
--> statement-breakpoint
ALTER TABLE `image_tags` ADD CONSTRAINT `image_tags_image_id_images_id_fk` FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `image_tags` ADD CONSTRAINT `image_tags_tag_id_tags_id_fk` FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `images` ADD CONSTRAINT `images_topic_topics_slug_fk` FOREIGN KEY (`topic`) REFERENCES `topics`(`slug`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shared_group_images` ADD CONSTRAINT `shared_group_images_group_id_shared_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `shared_groups`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shared_group_images` ADD CONSTRAINT `shared_group_images_image_id_images_id_fk` FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON DELETE cascade ON UPDATE no action;