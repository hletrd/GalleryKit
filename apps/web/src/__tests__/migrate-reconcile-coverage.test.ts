/**
 * Run-4 cycle 1 (COR-R4C1-13): reconcileLegacySchema coverage tripwire.
 *
 * The migration runbook (CLAUDE.md "Adding a new migration", step 3) requires
 * every new migration to be mirrored into `reconcileLegacySchema` in
 * scripts/migrate.js so a database that bootstraps through the reconcile +
 * baseline path (fresh installs per COR-R4C1-12, legacy re-baselines) comes
 * out with the COMPLETE schema. That contract was silently violated for the
 * color/HDR era (migrations 0015-0018): seven `images` columns were missing
 * and the very first INSERT failed with ER_BAD_FIELD_ERROR on every fresh
 * install.
 *
 * This test introspects the authoritative Drizzle schema (no DB connection
 * needed) and asserts that migrate.js mentions every table and every column
 * name. It is a SOURCE tripwire, not a structural validator — it cannot
 * verify types or defaults — but it catches the real failure class: a new
 * column landing in schema.ts + drizzle/*.sql without the reconcile mirror.
 * The authoritative end-to-end check is the disposable-MySQL
 * `check:schema-convergence` CI gate, which degrades latest artifacts and
 * compares the recovered structured INFORMATION_SCHEMA snapshot exactly.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getTableName, getTableColumns } from 'drizzle-orm';
import * as schema from '@/db/schema';

const MIGRATE_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'scripts', 'migrate.js'),
    'utf8',
);

/**
 * AGG-R8c3-16(a) / COR-3 / CRT-5 (run-8 c3): the column + index tripwires below
 * previously used a bare `MIGRATE_SRC.includes(name)`, which is satisfied by the
 * name appearing ONLY in a comment — a developer who documents "we should add an
 * idx_foo index" in a comment but forgets the actual ensureIndex/DDL would pass.
 * Strip line (`// …`) and block (`/* … *\/`) comments so the presence check runs
 * against executable code only. (String/template literals are kept — index and
 * column names legitimately appear inside DDL string literals.)
 */
function stripJsComments(src: string): string {
    return src
        // Block comments (non-greedy, across newlines).
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        // Line comments to end of line.
        .replace(/\/\/[^\n]*/g, ' ');
}

const MIGRATE_SRC_CODE = stripJsComments(MIGRATE_SRC);

function collectTables(): Array<{ table: string; columns: string[] }> {
    const out: Array<{ table: string; columns: string[] }> = [];
    for (const exported of Object.values(schema)) {
        let table: string;
        try {
            table = getTableName(exported as never);
        } catch {
            continue;
        }
        let colsObj: unknown;
        try {
            colsObj = getTableColumns(exported as never);
        } catch {
            continue;
        }
        if (!table || !colsObj || typeof colsObj !== 'object') continue;
        const columns = Object.values(colsObj as Record<string, { name: string }>)
            .map((c) => c.name)
            .filter((n): n is string => typeof n === 'string');
        out.push({ table, columns });
    }
    return out;
}

describe('reconcileLegacySchema mirrors the full Drizzle schema (COR-R4C1-13)', () => {
    const tables = collectTables();

    it('introspects a non-trivial schema', () => {
        expect(tables.length).toBeGreaterThanOrEqual(15);
        const images = tables.find((t) => t.table === 'images');
        expect(images).toBeDefined();
        expect(images!.columns.length).toBeGreaterThanOrEqual(40);
    });

    it.each(tables.map((t) => [t.table] as const))(
        'migrate.js creates table %s',
        (table) => {
            expect(MIGRATE_SRC).toMatch(
                new RegExp(`CREATE TABLE IF NOT EXISTS \\\`?${table}\\\`?`),
            );
        },
    );

    it.each(tables.map((t) => [t.table, t.columns] as const))(
        'migrate.js mentions every column of %s',
        (_table, columns) => {
            // AGG-R8c3-16(a): match against comment-stripped source so a column
            // mentioned only in a comment cannot satisfy the mirror requirement.
            const missing = columns.filter((c) => !MIGRATE_SRC_CODE.includes(c));
            expect(missing).toEqual([]);
        },
    );
});

/**
 * AGG-R8-10 / TRC-1 (run-8 c2): index-coverage tripwire.
 *
 * The column tripwire above catches a NEW COLUMN that lands in a drizzle SQL
 * migration without a reconcileLegacySchema mirror. But the silent-skip class
 * the migration runbook warns about is broader: on an existing-DB upgrade the
 * migrate.js path baselines the new migration's hash FIRST, so drizzle's MySQL
 * migrator short-circuits the apply and reconcileLegacySchema becomes the SOLE
 * applier of the new SQL. An INDEX-ONLY migration (e.g. 0021's analytics
 * indexes) whose author forgets the reconcile mirror would therefore be
 * silently dropped on every existing deployment — green deploy, passing column
 * tests, missing index. This asserts every `CREATE INDEX <name>` declared in
 * the drizzle SQL is named somewhere in migrate.js (inline `INDEX <name>` in a
 * CREATE TABLE body OR a standalone `ensureIndex(..., '<name>', ...)`). It is a
 * SOURCE tripwire (name presence, not structural equivalence) — the
 * authoritative end-to-end check remains the disposable-MySQL convergence
 * gate — but it catches the real failure class locally without a DB.
 */
