-- US-P42 (Phase 4.2): Smart collections — admin-defined dynamic galleries
-- driven by an EXIF/topic/tag predicate AST stored in query_json. The AST
-- compiler in apps/web/src/lib/smart-collections.ts enforces an allowlist of
-- column names, bounded depth (max 4), and Drizzle parameter binding so no
-- raw SQL is ever concatenated.
CREATE TABLE `smart_collections` (
    `id` int AUTO_INCREMENT PRIMARY KEY,
    `slug` varchar(255) NOT NULL,
    `name` varchar(255) NOT NULL,
    `query_json` text NOT NULL,
    `is_public` boolean NOT NULL DEFAULT false,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `smart_collections_slug_unique` UNIQUE (`slug`),
    INDEX `idx_smart_collections_public` (`is_public`)
);
--> statement-breakpoint
-- Rollback (manual): DROP TABLE `smart_collections`;
