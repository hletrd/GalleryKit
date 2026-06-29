CREATE INDEX idx_image_views_bot_viewed_image ON image_views (bot, viewed_at, image_id);
CREATE INDEX idx_topic_views_bot_viewed_topic ON topic_views (bot, viewed_at, topic);
CREATE INDEX idx_shared_group_views_bot_viewed_group ON shared_group_views (bot, viewed_at, group_id);
