/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const argon2 = require('argon2');
const mysql = require('mysql2/promise');
const { drizzle } = require('drizzle-orm/mysql2');
const { migrate } = require('drizzle-orm/mysql2/migrator');
const { getMysqlConnectionOptions } = require('./mysql-connection-options');

const WEAK_PLAINTEXT_PASSWORDS = new Set([
    'password',
    'admin',
    'changeme',
    'gallerykit',
    '12345678',
    '123456789',
    'qwerty123',
]);

// Keep the plain Node migration script aligned with src/lib/password-hashing.ts.
// This file runs outside the TS path-alias/transpile pipeline in the production
// container, so the policy is duplicated deliberately with this pointer.
const PASSWORD_HASH_OPTIONS = {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
};

function resolveAppRoot() {
    const candidates = [
        process.cwd(),
        path.join(process.cwd(), 'apps', 'web'),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(path.join(candidate, 'drizzle'))) {
            return candidate;
        }
    }

    throw new Error(`Unable to locate app root from ${process.cwd()}`);
}

function resolveUploadRoots(appRoot) {
    const publicRoot = path.join(appRoot, 'public', 'uploads');
    const privateOriginalRoot = process.env.UPLOAD_ORIGINAL_ROOT
        ? path.resolve(process.env.UPLOAD_ORIGINAL_ROOT)
        : path.join(appRoot, 'data', 'uploads', 'original');

    return {
        legacyOriginalRoot: path.join(publicRoot, 'original'),
        privateOriginalRoot,
    };
}

function hashFileSync(filepath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filepath)).digest('hex');
}

function areSameFileBytes(source, target) {
    const sourceStat = fs.statSync(source);
    const targetStat = fs.statSync(target);
    if (sourceStat.size !== targetStat.size) {
        return false;
    }
    return hashFileSync(source) === hashFileSync(target);
}

function migrateLegacyOriginalUploads(appRoot) {
    const { legacyOriginalRoot, privateOriginalRoot } = resolveUploadRoots(appRoot);
    if (legacyOriginalRoot === privateOriginalRoot || !fs.existsSync(legacyOriginalRoot)) {
        return;
    }

    fs.mkdirSync(privateOriginalRoot, { recursive: true, mode: 0o700 });
    try {
        fs.chmodSync(privateOriginalRoot, 0o700);
    } catch (error) {
        console.warn(`[Migration] Could not tighten private original directory mode for ${privateOriginalRoot}:`, error);
    }
    const entries = fs.readdirSync(legacyOriginalRoot, { withFileTypes: true });
    let moved = 0;

    for (const entry of entries) {
        if (!entry.isFile()) continue;

        const source = path.join(legacyOriginalRoot, entry.name);
        const target = path.join(privateOriginalRoot, entry.name);

        if (fs.existsSync(target)) {
            if (!areSameFileBytes(source, target)) {
                throw new Error(
                    `[Migration] Refusing to delete legacy original upload ${source} because ` +
                    `the private target ${target} already exists with different bytes. ` +
                    `Move one file aside manually, then restart.`
                );
            }
            fs.unlinkSync(source);
            continue;
        }

        try {
            fs.renameSync(source, target);
        } catch (error) {
            if (error && typeof error === 'object' && error.code === 'EXDEV') {
                fs.copyFileSync(source, target);
                if (!areSameFileBytes(source, target)) {
                    throw new Error(
                        `[Migration] Refusing to delete legacy original upload ${source} because ` +
                        `the copied private target ${target} does not match the source bytes.`
                    );
                }
                fs.unlinkSync(source);
            } else {
                throw error;
            }
        }
        try {
            fs.chmodSync(target, 0o600);
        } catch (error) {
            console.warn(`[Migration] Could not tighten migrated original file mode for ${target}:`, error);
        }
        moved++;
    }

    if (moved > 0) {
        console.log(`[Migration] Moved ${moved} legacy original upload(s) out of the public web root.`);
    }
}

function assertLegacyOriginalUploadsCleared(appRoot) {
    if (process.env.NODE_ENV !== 'production') {
        return;
    }

    const { legacyOriginalRoot } = resolveUploadRoots(appRoot);
    if (!fs.existsSync(legacyOriginalRoot)) {
        return;
    }

    const remainingFiles = fs.readdirSync(legacyOriginalRoot, { withFileTypes: true }).filter((entry) => entry.isFile());
    if (remainingFiles.length > 0) {
        throw new Error(`Refusing to start with ${remainingFiles.length} original upload(s) still under the public web root (${legacyOriginalRoot}).`);
    }
}

