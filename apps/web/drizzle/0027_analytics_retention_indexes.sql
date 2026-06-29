CREATE INDEX idx_image_views_viewed_at_id ON image_views (viewed_at, id);
CREATE INDEX idx_topic_views_viewed_at_id ON topic_views (viewed_at, id);
CREATE INDEX idx_shared_group_views_viewed_at_id ON shared_group_views (viewed_at, id);
