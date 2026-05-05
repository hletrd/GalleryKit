-- C17-MED-03: Add icc_profile_name column to images table
-- so bootstrapped queue jobs can receive ICC profile metadata.

ALTER TABLE `images` ADD COLUMN `icc_profile_name` varchar(255) DEFAULT NULL AFTER `color_space`;
