-- US-P53 (Phase 5.3): Admin Personal Access Tokens for the Lightroom
-- Classic publish plugin. Tokens are issued in the format
-- `gk_<base64url(32 random bytes)>` and only the SHA-256 hex digest is
-- stored. The plaintext is shown to the admin exactly once at creation
-- time. Verification uses constant-time comparison and enforces
-- expires_at and scope set. The lib at apps/web/src/lib/admin-tokens.ts
-- fails closed (verify returns null, list returns []) until this table
-- exists.
CREATE TABLE `admin_tokens` (
    `id` int AUTO_INCREMENT PRIMARY KEY,
    `user_id` int NOT NULL,
    `label` varchar(255) NOT NULL,
    `token_hash` varchar(64) NOT NULL,
    `scopes` text,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `last_used_at` timestamp NULL,
    `expires_at` timestamp NULL,
    CONSTRAINT `admin_tokens_user_fk` FOREIGN KEY (`user_id`) REFERENCES `admin_users`(`id`) ON DELETE CASCADE,
    INDEX `admin_tokens_token_hash_idx` (`token_hash`),
    INDEX `admin_tokens_user_idx` (`user_id`)
);
--> statement-breakpoint
-- Rollback (manual): DROP TABLE `admin_tokens`;
