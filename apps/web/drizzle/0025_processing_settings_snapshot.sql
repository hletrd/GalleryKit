ALTER TABLE `images`
  ADD COLUMN `processing_settings_json` text DEFAULT NULL AFTER `failed_at`;