function getRequiredEnv(name) {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function assertStrongBootstrapPassword(secret) {
    if (secret.startsWith('$argon2')) return;

    const normalized = secret.trim();
    if (normalized.length < 16 || WEAK_PLAINTEXT_PASSWORDS.has(normalized.toLowerCase())) {
        throw new Error('ADMIN_PASSWORD plaintext must be a strong 16+ character secret or an Argon2 hash.');
    }
}

function formatError(error) {
    if (error instanceof Error) {
        return { name: error.name, message: error.message };
    }

    if (error && typeof error === 'object') {
        return Object.fromEntries(
            Object.entries(error).filter(([key]) => ['code', 'errno', 'sqlState', 'message'].includes(key))
        );
    }

    return { message: String(error) };
}

/**
 * C4-01 / DBG4-01 (run-10 c4): legacy migrations whose embedded DML is
 * mirrored by reconcileLegacySchema's own one-off backfill exception
 * (the shared_group_images.position re-sequencing UPDATE). ONLY entries in
 * this set may be baselined despite carrying DML — baselining records a hash
 * WITHOUT executing SQL, so un-mirrored DML would be silently dropped.
 * Do NOT add entries here unless reconcileLegacySchema gains an equivalent,
 * self-gated mirror of the migration's DML effect.
 */
const LEGACY_DML_MIRRORED_BY_RECONCILE = new Set(['0001_sync_current_schema']);

/**
 * Detect whether a migration's SQL carries DML (INSERT/UPDATE/DELETE/REPLACE).
 * Comments (`-- ...`) are stripped, then statements are split on drizzle's
 * `--> statement-breakpoint` marker and `;`. Purely lexical — good enough to
 * fail LOUD on the swallow class; false positives are acceptable (an operator
 * reviews and, if genuinely mirrored, extends the allowlist deliberately).
 */
function journalSqlContainsDml(sql) {
    const withoutComments = sql
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--') || line.includes('statement-breakpoint'))
        .join('\n');
    const statements = withoutComments
        .split(/-->\s*statement-breakpoint|;/)
        .map((s) => s.trim())
        .filter(Boolean);
    return statements.some((s) => /^(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(s));
}

function getAllJournalMigrations(migrationsFolder) {
    const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
        throw new Error(`No migration entries found in ${journalPath}`);
    }

    return journal.entries.map((entry) => {
        const migrationPath = path.join(migrationsFolder, `${entry.tag}.sql`);
        const migrationSql = fs.readFileSync(migrationPath, 'utf8');
        return {
            tag: entry.tag,
            folderMillis: entry.when,
            hash: crypto.createHash('sha256').update(migrationSql).digest('hex'),
            containsDml: journalSqlContainsDml(migrationSql),
        };
    });
}

async function queryOne(connection, sql, params) {
    const [rows] = await connection.query(sql, params);
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function columnInfo(connection, dbName, tableName, columnName) {
    return queryOne(
        connection,
        `SELECT DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, CHARACTER_MAXIMUM_LENGTH
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [dbName, tableName, columnName]
    );
}

async function indexExists(connection, dbName, tableName, indexName) {
    return Boolean(await queryOne(
        connection,
        `SELECT 1
         FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [dbName, tableName, indexName]
    ));
}

async function foreignKeyExists(connection, dbName, tableName, constraintName) {
    return Boolean(await queryOne(
        connection,
        `SELECT 1
         FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
         WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
        [dbName, tableName, constraintName]
    ));
}

async function ensureTable(connection, sql) {
    await connection.query(sql);
}

async function ensureColumn(connection, dbName, tableName, columnName, addSql) {
    const existing = await columnInfo(connection, dbName, tableName, columnName);
    if (!existing) {
        await connection.query(addSql);
        return true;
    }
    return false;
}

async function ensureColumnDefinition(connection, dbName, tableName, columnName, predicate, alterSql) {
    const existing = await columnInfo(connection, dbName, tableName, columnName);
    if (existing && !predicate(existing)) {
        await connection.query(alterSql);
        return true;
    }
    return false;
}

function isBooleanFalseDefault(info) {
    const defaultValue = String(info.COLUMN_DEFAULT ?? '').toLowerCase();
    return defaultValue === '0' || defaultValue === 'false' || defaultValue === "b'0'";
}

// Idempotent column drop. MySQL 8.0 has no DROP COLUMN IF EXISTS (MariaDB-only),
// so guard on INFORMATION_SCHEMA. Used by reconcileLegacySchema to converge a DB
// to the CURRENT schema even when a feature's column was removed — the migration
// .sql DROP never runs on an existing DB (it is baselined, not executed), so the
// drop MUST live here. Mirrors the ensureColumn ADD pattern in reverse.
async function dropColumnIfPresent(connection, dbName, tableName, columnName) {
    const existing = await columnInfo(connection, dbName, tableName, columnName);
    if (existing) {
        await connection.query(`ALTER TABLE \`${tableName}\` DROP COLUMN \`${columnName}\``);
        return true;
    }
    return false;
}

// Idempotent table drop (DROP TABLE IF EXISTS is valid MySQL 8.0, but keep a
// helper for symmetry + a single drop log site).
async function dropTableIfPresent(connection, tableName) {
    await connection.query(`DROP TABLE IF EXISTS \`${tableName}\``);
}

async function ensureIndex(connection, dbName, tableName, indexName, createSql) {
    if (!(await indexExists(connection, dbName, tableName, indexName))) {
        await connection.query(createSql);
        return true;
    }
    return false;
}

async function indexColumns(connection, dbName, tableName, indexName) {
    const [rows] = await connection.query(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
         ORDER BY SEQ_IN_INDEX`,
        [dbName, tableName, indexName]
    );
    return rows.map((row) => row.COLUMN_NAME);
}

// Existing legacy indexes can have the right name but an obsolete column
// shape. Converge both absence and shape drift; identifiers are passed through
// mysql2's identifier placeholders instead of string interpolation.
async function ensureIndexColumns(connection, dbName, tableName, indexName, expectedColumns, createSql) {
    const actualColumns = await indexColumns(connection, dbName, tableName, indexName);
    if (actualColumns.length === expectedColumns.length
        && actualColumns.every((column, index) => column === expectedColumns[index])) {
        return false;
    }
    if (actualColumns.length > 0) {
        await connection.query('DROP INDEX ?? ON ??', [indexName, tableName]);
    }
    await connection.query(createSql);
    return true;
}

async function ensureForeignKey(connection, dbName, tableName, constraintName, createSql) {
    if (!(await foreignKeyExists(connection, dbName, tableName, constraintName))) {
        await connection.query(createSql);
        return true;
    }
    return false;
}

async function ensureMigrationTable(connection) {
    await connection.query(`
        CREATE TABLE IF NOT EXISTS __drizzle_migrations (
            id serial PRIMARY KEY,
            hash text NOT NULL,
            created_at bigint
        )
    `);
}

async function hasAnyGalleryTables(connection, dbName) {
    return Boolean(await queryOne(
        connection,
        `SELECT 1
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('topics', 'images', 'admin_settings', 'shared_groups')
         LIMIT 1`,
        [dbName]
    ));
}

async function reconcileLegacySchema(connection, dbName) {
    console.log('[Migration] Reconciling legacy schema before baselining migrations...');

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS topics (
            slug varchar(255) NOT NULL,
            label varchar(255) NOT NULL,
            \`order\` int DEFAULT 0,
            image_filename varchar(255),
            PRIMARY KEY (slug)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS tags (
            id int NOT NULL AUTO_INCREMENT,
            name varchar(255) NOT NULL,
            slug varchar(255) NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY tags_name_unique (name),
            UNIQUE KEY tags_slug_unique (slug)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS admin_settings (
            \`key\` varchar(255) NOT NULL,
            value text NOT NULL,
            PRIMARY KEY (\`key\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS admin_users (
            id int NOT NULL AUTO_INCREMENT,
            username varchar(255) NOT NULL,
            password_hash varchar(512) NOT NULL,
            created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY admin_users_username_unique (username)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    const passwordHashInfo = await columnInfo(connection, dbName, 'admin_users', 'password_hash');
    if (passwordHashInfo && Number(passwordHashInfo.CHARACTER_MAXIMUM_LENGTH || 0) < 512) {
        await connection.query('ALTER TABLE admin_users MODIFY COLUMN password_hash varchar(512) NOT NULL');
    }
    await ensureColumn(connection, dbName, 'admin_users', 'updated_at', 'ALTER TABLE admin_users ADD COLUMN updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS images (
            id int NOT NULL AUTO_INCREMENT,
            filename_original varchar(255) NOT NULL,
            filename_avif varchar(255) NOT NULL,
            filename_webp varchar(255) NOT NULL,
            filename_jpeg varchar(255) NOT NULL,
            width int NOT NULL,
            height int NOT NULL,
            original_width int DEFAULT NULL,
            original_height int DEFAULT NULL,
            title varchar(255) DEFAULT NULL,
            description text,
            user_filename varchar(255) DEFAULT NULL,
            share_key varchar(255) DEFAULT NULL,
            topic varchar(255) NOT NULL,
            capture_date datetime DEFAULT NULL,
            capture_month tinyint unsigned GENERATED ALWAYS AS (MONTH(capture_date)) STORED,
            capture_day tinyint unsigned GENERATED ALWAYS AS (DAY(capture_date)) STORED,
            camera_model varchar(255) DEFAULT NULL,
            lens_model varchar(255) DEFAULT NULL,
            iso int DEFAULT NULL,
            f_number float DEFAULT NULL,
            exposure_time varchar(255) DEFAULT NULL,
            focal_length float DEFAULT NULL,
            latitude double DEFAULT NULL,
            longitude double DEFAULT NULL,
            color_space varchar(255) DEFAULT NULL,
            white_balance varchar(50) DEFAULT NULL,
            metering_mode varchar(50) DEFAULT NULL,
            exposure_compensation varchar(20) DEFAULT NULL,
            exposure_program varchar(50) DEFAULT NULL,
            flash varchar(50) DEFAULT NULL,
            bit_depth int DEFAULT NULL,
            original_format varchar(10) DEFAULT NULL,
            original_file_size bigint DEFAULT NULL,
            blur_data_url text,
            created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            processed boolean DEFAULT false,
            was_downscaled boolean NOT NULL DEFAULT false,
            derivative_max_width int DEFAULT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY images_share_key_unique (share_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ensureColumn(connection, dbName, 'images', 'user_filename', 'ALTER TABLE images ADD COLUMN user_filename varchar(255) DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'white_balance', 'ALTER TABLE images ADD COLUMN white_balance varchar(50) DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'metering_mode', 'ALTER TABLE images ADD COLUMN metering_mode varchar(50) DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'exposure_compensation', 'ALTER TABLE images ADD COLUMN exposure_compensation varchar(20) DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'exposure_program', 'ALTER TABLE images ADD COLUMN exposure_program varchar(50) DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'flash', 'ALTER TABLE images ADD COLUMN flash varchar(50) DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'bit_depth', 'ALTER TABLE images ADD COLUMN bit_depth int DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'original_format', 'ALTER TABLE images ADD COLUMN original_format varchar(10) DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'original_file_size', 'ALTER TABLE images ADD COLUMN original_file_size bigint DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'blur_data_url', 'ALTER TABLE images ADD COLUMN blur_data_url text');
    // license_tier (paid-downloads US-P54) removed in migration 0023. Not
    // reconciled here so a baselined legacy DB matches the post-0023 schema.
    await ensureColumn(connection, dbName, 'images', 'alt_text_suggested', 'ALTER TABLE images ADD COLUMN alt_text_suggested text');
    await ensureColumn(connection, dbName, 'images', 'icc_profile_name', 'ALTER TABLE images ADD COLUMN icc_profile_name varchar(255) DEFAULT NULL');
    // R4C1 COR-R4C1-13: the color/HDR era columns (migrations 0015-0018)
    // were never mirrored here, violating the runbook's "update
    // reconcileLegacySchema for every new migration" contract. Production
    // survived because its schema was repaired manually during the original
    // drift incident, but every database that bootstraps through this
    // reconcile path (fresh installs via COR-R4C1-12, legacy re-baselines)
    // came out missing all seven columns and the very first INSERT into
    // `images` failed with ER_BAD_FIELD_ERROR. DDL mirrors the migration
    // files (0015_color_pipeline_decision, 0016_cicp_columns,
    // 0017_pipeline_version, 0018_has_gain_map) minus the cosmetic AFTER
    // clauses, matching the established style of this function.
    await ensureColumn(connection, dbName, 'images', 'color_pipeline_decision', 'ALTER TABLE images ADD COLUMN color_pipeline_decision varchar(64) DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'color_primaries', 'ALTER TABLE images ADD COLUMN color_primaries varchar(32) DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'transfer_function', 'ALTER TABLE images ADD COLUMN transfer_function varchar(16) DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'matrix_coefficients', 'ALTER TABLE images ADD COLUMN matrix_coefficients varchar(16) DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'is_hdr', 'ALTER TABLE images ADD COLUMN is_hdr boolean NOT NULL DEFAULT FALSE');
    await ensureColumn(connection, dbName, 'images', 'has_gain_map', 'ALTER TABLE images ADD COLUMN has_gain_map boolean NOT NULL DEFAULT FALSE');
    await ensureColumn(connection, dbName, 'images', 'pipeline_version', 'ALTER TABLE images ADD COLUMN pipeline_version int DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'was_downscaled', 'ALTER TABLE images ADD COLUMN was_downscaled boolean NOT NULL DEFAULT false');
    await ensureColumn(connection, dbName, 'images', 'derivative_max_width', 'ALTER TABLE images ADD COLUMN derivative_max_width int DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'capture_month', 'ALTER TABLE images ADD COLUMN capture_month tinyint unsigned GENERATED ALWAYS AS (MONTH(capture_date)) STORED AFTER capture_date');
    await ensureColumn(connection, dbName, 'images', 'capture_day', 'ALTER TABLE images ADD COLUMN capture_day tinyint unsigned GENERATED ALWAYS AS (DAY(capture_date)) STORED AFTER capture_month');
    // R17-L2: admin user that performed the upload (admin-only PII).
    // Nullable so legacy rows keep working; ON DELETE SET NULL keeps the
    // photo when the admin is removed but drops the authorship link.
    await ensureColumn(connection, dbName, 'images', 'uploaded_by', 'ALTER TABLE images ADD COLUMN uploaded_by int DEFAULT NULL');
    // R10-H2: processing error diagnostics for admin retry visibility.
    await ensureColumn(connection, dbName, 'images', 'processing_error', 'ALTER TABLE images ADD COLUMN processing_error varchar(512) DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'failed_at', 'ALTER TABLE images ADD COLUMN failed_at datetime DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'processing_settings_json', 'ALTER TABLE images ADD COLUMN processing_settings_json text DEFAULT NULL');
    // R10-M4: delivered AVIF bit depth (10-bit vs 8-bit). Public-safe.
    await ensureColumn(connection, dbName, 'images', 'avif_10bit', 'ALTER TABLE images ADD COLUMN avif_10bit boolean DEFAULT NULL');
    await ensureColumn(connection, dbName, 'topics', 'map_visible', 'ALTER TABLE topics ADD COLUMN map_visible boolean NOT NULL DEFAULT false');

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS pending_file_deletions (
            id int NOT NULL AUTO_INCREMENT,
            image_id int DEFAULT NULL,
            filename_original varchar(255) NOT NULL,
            filename_webp varchar(255) NOT NULL,
            filename_avif varchar(255) NOT NULL,
            filename_jpeg varchar(255) NOT NULL,
            attempts int NOT NULL DEFAULT 0,
            last_error text,
            created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            INDEX idx_pending_file_deletions_image_id (image_id),
            INDEX idx_pending_file_deletions_updated_at (updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ensureColumnDefinition(
        connection,
        dbName,
        'images',
        'processed',
        (info) => isBooleanFalseDefault(info),
        'ALTER TABLE images MODIFY COLUMN processed boolean DEFAULT false'
    );

    const captureDateInfo = await columnInfo(connection, dbName, 'images', 'capture_date');
    if (captureDateInfo && captureDateInfo.DATA_TYPE !== 'datetime') {
        await connection.query('ALTER TABLE images MODIFY COLUMN capture_date datetime DEFAULT NULL');
    }

    const latitudeInfo = await columnInfo(connection, dbName, 'images', 'latitude');
    if (latitudeInfo && latitudeInfo.DATA_TYPE !== 'double') {
        await connection.query('ALTER TABLE images MODIFY COLUMN latitude double DEFAULT NULL');
    }

    const longitudeInfo = await columnInfo(connection, dbName, 'images', 'longitude');
    if (longitudeInfo && longitudeInfo.DATA_TYPE !== 'double') {
        await connection.query('ALTER TABLE images MODIFY COLUMN longitude double DEFAULT NULL');
    }

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS shared_groups (
            id int NOT NULL AUTO_INCREMENT,
            \`key\` varchar(255) NOT NULL,
            view_count int NOT NULL DEFAULT 0,
            expires_at datetime DEFAULT NULL,
            created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY shared_groups_key_unique (\`key\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await ensureColumn(connection, dbName, 'shared_groups', 'view_count', 'ALTER TABLE shared_groups ADD COLUMN view_count int NOT NULL DEFAULT 0');
    await ensureColumn(connection, dbName, 'shared_groups', 'expires_at', 'ALTER TABLE shared_groups ADD COLUMN expires_at datetime DEFAULT NULL');

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS topic_aliases (
            alias varchar(255) NOT NULL,
            topic_slug varchar(255) NOT NULL,
            PRIMARY KEY (alias)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS sessions (
            id varchar(255) NOT NULL,
            user_id int NOT NULL,
            expires_at timestamp NOT NULL,
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS audit_log (
            id int NOT NULL AUTO_INCREMENT,
            user_id int DEFAULT NULL,
            action varchar(64) NOT NULL,
            target_type varchar(64) DEFAULT NULL,
            target_id varchar(128) DEFAULT NULL,
            ip varchar(45) DEFAULT NULL,
            metadata text,
            created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS rate_limit_buckets (
            ip varchar(45) NOT NULL,
            bucket_type varchar(20) NOT NULL,
            bucket_start bigint NOT NULL,
            count int NOT NULL DEFAULT 1,
            PRIMARY KEY (ip, bucket_type, bucket_start)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS image_tags (
            image_id int NOT NULL,
            tag_id int NOT NULL,
            UNIQUE KEY image_tags_image_id_tag_id_unique (image_id, tag_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS shared_group_images (
            group_id int NOT NULL,
            image_id int NOT NULL,
            position int NOT NULL DEFAULT 0,
            UNIQUE KEY shared_group_images_group_id_image_id_unique (group_id, image_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    const addedPosition = await ensureColumn(connection, dbName, 'shared_group_images', 'position', 'ALTER TABLE shared_group_images ADD COLUMN position int NOT NULL DEFAULT 0');
    if (addedPosition) {
        await connection.query(`
            UPDATE shared_group_images AS sgi
            JOIN (
                SELECT group_id, image_id, ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY image_id) - 1 AS computed_position
                FROM shared_group_images
            ) AS ordered
              ON ordered.group_id = sgi.group_id AND ordered.image_id = sgi.image_id
            SET sgi.position = ordered.computed_position
            WHERE sgi.position = 0
        `);
    }

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS admin_tokens (
            id int AUTO_INCREMENT PRIMARY KEY,
            user_id int NOT NULL,
            label varchar(255) NOT NULL,
            token_hash varchar(64) NOT NULL,
            scopes text,
            created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_used_at timestamp NULL,
            expires_at timestamp NULL,
            CONSTRAINT admin_tokens_user_fk FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE,
            INDEX admin_tokens_token_hash_idx (token_hash),
            INDEX admin_tokens_user_idx (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS smart_collections (
            id int AUTO_INCREMENT PRIMARY KEY,
            slug varchar(255) NOT NULL,
            name varchar(255) NOT NULL,
            query_json text NOT NULL,
            is_public boolean NOT NULL DEFAULT false,
            created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT smart_collections_slug_unique UNIQUE (slug),
            INDEX idx_smart_collections_public (is_public)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS image_views (
            id int NOT NULL AUTO_INCREMENT,
            image_id int NOT NULL,
            viewed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            referrer_host varchar(128) NOT NULL DEFAULT 'direct',
            country_code varchar(2) NOT NULL DEFAULT 'XX',
            bot boolean NOT NULL DEFAULT false,
            PRIMARY KEY (id),
            CONSTRAINT image_views_image_id_images_id_fk FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
            INDEX idx_image_views_image_id_viewed_at (image_id, viewed_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // PERF-R5C1-02: analytics breakdown indexes (migration 0021).
    await ensureIndex(connection, dbName, 'image_views', 'idx_image_views_bot_viewed_country',
        'CREATE INDEX idx_image_views_bot_viewed_country ON image_views (bot, viewed_at, country_code)');
    await ensureIndex(connection, dbName, 'image_views', 'idx_image_views_bot_viewed_referrer',
        'CREATE INDEX idx_image_views_bot_viewed_referrer ON image_views (bot, viewed_at, referrer_host)');
    await ensureIndex(connection, dbName, 'image_views', 'idx_image_views_bot_viewed_image',
        'CREATE INDEX idx_image_views_bot_viewed_image ON image_views (bot, viewed_at, image_id)');
    await ensureIndex(connection, dbName, 'image_views', 'idx_image_views_viewed_at_id',
        'CREATE INDEX idx_image_views_viewed_at_id ON image_views (viewed_at, id)');

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS topic_views (
            id int NOT NULL AUTO_INCREMENT,
            topic varchar(255) NOT NULL,
            viewed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            referrer_host varchar(128) NOT NULL DEFAULT 'direct',
            country_code varchar(2) NOT NULL DEFAULT 'XX',
            bot boolean NOT NULL DEFAULT false,
            PRIMARY KEY (id),
            CONSTRAINT topic_views_topic_topics_slug_fk FOREIGN KEY (topic) REFERENCES topics(slug) ON DELETE CASCADE,
            INDEX idx_topic_views_topic_viewed_at (topic, viewed_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await ensureIndex(connection, dbName, 'topic_views', 'idx_topic_views_bot_viewed_topic',
        'CREATE INDEX idx_topic_views_bot_viewed_topic ON topic_views (bot, viewed_at, topic)');
    await ensureIndex(connection, dbName, 'topic_views', 'idx_topic_views_viewed_at_id',
        'CREATE INDEX idx_topic_views_viewed_at_id ON topic_views (viewed_at, id)');

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS shared_group_views (
            id int NOT NULL AUTO_INCREMENT,
            group_id int NOT NULL,
            viewed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
            referrer_host varchar(128) NOT NULL DEFAULT 'direct',
            country_code varchar(2) NOT NULL DEFAULT 'XX',
            bot boolean NOT NULL DEFAULT false,
            PRIMARY KEY (id),
            CONSTRAINT shared_group_views_group_id_shared_groups_id_fk FOREIGN KEY (group_id) REFERENCES shared_groups(id) ON DELETE CASCADE,
            INDEX idx_shared_group_views_group_id_viewed_at (group_id, viewed_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await ensureIndex(connection, dbName, 'shared_group_views', 'idx_shared_group_views_bot_viewed_group',
        'CREATE INDEX idx_shared_group_views_bot_viewed_group ON shared_group_views (bot, viewed_at, group_id)');
    await ensureIndex(connection, dbName, 'shared_group_views', 'idx_shared_group_views_viewed_at_id',
        'CREATE INDEX idx_shared_group_views_viewed_at_id ON shared_group_views (viewed_at, id)');

    await ensureTable(connection, `
        CREATE TABLE IF NOT EXISTS image_embeddings (
            image_id int NOT NULL,
            embedding mediumblob NOT NULL,
            model_version varchar(32) NOT NULL,
            updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (image_id),
            CONSTRAINT image_embeddings_image_id_fk FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    // AGG-C8-03 / migration 0022: composite index for the live semantic + similar
    // search scans (`WHERE model_version = ? ORDER BY updated_at DESC LIMIT 5000`).
    await ensureIndex(connection, dbName, 'image_embeddings', 'idx_image_embeddings_model_version_updated',
        'CREATE INDEX idx_image_embeddings_model_version_updated ON image_embeddings (model_version, updated_at)');

    // entitlements (paid-downloads US-P54) removed in migration 0023. Not
    // reconciled here so a baselined legacy DB matches the post-0023 schema.

    await ensureIndex(connection, dbName, 'image_tags', 'idx_image_tags_tag_id', 'CREATE INDEX idx_image_tags_tag_id ON image_tags (tag_id)');
    await ensureIndexColumns(connection, dbName, 'images', 'idx_images_processed_capture_date',
        ['processed', 'capture_date', 'created_at', 'id'],
        'CREATE INDEX idx_images_processed_capture_date ON images (processed, capture_date, created_at, id)');
    await ensureIndexColumns(connection, dbName, 'images', 'idx_images_processed_capture_month_day',
        ['processed', 'capture_month', 'capture_day', 'capture_date', 'created_at', 'id'],
        'CREATE INDEX idx_images_processed_capture_month_day ON images (processed, capture_month, capture_day, capture_date, created_at, id)');
    await ensureIndex(connection, dbName, 'images', 'idx_images_processed_created_at', 'CREATE INDEX idx_images_processed_created_at ON images (processed, created_at)');
    await ensureIndex(connection, dbName, 'images', 'idx_images_processed_updated_at', 'CREATE INDEX idx_images_processed_updated_at ON images (processed, updated_at, created_at, id)');
    await ensureIndex(connection, dbName, 'images', 'idx_images_processed_pipeline_version', 'CREATE INDEX idx_images_processed_pipeline_version ON images (processed, pipeline_version, id)');
    await ensureIndexColumns(connection, dbName, 'images', 'idx_images_topic',
        ['topic', 'processed', 'capture_date', 'created_at', 'id'],
        'CREATE INDEX idx_images_topic ON images (topic, processed, capture_date, created_at, id)');
    await ensureIndex(connection, dbName, 'images', 'idx_images_topic_updated_at', 'CREATE INDEX idx_images_topic_updated_at ON images (topic, processed, updated_at, created_at, id)');
    await ensureIndex(connection, dbName, 'images', 'idx_images_user_filename', 'CREATE INDEX idx_images_user_filename ON images (user_filename)');
    await ensureIndex(connection, dbName, 'images', 'idx_images_uploaded_by', 'CREATE INDEX idx_images_uploaded_by ON images (uploaded_by)');
    await ensureIndex(connection, dbName, 'audit_log', 'audit_user_idx', 'CREATE INDEX audit_user_idx ON audit_log (user_id, created_at)');
    await ensureIndex(connection, dbName, 'audit_log', 'audit_action_idx', 'CREATE INDEX audit_action_idx ON audit_log (action, created_at)');
    await ensureIndex(connection, dbName, 'audit_log', 'audit_created_at_idx', 'CREATE INDEX audit_created_at_idx ON audit_log (created_at)');
    await ensureIndex(connection, dbName, 'sessions', 'idx_sessions_expires_at', 'CREATE INDEX idx_sessions_expires_at ON sessions (expires_at)');
    await ensureIndex(connection, dbName, 'shared_group_images', 'idx_shared_group_images_group_position', 'CREATE INDEX idx_shared_group_images_group_position ON shared_group_images (group_id, position)');
    await ensureIndex(connection, dbName, 'rate_limit_buckets', 'idx_rate_limit_buckets_bucket_start', 'CREATE INDEX idx_rate_limit_buckets_bucket_start ON rate_limit_buckets (bucket_start)');

    await ensureForeignKey(connection, dbName, 'images', 'images_topic_topics_slug_fk', 'ALTER TABLE images ADD CONSTRAINT images_topic_topics_slug_fk FOREIGN KEY (topic) REFERENCES topics(slug) ON DELETE RESTRICT');
    await ensureForeignKey(connection, dbName, 'image_tags', 'image_tags_image_id_images_id_fk', 'ALTER TABLE image_tags ADD CONSTRAINT image_tags_image_id_images_id_fk FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE');
    await ensureForeignKey(connection, dbName, 'image_tags', 'image_tags_tag_id_tags_id_fk', 'ALTER TABLE image_tags ADD CONSTRAINT image_tags_tag_id_tags_id_fk FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE');
    await ensureForeignKey(connection, dbName, 'shared_group_images', 'shared_group_images_group_id_shared_groups_id_fk', 'ALTER TABLE shared_group_images ADD CONSTRAINT shared_group_images_group_id_shared_groups_id_fk FOREIGN KEY (group_id) REFERENCES shared_groups(id) ON DELETE CASCADE');
    await ensureForeignKey(connection, dbName, 'shared_group_images', 'shared_group_images_image_id_images_id_fk', 'ALTER TABLE shared_group_images ADD CONSTRAINT shared_group_images_image_id_images_id_fk FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE');
    await ensureForeignKey(connection, dbName, 'topic_aliases', 'topic_aliases_topic_slug_topics_slug_fk', 'ALTER TABLE topic_aliases ADD CONSTRAINT topic_aliases_topic_slug_topics_slug_fk FOREIGN KEY (topic_slug) REFERENCES topics(slug) ON DELETE CASCADE');
    await ensureForeignKey(connection, dbName, 'sessions', 'sessions_user_id_admin_users_id_fk', 'ALTER TABLE sessions ADD CONSTRAINT sessions_user_id_admin_users_id_fk FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE');
    await ensureForeignKey(connection, dbName, 'audit_log', 'audit_log_user_id_admin_users_id_fk', 'ALTER TABLE audit_log ADD CONSTRAINT audit_log_user_id_admin_users_id_fk FOREIGN KEY (user_id) REFERENCES admin_users(id)');
    await ensureForeignKey(connection, dbName, 'admin_tokens', 'admin_tokens_user_fk', 'ALTER TABLE admin_tokens ADD CONSTRAINT admin_tokens_user_fk FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE');
    await ensureForeignKey(connection, dbName, 'images', 'images_uploaded_by_admin_users_id_fk', 'ALTER TABLE images ADD CONSTRAINT images_uploaded_by_admin_users_id_fk FOREIGN KEY (uploaded_by) REFERENCES admin_users(id) ON DELETE SET NULL');
    await ensureForeignKey(connection, dbName, 'image_views', 'image_views_image_id_images_id_fk', 'ALTER TABLE image_views ADD CONSTRAINT image_views_image_id_images_id_fk FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE');
    await ensureForeignKey(connection, dbName, 'topic_views', 'topic_views_topic_topics_slug_fk', 'ALTER TABLE topic_views ADD CONSTRAINT topic_views_topic_topics_slug_fk FOREIGN KEY (topic) REFERENCES topics(slug) ON DELETE CASCADE');
    await ensureForeignKey(connection, dbName, 'shared_group_views', 'shared_group_views_group_id_shared_groups_id_fk', 'ALTER TABLE shared_group_views ADD CONSTRAINT shared_group_views_group_id_shared_groups_id_fk FOREIGN KEY (group_id) REFERENCES shared_groups(id) ON DELETE CASCADE');
    await ensureForeignKey(connection, dbName, 'image_embeddings', 'image_embeddings_image_id_fk', 'ALTER TABLE image_embeddings ADD CONSTRAINT image_embeddings_image_id_fk FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE');

    // ── Removals (drop dead feature schema) ───────────────────────────────────
    // These run LAST so reconcile converges to the CURRENT schema. The .sql
    // migration's DROP statements never execute on an existing DB (they are
    // baselined, not run), so the authoritative drop for already-provisioned
    // databases lives here. Idempotent: no-ops once the objects are gone.
    // migration 0023: drop Stripe paid-downloads US-P54.
    // DROP TABLE entitlements also removes its FK to images(id).
    await dropTableIfPresent(connection, 'entitlements');
    await dropColumnIfPresent(connection, dbName, 'images', 'license_tier');
    // R15C15 Critic-F1 / R16C16 C16-F1: reactions (created by
    // 0007_image_reactions.sql, idx 7) were removed. reconcile is the sole
    // APPLIER of the drop (the .sql DROP is baselined-not-run). On an
    // already-baselined DB this reconcile only re-runs because the journaled
    // 0024_drop_reactions entry flips journalCovered === false; that entry is the
    // trigger, this is the executable drop. Mirror the entitlements removal so a
    // legacy-migrated DB that ran 0007 actually drops the dead image_reactions
    // table + images.reaction_count column. Idempotent.
    await dropTableIfPresent(connection, 'image_reactions');
    await dropColumnIfPresent(connection, dbName, 'images', 'reaction_count');
}

async function getRecordedHashes(connection) {
    const [rows] = await connection.query('SELECT hash FROM __drizzle_migrations');
    return new Set(rows.map((r) => r.hash));
}

/**
 * Insert one __drizzle_migrations row per journal entry that isn't already
 * recorded. Each row carries the migration's specific hash + its journal
 * `when` timestamp so drizzle's MAX(created_at) cursor lands on the
 * highest journal `when`, not on a synthetic max-of-all baseline.
 *
 * Drizzle's MySQL migrator (node_modules/drizzle-orm/mysql-core/dialect.cjs)
 * decides whether to apply each migration by:
 *
 *     if (lastDbMigration.created_at < migration.folderMillis) apply
 *
 * The journal in this repo has non-monotonic `when` timestamps (idx 6 lands
 * in 2026-05 while idx 7-17 land in 2025-05). The previous baseline strategy
 * inserted a single row with `Math.max(...whens)` — that row's created_at
 * ended up greater than every entry 7-17's folderMillis, so drizzle silently
 * skipped them on every deploy.
 *
 * Per-entry baselining keeps the table's MAX(created_at) cursor stable: each
 * baselined row's created_at equals its journal `when` (never a synthetic
 * max), so the cursor drizzle snapshots once per run is not raised past any
 * genuinely-pending entry. NOTE (C4-41, verified against the installed
 * drizzle-orm source): drizzle's migrator performs NO per-entry hash check —
 * correctness rests entirely on that MAX(created_at) cursor plus this
 * script's own post-condition in runMigrations(). New migrations (added later
 * with a strictly-greater `when`) pass the cursor check and apply normally.
 */
async function baselineAllJournalMigrations(connection, migrations, options = {}) {
    const haveHashes = await getRecordedHashes(connection);
    const inserts = migrations.filter((m) => !haveHashes.has(m.hash));
    if (inserts.length === 0) {
        return 0;
    }

    // C3-01 belt-and-braces (run-10 c3): baselining records a hash WITHOUT
    // executing its SQL, so it must never be applied to an entry sitting
    // above the caller's recorded cursor — those are pending migrations whose
    // SQL (including DML) drizzle.migrate() must genuinely run. A caller that
    // knows its cursor passes it here so a future refactor cannot silently
    // reintroduce the batch-swallow this guard exists to prevent.
    if (options.maxFolderMillis !== undefined && options.maxFolderMillis !== null) {
        const aboveCursor = inserts.filter(
            (m) => Number(m.folderMillis) > Number(options.maxFolderMillis)
        );
        if (aboveCursor.length > 0) {
            throw new Error(
                `[Migration] Refusing to baseline ${aboveCursor.length} migration(s) above the recorded cursor ` +
                `(their SQL has not executed): ${aboveCursor.map((m) => m.tag).join(', ')}. ` +
                `Baselining them would silently drop their SQL; they must be left for drizzle.migrate() to apply.`
            );
        }
    }

    // C4-01 / DBG4-01 (run-10 c4): the cursor guard above is skipped when the
    // caller has no cursor (fresh bootstrap, or an EMPTY-but-existing
    // __drizzle_migrations table on a gallery-bearing DB) — exactly the branch
    // through which a brand-new DML-bearing migration could still be baselined
    // without its SQL ever running. reconcileLegacySchema mirrors DDL (plus the
    // one allowlisted position backfill), never arbitrary DML, so refuse to
    // baseline any DML-bearing entry outside the explicit allowlist on EVERY
    // path. A loud failure here means: extend reconcileLegacySchema with a
    // self-gated mirror of the DML and add the tag to
    // LEGACY_DML_MIRRORED_BY_RECONCILE deliberately — or resolve the drift so
    // the entry rides the drizzle-apply path.
    const dmlBearing = inserts.filter(
        (m) => m.containsDml && !LEGACY_DML_MIRRORED_BY_RECONCILE.has(m.tag)
    );
    if (dmlBearing.length > 0) {
        throw new Error(
            `[Migration] Refusing to baseline ${dmlBearing.length} DML-bearing migration(s) whose SQL has not executed: ` +
            `${dmlBearing.map((m) => m.tag).join(', ')}. Baselining records the hash WITHOUT running the SQL, and ` +
            `reconcileLegacySchema does not mirror DML. Either let drizzle.migrate() apply these entries, or mirror ` +
            `their DML in reconcileLegacySchema and add the tag to LEGACY_DML_MIRRORED_BY_RECONCILE.`
        );
    }

    for (const m of inserts) {
        await connection.query(
            'INSERT INTO __drizzle_migrations (`hash`, `created_at`) VALUES (?, ?)',
            [m.hash, m.folderMillis]
        );
    }
    console.log(`[Migration] Baseline inserted ${inserts.length} migration row(s) for already-reconciled schema.`);
    return inserts.length;
}

async function ensureHistoricalPendingMigrationPrerequisites(connection, dbName, missing) {
    if (!missing.some((m) => m.tag === '0025_processing_settings_snapshot')) return;

    // C9-HIGH-01: historical migration 0025 adds processing_settings_json
    // `AFTER failed_at`, but processing_error/failed_at originally existed
    // only in reconcileLegacySchema. A healthy DB at the 0024 cursor takes the
    // pending-tail path below, so reconcile intentionally does not run before
    // drizzle applies 0025. Create the two prerequisite columns idempotently so
    // the historical migration can apply instead of failing on a missing
    // failed_at column. Do not baseline 0025 here; drizzle must still run it
    // and record its original hash.
    await ensureColumn(connection, dbName, 'images', 'processing_error', 'ALTER TABLE images ADD COLUMN processing_error varchar(512) DEFAULT NULL');
    await ensureColumn(connection, dbName, 'images', 'failed_at', 'ALTER TABLE images ADD COLUMN failed_at datetime DEFAULT NULL');
}

async function prepareLegacyDatabaseIfNeeded(connection, dbName, migrations) {
    await ensureMigrationTable(connection);
    const hasGalleryTables = await hasAnyGalleryTables(connection, dbName);
    if (!hasGalleryTables) {
        // R4C1 COR-R4C1-12: a COMPLETELY FRESH database used to fall through
        // to drizzle.migrate(), whose MAX(created_at) cursor + this repo's
        // non-monotonic journal `when` values silently skip entries 7-17 on
        // the very first run; the bootstrap then dies on a later entry's SQL
        // (and the runMigrations post-condition would fail the run anyway).
        // A SECOND `init` accidentally healed because the partial first run
        // left gallery tables behind, flipping execution onto the legacy
        // reconcile path below. That made every fresh install / e2e cold
        // database fail its first `npm run init`. Bootstrap fresh databases
        // through the SAME deterministic reconcile + per-entry baseline path
        // instead: reconcileLegacySchema is the maintained idempotent
        // full-schema bootstrap (CLAUDE.md migration step 3 requires every
        // new migration to mirror its state), and after baselining every
        // journal hash drizzle.migrate() is a verified no-op.
        await reconcileLegacySchema(connection, dbName);
        await baselineAllJournalMigrations(connection, migrations);
        return;
    }

    const haveHashes = await getRecordedHashes(connection);
    const journalCovered = migrations.every((m) => haveHashes.has(m.hash));
    if (journalCovered) {
        // Every committed migration is already in __drizzle_migrations.
        // No legacy-schema reconcile needed; drizzle.migrate() will be a no-op.
        return;
    }

    // FDR-01 (run-10 c2): distinguish PENDING NEW MIGRATIONS from LEGACY
    // DRIFT. The previous control flow treated any missing hash on a
    // gallery-bearing DB as drift and ran reconcile + baseline-all — which
    // recorded a genuinely NEW migration's hash BEFORE drizzle.migrate() ran,
    // so the committed .sql (including any DML backfill, which
    // reconcileLegacySchema does NOT mirror) never executed on any deployed
    // database, and the runMigrations post-condition was structurally
    // unreachable. When every missing entry sits strictly ABOVE the recorded
    // MAX(created_at) cursor, this is the normal "new migrations pending"
    // case: leave them unrecorded so drizzle.migrate() genuinely applies
    // them (their SQL runs; drizzle records the hash rows itself), and the
    // post-condition regains its meaning.
    const [cursorRows] = await connection.query(
        'SELECT MAX(created_at) AS migration_cursor FROM __drizzle_migrations'
    );
    const cursor = cursorRows?.[0]?.migration_cursor ?? null;
    const missing = migrations.filter((m) => !haveHashes.has(m.hash));
    if (cursor !== null && missing.every((m) => Number(m.folderMillis) > Number(cursor))) {
        await ensureHistoricalPendingMigrationPrerequisites(connection, dbName, missing);
        const tags = missing.map((m) => m.tag).join(', ');
        console.log(`[Migration] ${missing.length} pending migration(s) above the recorded cursor will be applied by drizzle: ${tags}`);
        return;
    }

    // The DB carries gallery tables but the migration log is incomplete at or
    // below the recorded cursor (or the log is empty / the legacy single-row
    // baseline poisoned the cursor). Reconcile the schema we know about
    // idempotently, then baseline ONLY the true-drift entries (at/below the
    // cursor) whose schema state the reconcile just converged.
    //
    // C3-01 (run-10 c3, closes the FDR-01 residual): the previous mixed-case
    // behavior baselined EVERY missing entry — including genuinely-new pending
    // migrations above the cursor — so their SQL (including DML, which
    // reconcileLegacySchema never mirrors) silently never executed, and the
    // runMigrations post-condition could not catch it (the hash was present).
    // One misdated sibling in a batch swallowed the whole batch. Now the
    // above-cursor tail is left UN-baselined so drizzle.migrate() genuinely
    // applies it. Trade-off, documented in the CLAUDE.md runbook: because
    // reconcileLegacySchema mirrors the CURRENT full schema (including the
    // tail's DDL, per migration-authoring step 3), drizzle applying the tail
    // can fail loudly on duplicate DDL in this mixed state — a loud deploy
    // failure the operator resolves by hand is strictly better than silently
    // dropping committed migration SQL. DML-only or non-mirrored tails apply
    // cleanly and heal the deploy end-to-end.
    const trueDrift = cursor === null
        ? missing
        : missing.filter((m) => Number(m.folderMillis) <= Number(cursor));
    const pendingTail = missing.filter((m) => !trueDrift.includes(m));
    if (pendingTail.length > 0) {
        console.warn(
            `[Migration] NOTE: drift repair found ${pendingTail.length} pending migration(s) above the recorded cursor: ` +
            `${pendingTail.map((m) => m.tag).join(', ')}. They are NOT being baselined — drizzle will apply their SQL. ` +
            `If reconcileLegacySchema already mirrors their DDL, the apply step will fail loudly (duplicate DDL); ` +
            `resolve the drift, then baseline those entries manually per the CLAUDE.md runbook.`
        );
    }
    await reconcileLegacySchema(connection, dbName);
    await baselineAllJournalMigrations(connection, trueDrift, { maxFolderMillis: cursor });
}

async function runMigrations(connection, migrationsFolder, expectedMigrations, migrateFn = migrate) {
    const db = drizzle(connection);
    console.log(`[Migration] Applying committed migrations from ${migrationsFolder}`);
    // C4-47 note: a rejection here (e.g. duplicate DDL when drizzle applies an
    // un-baselined pending tail that reconcileLegacySchema already mirrored)
    // must propagate — main()'s catch sets process.exitCode = 1 so the deploy
    // fails loudly instead of booting on an ambiguous schema state.
    await migrateFn(db, { migrationsFolder });

    // Post-condition: every journal entry must have a corresponding hash row in
    // __drizzle_migrations. Drizzle's MySQL migrator uses MAX(created_at) as a
    // cursor, so a non-monotonic journal can silently leave migrations un-applied
    // (and un-recorded). Surface that here so a deploy fails loudly rather than
    // booting on a half-applied schema.
    const recordedHashes = await getRecordedHashes(connection);
    const missing = expectedMigrations.filter((m) => !recordedHashes.has(m.hash));
    if (missing.length > 0) {
        const tags = missing.map((m) => m.tag).join(', ');
        throw new Error(
            `[Migration] Drizzle silently skipped ${missing.length} migration(s): ${tags}. ` +
            `This usually means the journal "when" timestamps are non-monotonic, or the ` +
            `__drizzle_migrations table has a poisoned baseline row. Apply the missing ` +
            `migrations manually or insert baseline hash rows.`
        );
    }
}

async function seedAdmin(connection) {
    console.log('[Migration] Checking admin user...');
    const [rows] = await connection.query('SELECT id FROM admin_users WHERE username = ?', ['admin']);

    if (rows.length > 0) {
        console.log('[Migration] Admin user already exists.');
        return;
    }

    let password = process.env.ADMIN_PASSWORD;
    if (!password) {
        throw new Error('ADMIN_PASSWORD must be set explicitly before running migrations.');
    }
    const hash = password.startsWith('$argon2')
        ? password
        : await (async () => {
            assertStrongBootstrapPassword(password);
            return argon2.hash(password, PASSWORD_HASH_OPTIONS);
        })();
    await connection.query('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)', ['admin', hash]);
    console.log('[Migration] Admin user created.');
}

async function main() {
    const appRoot = resolveAppRoot();
    migrateLegacyOriginalUploads(appRoot);
    assertLegacyOriginalUploadsCleared(appRoot);
    const migrationsFolder = path.join(appRoot, 'drizzle');
    const dbName = getRequiredEnv('DB_NAME');
    const journalMigrations = getAllJournalMigrations(migrationsFolder);
    let connection;

    try {
        console.log('[Migration] Starting migration...');
        connection = await mysql.createConnection(getMysqlConnectionOptions({
            database: dbName,
        }));

        await prepareLegacyDatabaseIfNeeded(connection, dbName, journalMigrations);
        await runMigrations(connection, migrationsFolder, journalMigrations);
        await seedAdmin(connection);
        console.log('[Migration] Complete.');
    } catch (error) {
        console.error('[Migration] Failed:', formatError(error));
        process.exitCode = 1;
    } finally {
        if (connection) {
            await connection.end().catch(() => {});
        }
    }

    if (process.exitCode) {
        process.exit(process.exitCode);
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error('[Migration] Failed:', formatError(error));
        process.exit(1);
    });
}

module.exports = {
    areSameFileBytes,
    baselineAllJournalMigrations,
    getAllJournalMigrations,
    hashFileSync,
    journalSqlContainsDml,
    main,
    migrateLegacyOriginalUploads,
    prepareLegacyDatabaseIfNeeded,
    reconcileLegacySchema,
    resolveUploadRoots,
    runMigrations,
};
