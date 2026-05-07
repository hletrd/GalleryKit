import { mysqlTable, varchar, int, float, double, uniqueIndex, index, timestamp, datetime, boolean, text, primaryKey, bigint } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

export const topics = mysqlTable("topics", {
    slug: varchar("slug", { length: 255 }).primaryKey(),
    label: varchar("label", { length: 255 }).notNull(),
    order: int("order").default(0),
    image_filename: varchar("image_filename", { length: 255 }),
    // US-P21: per-topic opt-in for the public /map view. Defaults to false so
    // every existing topic stays GPS-private until an admin explicitly opts in.
    map_visible: boolean("map_visible").notNull().default(false),
});

export const topicAliases = mysqlTable("topic_aliases", {
    alias: varchar("alias", { length: 255 }).primaryKey(),
    topicSlug: varchar("topic_slug", { length: 255 }).references(() => topics.slug, { onDelete: 'cascade' }).notNull(),
});

export const images = mysqlTable("images", {
    id: int("id").primaryKey().autoincrement(),
    filename_original: varchar("filename_original", { length: 255 }).notNull(),
    filename_avif: varchar("filename_avif", { length: 255 }).notNull(),
    filename_webp: varchar("filename_webp", { length: 255 }).notNull(),
    filename_jpeg: varchar("filename_jpeg", { length: 255 }).notNull(),
    width: int("width").notNull(),
    height: int("height").notNull(),
    original_width: int("original_width"),
    original_height: int("original_height"),
    title: varchar("title", { length: 255 }),
    description: text("description"),
    user_filename: varchar("user_filename", { length: 255 }),
    share_key: varchar("share_key", { length: 255 }).unique(),
    topic: varchar("topic", { length: 255 }).references(() => topics.slug, { onDelete: 'restrict' }).notNull(),

    // EXIF Data
    capture_date: datetime("capture_date", { mode: 'string' }),
    camera_model: varchar("camera_model", { length: 255 }),
    lens_model: varchar("lens_model", { length: 255 }),
    iso: int("iso"),
    f_number: float("f_number"),
    exposure_time: varchar("exposure_time", { length: 255 }),
    focal_length: float("focal_length"),
    latitude: double("latitude"),
    longitude: double("longitude"),
    color_space: varchar("color_space", { length: 255 }),
    icc_profile_name: varchar("icc_profile_name", { length: 255 }),
    white_balance: varchar('white_balance', { length: 50 }),
    metering_mode: varchar('metering_mode', { length: 50 }),
    exposure_compensation: varchar('exposure_compensation', { length: 20 }),
    exposure_program: varchar('exposure_program', { length: 50 }),
    flash: varchar('flash', { length: 50 }),
    bit_depth: int('bit_depth'),
    color_pipeline_decision: varchar('color_pipeline_decision', { length: 64 }),
    original_format: varchar('original_format', { length: 10 }),
    original_file_size: bigint('original_file_size', { mode: 'number' }),
    // US-P41: license tier for bulk metadata editor. Validated as enum at action layer.
    license_tier: varchar('license_tier', { length: 16 }).notNull().default('none'),
    blur_data_url: text('blur_data_url'),

    // US-P52: AI-generated alt text suggestion. NULL until caption hook runs.
    // PUBLIC field — used as <img alt> fallback when image.title is empty (SEO + a11y).
    // Admin-set alt (title/description) always takes precedence; this is never auto-applied.
    alt_text_suggested: text('alt_text_suggested'),

    created_at: timestamp("created_at")
        .default(sql`CURRENT_TIMESTAMP`)
        .notNull(),
    updated_at: timestamp("updated_at")
        .default(sql`CURRENT_TIMESTAMP`)
        .onUpdateNow()
        .notNull(),
    processed: boolean("processed").default(false),
}, (table) => ({
    idxImagesProcessedCaptureDate: index('idx_images_processed_capture_date').on(table.processed, table.capture_date, table.created_at),
    idxImagesProcessedCreatedAt: index('idx_images_processed_created_at').on(table.processed, table.created_at),
    idxImagesTopic: index('idx_images_topic').on(table.topic, table.processed, table.capture_date, table.created_at),
    idxImagesUserFilename: index('idx_images_user_filename').on(table.user_filename),
}));

export const tags = mysqlTable("tags", {
    id: int("id").primaryKey().autoincrement(),
    name: varchar("name", { length: 255 }).notNull().unique(),
    slug: varchar("slug", { length: 255 }).notNull().unique(),
});