describe('reconcileLegacySchema mirrors every drizzle SQL index (AGG-R8-10 / TRC-1)', () => {
    const drizzleDir = path.resolve(__dirname, '..', '..', 'drizzle');

    function collectDeclaredIndexNames(): string[] {
        const names = new Set<string>();
        const files = fs
            .readdirSync(drizzleDir, { withFileTypes: true })
            .filter((e) => e.isFile() && e.name.endsWith('.sql'))
            .map((e) => path.join(drizzleDir, e.name));
        // Matches `CREATE [UNIQUE] INDEX [IF NOT EXISTS] `name`|name ON ...`.
        const re = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?\s+ON/gi;
        for (const file of files) {
            const sqlText = fs.readFileSync(file, 'utf8');
            let m: RegExpExecArray | null;
            while ((m = re.exec(sqlText)) !== null) {
                names.add(m[1]);
            }
        }
        return [...names];
    }

    const indexNames = collectDeclaredIndexNames();

    it('finds the known drizzle indexes (scanner sanity)', () => {
        // The journal carries a non-trivial set of CREATE INDEX statements; if
        // this is empty the scanner regex / dir path is broken and the coverage
        // assertion below would pass vacuously.
        expect(indexNames.length).toBeGreaterThanOrEqual(10);
        // Spot-check a couple of well-known ones.
        expect(indexNames).toContain('idx_image_tags_tag_id');
        expect(indexNames).toContain('idx_image_views_bot_viewed_country');
    });

    it.each(indexNames.map((n) => [n] as const))(
        'migrate.js reconcile mirrors index %s',
        (indexName) => {
            // Present either as a standalone ensureIndex('<name>', …) call or as
            // an inline `INDEX <name> (...)` inside a CREATE TABLE body — both
            // embed the index name as a literal token in migrate.js code.
            // AGG-R8c3-16(a): comment-stripped so a name mentioned only in a
            // comment cannot satisfy the mirror requirement.
            expect(
                MIGRATE_SRC_CODE.includes(indexName),
                `Index \`${indexName}\` is declared in a drizzle/*.sql migration but is NOT mirrored in scripts/migrate.js reconcileLegacySchema. ` +
                `An existing-DB upgrade baselines the migration hash first, so reconcile is the sole applier — this index would be silently dropped. ` +
                `Add an ensureIndex(...) call (or inline INDEX in the CREATE TABLE) per CLAUDE.md "Adding a new migration" step 3.`,
            ).toBe(true);
        },
    );
});

describe('reconcileLegacySchema structural pins for high-risk binary/vector schema', () => {
    it('keeps image_embeddings binary storage and scan index shape aligned', () => {
        expect(MIGRATE_SRC_CODE).toMatch(/CREATE TABLE IF NOT EXISTS image_embeddings[\s\S]*embedding mediumblob NOT NULL/);
        expect(MIGRATE_SRC_CODE).toMatch(/CREATE INDEX idx_image_embeddings_model_version_updated ON image_embeddings \(model_version, updated_at\)/);
    });
});

describe('reconcileLegacySchema explicitly repairs current foreign keys', () => {
    const drizzleDir = path.resolve(__dirname, '..', '..', 'drizzle');
    const removedForeignKeys = new Set([
        'entitlements_image_id_fk',
        'image_reactions_image_fk',
    ]);

    function collectDeclaredForeignKeyNames(): string[] {
        const names = new Set<string>();
        const files = fs
            .readdirSync(drizzleDir, { withFileTypes: true })
            .filter((e) => e.isFile() && e.name.endsWith('.sql'))
            .map((e) => path.join(drizzleDir, e.name));
        const re = /CONSTRAINT\s+`?([A-Za-z0-9_]+)`?\s+FOREIGN\s+KEY/gi;
        for (const file of files) {
            const sqlText = fs.readFileSync(file, 'utf8');
            let m: RegExpExecArray | null;
            while ((m = re.exec(sqlText)) !== null) {
                if (!removedForeignKeys.has(m[1])) {
                    names.add(m[1]);
                }
            }
        }
        return [...names].sort();
    }

    const foreignKeyNames = collectDeclaredForeignKeyNames();

    it('finds known live foreign keys (scanner sanity)', () => {
        expect(foreignKeyNames).toContain('admin_tokens_user_fk');
        expect(foreignKeyNames).toContain('image_embeddings_image_id_fk');
        expect(foreignKeyNames.length).toBeGreaterThanOrEqual(10);
    });

    it.each(foreignKeyNames.map((n) => [n] as const))(
        'migrate.js reconcile explicitly repairs foreign key %s',
        (foreignKeyName) => {
            expect(
                new RegExp(`ensureForeignKey\\([^\\n]*['"]${foreignKeyName}['"]`).test(MIGRATE_SRC_CODE),
                `Foreign key \`${foreignKeyName}\` is declared in drizzle/*.sql but is not repaired by an explicit ensureForeignKey(...) call in reconcileLegacySchema. ` +
                `A legacy table that already exists without the FK would make CREATE TABLE IF NOT EXISTS no-op and leave the relationship unenforced.`,
            ).toBe(true);
        },
    );
});

