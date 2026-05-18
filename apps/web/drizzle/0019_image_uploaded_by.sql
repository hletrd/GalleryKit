-- R17-L2: per-entry Atom <author> support.
-- Adds an admin-only `uploaded_by` column on images that records which
-- admin account performed the upload. NULL for legacy rows (the feed
-- falls back to the feed-level <author> per RFC 4287 §4.1.1).
-- ON DELETE SET NULL keeps the photo but drops the authorship link when
-- an admin user is removed.
ALTER TABLE `images` ADD COLUMN `uploaded_by` int DEFAULT NULL;
ALTER TABLE `images` ADD CONSTRAINT `images_uploaded_by_admin_users_id_fk` FOREIGN KEY (`uploaded_by`) REFERENCES `admin_users`(`id`) ON DELETE SET NULL;
CREATE INDEX `idx_images_uploaded_by` ON `images` (`uploaded_by`);