export const imageTags = mysqlTable("image_tags", {
    imageId: int("image_id").references(() => images.id, { onDelete: 'cascade' }).notNull(),
    tagId: int("tag_id").references(() => tags.id, { onDelete: 'cascade' }).notNull(),
}, (table) => ({
    imageIdTagIdUnique: uniqueIndex('image_tags_image_id_tag_id_unique').on(table.imageId, table.tagId),
    idxImageTagsTagId: index('idx_image_tags_tag_id').on(table.tagId),
}));

export const adminSettings = mysqlTable("admin_settings", {
    key: varchar("key", { length: 255 }).primaryKey(),
    value: text("value").notNull(),
});

export const sharedGroups = mysqlTable("shared_groups", {
    id: int("id").primaryKey().autoincrement(),
    key: varchar("key", { length: 255 }).notNull().unique(),
    view_count: int("view_count").default(0).notNull(),
    expires_at: datetime("expires_at", { mode: 'string' }),
    created_at: timestamp("created_at")
        .default(sql`CURRENT_TIMESTAMP`)
        .notNull(),
});

export const sharedGroupImages = mysqlTable("shared_group_images", {
    groupId: int("group_id").references(() => sharedGroups.id, { onDelete: 'cascade' }).notNull(),
    imageId: int("image_id").references(() => images.id, { onDelete: 'cascade' }).notNull(),
    position: int("position").default(0).notNull(),
}, (table) => ({
    groupIdImageIdUnique: uniqueIndex('shared_group_images_group_id_image_id_unique').on(table.groupId, table.imageId),
    groupIdPositionIdx: index('idx_shared_group_images_group_position').on(table.groupId, table.position),
}));

export const adminUsers = mysqlTable("admin_users", {
    id: int("id").primaryKey().autoincrement(),
    username: varchar("username", { length: 255 }).notNull().unique(),
    password_hash: varchar("password_hash", { length: 512 }).notNull(),
    created_at: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    // C16-LOW-14: timestamps password changes at column level.
    updated_at: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
});

export const auditLog = mysqlTable("audit_log", {
    id: int("id").primaryKey().autoincrement(),
    userId: int("user_id").references(() => adminUsers.id),
    action: varchar("action", { length: 64 }).notNull(),
    targetType: varchar("target_type", { length: 64 }),
    targetId: varchar("target_id", { length: 128 }),
    ip: varchar("ip", { length: 45 }),
    metadata: text("metadata"),
    created_at: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
    createdAtIdx: index("audit_created_at_idx").on(table.created_at),
    userIdx: index("audit_user_idx").on(table.userId, table.created_at),
    actionIdx: index("audit_action_idx").on(table.action, table.created_at),
}));

export const sessions = mysqlTable("sessions", {
    id: varchar("id", { length: 255 }).primaryKey(),
    userId: int("user_id").references(() => adminUsers.id, { onDelete: 'cascade' }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
}, (table) => ({
    idxSessionsExpiresAt: index('idx_sessions_expires_at').on(table.expiresAt),
}));

// US-P53: Admin Personal Access Tokens (PATs) for non-browser integrations
// such as the Lightroom Classic publish plugin. Only the SHA-256 digest of
// the token is persisted; plaintext is shown to the admin exactly once at
// creation time. The lib at apps/web/src/lib/admin-tokens.ts fails closed
// when this table is missing (verify returns null, list returns []).
export const adminTokens = mysqlTable("admin_tokens", {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").references(() => adminUsers.id, { onDelete: 'cascade' }).notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    scopes: text("scopes"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    lastUsedAt: timestamp("last_used_at"),
    expiresAt: timestamp("expires_at"),
}, (table) => ({
    tokenHashIdx: index("admin_tokens_token_hash_idx").on(table.tokenHash),
    userIdx: index("admin_tokens_user_idx").on(table.userId),
}));

export const rateLimitBuckets = mysqlTable("rate_limit_buckets", {
    ip: varchar("ip", { length: 45 }).notNull(),
    bucketType: varchar("bucket_type", { length: 20 }).notNull(),
    bucketStart: bigint("bucket_start", { mode: 'number' }).notNull(),
    count: int("count").default(1).notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.ip, table.bucketType, table.bucketStart] }),
}));