/**
 * Run-8 cycle-1 / FIND-R8C1-05: reconcile DROP tripwire (migration 0023).
 *
 * The coverage tripwire above walks the CURRENT schema.ts and asserts every
 * table/column/index is mirrored as a CREATE/ensure in reconcile. But a DROP
 * is invisible to that scan: a dropped table/column no longer appears in
 * schema.ts, so a regression that silently removes the drop calls would go
 * undetected — leaving a stale `entitlements` table + `images.license_tier`
 * column on any legacy DB forever (the .sql DROP statements never run on an
 * existing DB; they are baselined, so reconcile is the sole applier).
 *
 * This explicitly pins the two removal-0023 drops in reconcileLegacySchema.
 * Comment-stripped (MIGRATE_SRC_CODE) so a drop "documented" only in a comment
 * cannot satisfy the requirement.
 */
describe('reconcileLegacySchema DROP tripwire — migration 0023 (FIND-R8C1-05)', () => {
    it('drops the entitlements table in reconcile (executable code, not a comment)', () => {
        expect(
            /dropTableIfPresent\(\s*connection\s*,\s*['"]entitlements['"]\s*\)/.test(
                MIGRATE_SRC_CODE,
            ),
            "reconcileLegacySchema must call dropTableIfPresent(connection, 'entitlements') so a legacy DB drops the removed paid-download table (migration 0023). The .sql DROP never runs on an existing DB.",
        ).toBe(true);
    });

    it('drops the images.license_tier column in reconcile (executable code, not a comment)', () => {
        expect(
            /dropColumnIfPresent\(\s*connection\s*,\s*dbName\s*,\s*['"]images['"]\s*,\s*['"]license_tier['"]\s*\)/.test(
                MIGRATE_SRC_CODE,
            ),
            "reconcileLegacySchema must call dropColumnIfPresent(connection, dbName, 'images', 'license_tier') so a legacy DB drops the removed paid-download column (migration 0023). The .sql DROP COLUMN never runs on an existing DB.",
        ).toBe(true);
    });
});

/**
 * R16C16 C16-F1 / TE-16-02: the dead reactions schema (image_reactions table +
 * images.reaction_count column, from journaled 0007) is dropped ONLY by
 * reconcileLegacySchema. The journaled 0024_drop_reactions entry re-triggers
 * reconcile on a baselined DB, but reconcile is still the sole APPLIER (the .sql
 * DROP is baselined-not-run). Same blind spot as 0023: a dropped column/table no
 * longer appears in schema.ts, so a regression silently removing these calls
 * would strand the dead reactions schema forever with no other signal.
 */
describe('reconcileLegacySchema DROP tripwire — migration 0024 reactions (R16C16 C16-F1)', () => {
    it('drops the image_reactions table in reconcile (executable code, not a comment)', () => {
        expect(
            /dropTableIfPresent\(\s*connection\s*,\s*['"]image_reactions['"]\s*\)/.test(
                MIGRATE_SRC_CODE,
            ),
            "reconcileLegacySchema must call dropTableIfPresent(connection, 'image_reactions') so a legacy DB drops the removed reactions table (migration 0024). The .sql DROP never runs on an existing DB.",
        ).toBe(true);
    });

    it('drops the images.reaction_count column in reconcile (executable code, not a comment)', () => {
        expect(
            /dropColumnIfPresent\(\s*connection\s*,\s*dbName\s*,\s*['"]images['"]\s*,\s*['"]reaction_count['"]\s*\)/.test(
                MIGRATE_SRC_CODE,
            ),
            "reconcileLegacySchema must call dropColumnIfPresent(connection, dbName, 'images', 'reaction_count') so a legacy DB drops the removed reactions column (migration 0024). The .sql DROP COLUMN never runs on an existing DB.",
        ).toBe(true);
    });
});

describe('reconcileLegacySchema column-definition convergence (C12-01)', () => {
    it('repairs images.processed default drift in executable code', () => {
        expect(MIGRATE_SRC_CODE).toMatch(/ensureColumnDefinition\(/);
        expect(MIGRATE_SRC_CODE).toMatch(/isBooleanFalseDefault\(/);
        expect(MIGRATE_SRC_CODE).toMatch(/ALTER TABLE images MODIFY COLUMN processed boolean DEFAULT false/);
    });
});
