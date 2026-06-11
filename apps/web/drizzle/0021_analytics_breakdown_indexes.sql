-- PERF-R5C1-02: analytics breakdown indexes for getCountryBreakdown and
-- getReferrerBreakdown queries in analytics-data.ts. Both filter on
-- (bot, viewed_at) and group by country_code or referrer_host respectively.
-- topic_views and shared_group_views have no equivalent breakdown queries so
-- they do not need corresponding indexes at this time.

CREATE INDEX idx_image_views_bot_viewed_country ON image_views (bot, viewed_at, country_code);
CREATE INDEX idx_image_views_bot_viewed_referrer ON image_views (bot, viewed_at, referrer_host);