// US-P44 (Phase 4.4): Per-photo / per-topic / per-shared-group analytics views.
// Privacy: no full IPs stored — only country_code (2-char) derived from IP.
// referrer_host stores TLD+1 only (never full URL). bot flag records crawler views
// but they are excluded from public-facing counts.
export const imageViews = mysqlTable("image_views", {
    id: int("id").primaryKey().autoincrement(),
    imageId: int("image_id").references(() => images.id, { onDelete: 'cascade' }).notNull(),
    viewed_at: timestamp("viewed_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    referrer_host: varchar("referrer_host", { length: 128 }).notNull().default('direct'),
    country_code: varchar("country_code", { length: 2 }).notNull().default('XX'),
    bot: boolean("bot").notNull().default(false),
}, (table) => ({
    idxImageViewsImageIdViewedAt: index('idx_image_views_image_id_viewed_at').on(table.imageId, table.viewed_at),
}));

export const topicViews = mysqlTable("topic_views", {
    id: int("id").primaryKey().autoincrement(),
    topic: varchar("topic", { length: 255 }).references(() => topics.slug, { onDelete: 'cascade' }).notNull(),
    viewed_at: timestamp("viewed_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    referrer_host: varchar("referrer_host", { length: 128 }).notNull().default('direct'),
    country_code: varchar("country_code", { length: 2 }).notNull().default('XX'),
    bot: boolean("bot").notNull().default(false),
}, (table) => ({
    idxTopicViewsTopicViewedAt: index('idx_topic_views_topic_viewed_at').on(table.topic, table.viewed_at),
}));

export const sharedGroupViews = mysqlTable("shared_group_views", {
    id: int("id").primaryKey().autoincrement(),
    groupId: int("group_id").references(() => sharedGroups.id, { onDelete: 'cascade' }).notNull(),
    viewed_at: timestamp("viewed_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    referrer_host: varchar("referrer_host", { length: 128 }).notNull().default('direct'),
    country_code: varchar("country_code", { length: 2 }).notNull().default('XX'),
    bot: boolean("bot").notNull().default(false),
}, (table) => ({
    idxSharedGroupViewsGroupIdViewedAt: index('idx_shared_group_views_group_id_viewed_at').on(table.groupId, table.viewed_at),
}));

// US-P51 (Phase 5.1): CLIP semantic search — 512-dim float32 embeddings per image.
// embedding is stored as a MEDIUMBLOB (2048 bytes = 512 × 4-byte little-endian float32).
// The Drizzle column is typed as `text` for schema diffing; the actual SQL migration
// creates it as MEDIUMBLOB. The application layer converts Buffer ↔ Float32Array.
// model_version tags which encoder produced the embedding (stub: 'stub-sha256-v1').
// No PII: only image_id and the embedding vector are stored.
export const imageEmbeddings = mysqlTable("image_embeddings", {
    imageId: int("image_id").primaryKey().references(() => images.id, { onDelete: 'cascade' }),
    // Note: actual column is MEDIUMBLOB — see migration 0012. The `text` type here
    // is a Drizzle approximation; the lib layer wraps Buffer reads/writes.
    embedding: text("embedding").notNull(),
    modelVersion: varchar("model_version", { length: 32 }).notNull(),
    updatedAt: timestamp("updated_at")
        .default(sql`CURRENT_TIMESTAMP`)
        .onUpdateNow()
        .notNull(),
});

// US-P54 (Phase 5.4): Stripe paid-download entitlements.
// sessionId is UNIQUE so concurrent webhook retries are idempotent.
// downloadTokenHash holds sha256 hex of the single-use token; NULL after use.
// refunded tracks Stripe refunds (refunded entitlements block downloads).
export const entitlements = mysqlTable("entitlements", {
    id: int("id").primaryKey().autoincrement(),
    imageId: int("image_id").references(() => images.id, { onDelete: 'cascade' }).notNull(),
    tier: varchar("tier", { length: 16 }).notNull(),
    customerEmail: varchar("customer_email", { length: 255 }).notNull(),
    sessionId: varchar("session_id", { length: 255 }).notNull().unique(),
    amountTotalCents: int("amount_total_cents").notNull(),
    downloadTokenHash: varchar("download_token_hash", { length: 64 }),
    downloadedAt: timestamp("downloaded_at"),
    expiresAt: timestamp("expires_at").notNull(),
    refunded: boolean("refunded").notNull().default(false),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
    idxEntitlementsImageId: index('idx_entitlements_image_id').on(table.imageId),
    idxEntitlementsTokenHash: index('idx_entitlements_token_hash').on(table.downloadTokenHash),
}));

// US-P42 (Phase 4.2): Smart collections — admin-defined dynamic galleries
// driven by an EXIF/topic/tag predicate AST stored in `query_json`. The AST
// is compiled to safe parameterized SQL by `apps/web/src/lib/smart-collections.ts`
// (allowlisted columns, bounded depth, no raw concat). Public collections
// are reachable at `/[locale]/c/[slug]`; non-public collections require admin auth.
export const smartCollections = mysqlTable("smart_collections", {
    id: int("id").primaryKey().autoincrement(),
    slug: varchar("slug", { length: 255 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    query_json: text("query_json").notNull(),
    is_public: boolean("is_public").notNull().default(false),
    created_at: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
    idxSmartCollectionsPublic: index('idx_smart_collections_public').on(table.is_public),
}));
