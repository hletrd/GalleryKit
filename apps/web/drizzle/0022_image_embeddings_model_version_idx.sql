-- Migration 0022: composite index on image_embeddings(model_version, updated_at).
-- AGG-C8-03 (run-6 cycle-8, plan-349 DEF-2 exit): the live semantic + similar
-- search routes run `WHERE model_version = ? ORDER BY updated_at DESC LIMIT 5000`
-- against image_embeddings, which had only PRIMARY KEY(image_id) — so every public
-- query did a full table scan + filesort. Now that the production CLIP feature is
-- LIVE and the table grows with the library, add the composite index that serves
-- both the equality filter and the descending sort.
CREATE INDEX `idx_image_embeddings_model_version_updated`
    ON `image_embeddings` (`model_version`, `updated_at`);
