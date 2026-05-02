-- US-P21 (Phase 2.1): per-topic opt-in for the public /map view.
-- The new `map_visible` column defaults to false so every existing topic
-- stays GPS-private until an admin explicitly opts in. Read-paths join on
-- this flag and the publicMapSelectFields contract is the ONLY public-
-- facing select that exposes images.latitude / images.longitude.
ALTER TABLE `topics` ADD `map_visible` boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- Rollback (manual): ALTER TABLE `topics` DROP COLUMN `map_visible`;
