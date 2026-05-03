-- Migration 0012: image_embeddings table for US-P51 (CLIP semantic search)
-- Stores 512-dim float32 CLIP embeddings as MEDIUMBLOB (2048 bytes per row).
-- model_version tracks which encoder produced the embedding ('stub-sha256-v1' for stub).
-- No PII: only image_id and the float32 vector are stored.
CREATE TABLE `image_embeddings` (
    `image_id` int NOT NULL,
    `embedding` mediumblob NOT NULL,
    `model_version` varchar(32) NOT NULL,
    `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`image_id`),
    CONSTRAINT `image_embeddings_image_id_fk` FOREIGN KEY (`image_id`) REFERENCES `images` (`id`) ON DELETE CASCADE
);
