CREATE INDEX idx_images_processed_updated_at ON images (processed, updated_at, created_at, id);
--> statement-breakpoint
CREATE INDEX idx_images_topic_updated_at ON images (topic, processed, updated_at, created_at, id);
