-- US-P54: Stripe paid-download entitlements table
-- migration 0013

CREATE TABLE IF NOT EXISTS `entitlements` (
  `id` int NOT NULL AUTO_INCREMENT,
  `image_id` int NOT NULL,
  `tier` varchar(16) NOT NULL,
  `customer_email` varchar(255) NOT NULL,
  `session_id` varchar(255) NOT NULL,
  `amount_total_cents` int NOT NULL,
  `download_token_hash` varchar(64),
  `downloaded_at` timestamp NULL,
  `expires_at` timestamp NOT NULL,
  `refunded` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `entitlements_session_id_unique` (`session_id`),
  KEY `idx_entitlements_image_id` (`image_id`),
  KEY `idx_entitlements_token_hash` (`download_token_hash`),
  CONSTRAINT `entitlements_image_id_fk` FOREIGN KEY (`image_id`) REFERENCES `images` (`id`) ON DELETE CASCADE
);
