-- US-P31 (Phase 3.1): Anonymous visitor reactions (heart/like).
-- visitor_id_hash = SHA-256(visitor_uuid + YYYY-MM-DD) — no PII stored.
-- reaction_count on images is updated atomically inside a transaction.
ALTER TABLE `images` ADD COLUMN `reaction_count` int NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE `image_reactions` (
    `id` int AUTO_INCREMENT PRIMARY KEY,
    `image_id` int NOT NULL,
    `visitor_id_hash` varchar(64) NOT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `image_reactions_image_fk` FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON DELETE CASCADE,
    UNIQUE INDEX `image_reactions_image_visitor_unique` (`image_id`, `visitor_id_hash`),
    INDEX `image_reactions_image_id_idx` (`image_id`)
);
--> statement-breakpoint
-- Rollback (manual): DROP TABLE `image_reactions`; ALTER TABLE `images` DROP COLUMN `reaction_count`;
