import { describe, expect, it } from 'vitest';
import { getTableName } from 'drizzle-orm';

import { APP_BACKUP_TABLES, appendSqlScanChunk, containsDangerousSql, SQL_SCAN_TAIL_BYTES, stripSqlCommentsAndLiterals } from '@/lib/sql-restore-scan';
import * as schema from '@/db/schema';

describe('stripSqlCommentsAndLiterals', () => {
    it('masks quoted strings before scanning', () => {
        const sanitized = stripSqlCommentsAndLiterals("INSERT INTO notes VALUES ('Grant Morrison', 'PREPARE for launch');");

        expect(sanitized).not.toContain('Grant');
        expect(sanitized).not.toContain('PREPARE');
        expect(sanitized).toContain('INSERT INTO notes VALUES');
    });

    it('strips block comments so split keywords still scan as one token', () => {
        const sanitized = stripSqlCommentsAndLiterals("GR/**/ANT ALL ON *.* TO 'x'@'%';");

        expect(sanitized).not.toContain('/**/');
        expect(sanitized.replace(/\s+/g, '')).toContain('GRANTALLON*.*TO@;');
    });
});

describe('containsDangerousSql', () => {
    it('detects genuinely dangerous statements', () => {
        expect(containsDangerousSql("GR/**/ANT ALL ON *.* TO 'x'@'%';")).toBe(true);
        expect(containsDangerousSql("CREATE USER 'x'@'%' IDENTIFIED BY 'pw';")).toBe(true);
    });


    it('allows the app-generated mysqldump table reset profile for known app tables', () => {
        const appDump = [
            'DROP TABLE IF EXISTS `topics`;',
            'CREATE TABLE `topics` (`slug` varchar(255) NOT NULL);',
            'INSERT INTO `topics` VALUES (\'travel\',\'Travel\');',
            'DROP TABLE IF EXISTS `images`;',
            'CREATE TABLE `images` (`id` int NOT NULL);',
        ].join('\n');

        expect(containsDangerousSql(appDump)).toBe(false);
    });

    it('blocks destructive table-level statements', () => {
        expect(containsDangerousSql('DROP TABLE images;')).toBe(true);
        expect(containsDangerousSql('DROP TABLE IF EXISTS `images`;')).toBe(false);
        expect(containsDangerousSql('DROP TABLE IF EXISTS `unknown_table`;')).toBe(true);
        expect(containsDangerousSql('DROP TEMPORARY TABLE images;')).toBe(false);
        expect(containsDangerousSql('DELETE FROM images WHERE id = 1;')).toBe(true);
        expect(containsDangerousSql('TRUNCATE TABLE sessions;')).toBe(true);
        expect(containsDangerousSql("INSERT INTO notes VALUES ('DROP TABLE images');")).toBe(false);
    });

    // CR-R9C5-01 (run-9 cycle-5): the app's own mysqldump backup emits a
    // `DROP TABLE IF EXISTS \`<table>\`;` line for EVERY current-schema table
    // (default --add-drop-table). When tables were added to the schema after
    // 2026-04-30 (admin_tokens, image_views, topic_views, shared_group_views,
    // image_embeddings, smart_collections) without being added to
    // APP_BACKUP_TABLES, their legitimate DROP lines tripped the
    // `\bDROP\s+TABLE\b` guard and the restore of an own-backup was blocked
    // with `disallowedSql`. Pin the allowed-drop behaviour for every one of
    // those tables so a regression re-breaks the test, not disaster recovery.
    it('allows DROP TABLE IF EXISTS for every current-schema app table', () => {
        for (const table of APP_BACKUP_TABLES) {
            expect(
                containsDangerousSql('DROP TABLE IF EXISTS `' + table + '`;'),
                `DROP TABLE IF EXISTS for app table "${table}" must be allowed`,
            ).toBe(false);
        }
    });

    // Tripwire: APP_BACKUP_TABLES MUST stay a SUPERSET of every Drizzle table.
    // mysqldump dumps every table in the database, so a table present in the
    // schema but absent from the allowlist re-introduces the CR-R9C5-01 bug
    // (own-backup restore blocked). Introspecting the schema here means a new
    // table added without updating the allowlist fails THIS test rather than
    // silently breaking restore in production.
    it('APP_BACKUP_TABLES is a superset of every table in the Drizzle schema', () => {
        const schemaTables: string[] = [];
        for (const exported of Object.values(schema)) {
            try {
                const name = getTableName(exported as never);
                if (typeof name === 'string' && name) schemaTables.push(name);
            } catch {
                // Non-table export (helper, enum, type) — skip.
            }
        }
        // Sanity: the schema must expose at least the known core tables, so an
        // empty introspection (e.g. an import/API change) can't vacuously pass.
        expect(schemaTables).toContain('images');
        expect(schemaTables.length).toBeGreaterThanOrEqual(18);

        const allowlist = new Set<string>(APP_BACKUP_TABLES);
        const missing = schemaTables.filter((t) => !allowlist.has(t)).sort();
        expect(
            missing,
            `These schema tables are missing from APP_BACKUP_TABLES (their DROP TABLE IF EXISTS lines would be blocked on restore): ${missing.join(', ')}`,
        ).toEqual([]);
    });

    it('blocks CREATE DATABASE (C4R-RPL2-05 defence-in-depth)', () => {
        expect(containsDangerousSql('CREATE DATABASE other;')).toBe(true);
        expect(containsDangerousSql('CREATE  DATABASE  IF NOT EXISTS other;')).toBe(true);
        expect(containsDangerousSql("INSERT INTO notes VALUES ('CREATE DATABASE tutorial');")).toBe(false);
    });

    it('blocks CALL proc_name (C5R-RPL-01 defence-in-depth)', () => {
        expect(containsDangerousSql('CALL cleanup_proc();')).toBe(true);
        expect(containsDangerousSql('CALL dangerous.proc();')).toBe(true);
        expect(containsDangerousSql('CALL  some_proc (1, 2);')).toBe(true);
        // Benign fixtures — "CALL" word inside string data, not a statement
        expect(containsDangerousSql("INSERT INTO notes VALUES ('Please CALL me back');")).toBe(false);
        // Normal mysqldump output never contains CALL; should pass unaffected
        expect(containsDangerousSql('CREATE TABLE images (id INT);\nINSERT INTO images VALUES (1);')).toBe(false);
    });

    it('blocks HANDLER ... READ (C6-AGG6R-04 defence-in-depth)', () => {
        expect(containsDangerousSql('HANDLER images READ FIRST;')).toBe(true);
        expect(containsDangerousSql('HANDLER  images READ NEXT;')).toBe(true);
        expect(containsDangerousSql('HANDLER mydb.images OPEN;')).toBe(true);
        // Benign — "HANDLER" word inside string data
        expect(containsDangerousSql("INSERT INTO notes VALUES ('Error HANDLER test');")).toBe(false);
        // Normal mysqldump output never contains HANDLER
        expect(containsDangerousSql('CREATE TABLE images (id INT);\nINSERT INTO images VALUES (1);')).toBe(false);
    });

    it('blocks DO statements that can hold the restore session open', () => {
        expect(containsDangerousSql('DO SLEEP(5);')).toBe(true);
        expect(containsDangerousSql('DO 1;')).toBe(true);
        expect(containsDangerousSql("INSERT INTO notes VALUES ('DO SLEEP(5);');")).toBe(false);
    });

    it('blocks REVOKE (C5R-RPL-01 defence-in-depth)', () => {
        expect(containsDangerousSql("REVOKE ALL ON *.* FROM 'other'@'%';")).toBe(true);
        expect(containsDangerousSql("REVOKE SELECT ON db.tbl FROM 'u'@'%';")).toBe(true);
        expect(containsDangerousSql("INSERT INTO notes VALUES ('Never REVOKE consent');")).toBe(false);
    });

    it('blocks RENAME USER (C5R-RPL-01 defence-in-depth)', () => {
        expect(containsDangerousSql("RENAME USER 'foo'@'%' TO 'bar'@'%';")).toBe(true);
        expect(containsDangerousSql("INSERT INTO notes VALUES ('rename user manual');")).toBe(false);
    });

    it('ignores dangerous-looking words inside benign data strings', () => {
        expect(containsDangerousSql("INSERT INTO notes VALUES ('Grant Morrison');")).toBe(false);
        expect(containsDangerousSql("INSERT INTO captions VALUES ('Prepare for landing');")).toBe(false);
    });


    it('keeps enough trailing context for dangerous statements split by more than 64 KiB', () => {
        const firstChunk = `CREATE${' '.repeat(70 * 1024)}`;
        const secondChunk = 'TRIGGER evil BEFORE INSERT ON images FOR EACH ROW SET @x = 1;';

        const { combined, nextTail } = appendSqlScanChunk('', firstChunk);
        expect(containsDangerousSql(combined)).toBe(false);
        expect(nextTail.length).toBeLessThanOrEqual(SQL_SCAN_TAIL_BYTES);

        const nextWindow = appendSqlScanChunk(nextTail, secondChunk);
        expect(containsDangerousSql(nextWindow.combined)).toBe(true);
    });

    it('keeps enough trailing context to detect dangerous statements split across chunk boundaries', () => {
        const firstChunk = `DROP${' '.repeat(2048)}`;
        const secondChunk = 'DATABASE gallerykit;';

        const { combined, nextTail } = appendSqlScanChunk('', firstChunk);
        expect(containsDangerousSql(combined)).toBe(false);

        const nextWindow = appendSqlScanChunk(nextTail, secondChunk);
        expect(containsDangerousSql(nextWindow.combined)).toBe(true);
    });
});
