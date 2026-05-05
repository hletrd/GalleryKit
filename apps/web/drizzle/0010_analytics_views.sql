-- Migration 0010: analytics view tables for US-P44
-- image_views: per-photo view events (no full IP stored, only country_code)
CREATE TABLE `image_views` (
  `id` int NOT NULL AUTO_INCREMENT,
  `image_id` int NOT NULL,
  `viewed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `referrer_host` varchar(128) NOT NULL DEFAULT 'direct',
  `country_code` varchar(2) NOT NULL DEFAULT 'XX',
  `bot` boolean NOT NULL DEFAULT false,
  PRIMARY KEY (`id`),
  CONSTRAINT `image_views_image_id_images_id_fk` FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON DELETE CASCADE,
  INDEX `idx_image_views_image_id_viewed_at` (`image_id`, `viewed_at`)
);
--> statement-breakpoint

-- topic_views: per-topic view events
CREATE TABLE `topic_views` (
  `id` int NOT NULL AUTO_INCREMENT,
  `topic` varchar(255) NOT NULL,
  `viewed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `referrer_host` varchar(128) NOT NULL DEFAULT 'direct',
  `country_code` varchar(2) NOT NULL DEFAULT 'XX',
  `bot` boolean NOT NULL DEFAULT false,
  PRIMARY KEY (`id`),
  CONSTRAINT `topic_views_topic_topics_slug_fk` FOREIGN KEY (`topic`) REFERENCES `topics`(`slug`) ON DELETE CASCADE,
  INDEX `idx_topic_views_topic_viewed_at` (`topic`, `viewed_at`)
);
--> statement-breakpoint

-- shared_group_views: durable per-shared-group view events
-- The existing sharedGroups.view_count denormalized column is kept for
-- backwards compat; this table provides the durable per-event record.
CREATE TABLE `shared_group_views` (
  `id` int NOT NULL AUTO_INCREMENT,
  `group_id` int NOT NULL,
  `viewed_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `referrer_host` varchar(128) NOT NULL DEFAULT 'direct',
  `country_code` varchar(2) NOT NULL DEFAULT 'XX',
  `bot` boolean NOT NULL DEFAULT false,
  PRIMARY KEY (`id`),
  CONSTRAINT `shared_group_views_group_id_shared_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `shared_groups`(`id`) ON DELETE CASCADE,
  INDEX `idx_shared_group_views_group_id_viewed_at` (`group_id`, `viewed_at`)
);
