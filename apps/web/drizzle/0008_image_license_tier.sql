ALTER TABLE `images` ADD COLUMN `license_tier` ENUM('none','editorial','commercial','rm') NOT NULL DEFAULT 'none';
