import { mysqlTable, varchar, int, float, double, uniqueIndex, index, timestamp, datetime, boolean, text, bigint, primaryKey } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

export const topics = mysqlTable("topics", {
    slug: varchar("slug", { length: 255 }).primaryKey(),
    label: varchar("label", { length: 255 }).notNull(),
    order: int("order").default(0),
    image_filename: varchar("image_filename", { length: 255 }),
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
    white_balance: varchar('white_balance', { length: 50 }),
    metering_mode: varchar('metering_mode', { length: 50 }),
    exposure_compensation: varchar('exposure_compensation', { length: 20 }),
    exposure_program: varchar('exposure_program', { length: 50 }),
    flash: varchar('flash', { length: 50 }),
    bit_depth: int('bit_depth'),
    original_format: varchar('original_format', { length: 10 }),
    original_file_size: int('original_file_size'),
    blur_data_url: text('blur_data_url'),

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

export const rateLimitBuckets = mysqlTable("rate_limit_buckets", {
    ip: varchar("ip", { length: 45 }).notNull(),
    bucketType: varchar("bucket_type", { length: 20 }).notNull(),
    bucketStart: bigint("bucket_start", { mode: 'number' }).notNull(),
    count: int("count").default(1).notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.ip, table.bucketType, table.bucketStart] }),
}));
