import { describe, expect, it } from 'vitest';
import { getTableName } from 'drizzle-orm';

import { APP_BACKUP_TABLES, appendSqlScanChunk, containsDangerousSql, SQL_SCAN_TAIL_BYTES, stripSqlCommentsAndLiterals } from '@/lib/sql-restore-scan';
import * as schema from '@/db/schema';

describe('stripSqlCommentsAndLiterals', () => {
    it('masks quoted strings before scanning', () => {
        const sanitized = stripSqlCommentsAndLiterals("INSERT INTO images VALUES ('Grant Morrison', 'PREPARE for launch');");

        expect(sanitized).not.toContain('Grant');
        expect(sanitized).not.toContain('PREPARE');
        expect(sanitized).toContain('INSERT INTO images VALUES');
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
        expect(containsDangerousSql('DROP TEMPORARY TABLE images;')).toBe(true);
        expect(containsDangerousSql('CREATE TEMPORARY TABLE images (id INT);')).toBe(true);
        expect(containsDangerousSql('DELETE FROM images WHERE id = 1;')).toBe(true);
        expect(containsDangerousSql('TRUNCATE TABLE sessions;')).toBe(true);
        expect(containsDangerousSql("INSERT INTO images VALUES ('DROP TABLE images');")).toBe(false);
    });

    it('blocks restore writes to schema-qualified targets', () => {
        const statements = [
            'CREATE TABLE otherdb.images (id INT);',
            'ALTER TABLE otherdb.images ADD COLUMN title varchar(255);',
            'INSERT INTO otherdb.images VALUES (1);',
            'INSERT LOW_PRIORITY INTO otherdb.images VALUES (1);',
            'INSERT DELAYED INTO otherdb.images VALUES (1);',
            'INSERT HIGH_PRIORITY INTO otherdb.images VALUES (1);',
            'INSERT otherdb.images VALUES (1);',
            'REPLACE INTO otherdb.images VALUES (1);',
            'REPLACE LOW_PRIORITY INTO otherdb.images VALUES (1);',
            'UPDATE otherdb.images SET title = "x";',
            'CREATE TABLE `otherdb`.`images` (id INT);',
            'INSERT INTO `otherdb`.`images` VALUES (1);',
        ];

        for (const statement of statements) {
            expect(containsDangerousSql(statement), statement).toBe(true);
        }
    });

    it('blocks restore writes to unknown tables in the current schema', () => {
        const statements = [
            'CREATE TABLE unknown_table (id INT);',
            'ALTER TABLE unknown_table ADD COLUMN title varchar(255);',
            'INSERT INTO unknown_table VALUES (1);',
            'INSERT HIGH_PRIORITY INTO unknown_table VALUES (1);',
            'INSERT unknown_table VALUES (1);',
            'REPLACE INTO unknown_table VALUES (1);',
            'REPLACE DELAYED INTO unknown_table VALUES (1);',
            'UPDATE unknown_table SET title = "x";',
        ];

        for (const statement of statements) {
            expect(containsDangerousSql(statement), statement).toBe(true);
        }
    });

    it('allows restore writes to known app tables in the current schema', () => {
        const statements = [
            'CREATE TABLE `images` (`id` int NOT NULL);',
            'CREATE TABLE IF NOT EXISTS topics (`slug` varchar(255) NOT NULL);',
            'ALTER TABLE images DISABLE KEYS;',
            'INSERT INTO `images` VALUES (1);',
            'INSERT HIGH_PRIORITY INTO `images` VALUES (1);',
            'INSERT `images` VALUES (1);',
            'REPLACE INTO tags VALUES (1, "travel");',
            'REPLACE LOW_PRIORITY INTO tags VALUES (1, "travel");',
            'UPDATE topic_views SET view_count = 1;',
        ];

        for (const statement of statements) {
            expect(containsDangerousSql(statement), statement).toBe(false);
        }
    });

    it('blocks dangerous multi-token statements split by block comments', () => {
        const maliciousStatements = [
            'DROP/**/TABLE images;',
            'DROP/**/DATABASE gallerykit;',
            'CREATE/**/DATABASE other;',
            'CREATE/**/TABLE rogue (id INT);',
            'INSERT/**/INTO rogue VALUES (1);',
            'INSERT/**/INTO otherdb.images VALUES (1);',
            'UPDATE/**/rogue SET id = 1;',
            "CREATE/**/USER 'x'@'%' IDENTIFIED BY 'pw';",
            'DELETE/**/FROM images WHERE id = 1;',
            'TRUNCATE/**/TABLE sessions;',
            'CALL/**/dangerous_proc();',
            "RENAME/**/USER 'foo'@'%' TO 'bar'@'%';",
            'CREATE VIEW v AS SELECT 1 SQL/**/SECURITY/**/DEFINER;',
        ];

        for (const statement of maliciousStatements) {
            expect(containsDangerousSql(statement), statement).toBe(true);
        }
    });

    it('blocks schema-qualified read sources in otherwise allowed restore statements', () => {
        const statements = [
            'INSERT INTO images SELECT * FROM otherdb.images;',
            'CREATE TABLE images AS SELECT * FROM otherdb.images;',
            'INSERT INTO `images` SELECT * FROM `otherdb`.`images`;',
            'CREATE TABLE `images` AS SELECT * FROM `otherdb`.`images`;',
        ];

        for (const statement of statements) {
            expect(containsDangerousSql(statement), statement).toBe(true);
        }
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
        expect(containsDangerousSql("INSERT INTO images VALUES ('CREATE DATABASE tutorial');")).toBe(false);
    });

    it('blocks CALL proc_name (C5R-RPL-01 defence-in-depth)', () => {
        expect(containsDangerousSql('CALL cleanup_proc();')).toBe(true);
        expect(containsDangerousSql('CALL dangerous.proc();')).toBe(true);
        expect(containsDangerousSql('CALL  some_proc (1, 2);')).toBe(true);
        // Benign fixtures — "CALL" word inside string data, not a statement
        expect(containsDangerousSql("INSERT INTO images VALUES ('Please CALL me back');")).toBe(false);
        // Normal mysqldump output never contains CALL; should pass unaffected
        expect(containsDangerousSql('CREATE TABLE images (id INT);\nINSERT INTO images VALUES (1);')).toBe(false);
    });

    it('blocks HANDLER ... READ (C6-AGG6R-04 defence-in-depth)', () => {
        expect(containsDangerousSql('HANDLER images READ FIRST;')).toBe(true);
        expect(containsDangerousSql('HANDLER  images READ NEXT;')).toBe(true);
        expect(containsDangerousSql('HANDLER mydb.images OPEN;')).toBe(true);
        // Benign — "HANDLER" word inside string data
        expect(containsDangerousSql("INSERT INTO images VALUES ('Error HANDLER test');")).toBe(false);
        // Normal mysqldump output never contains HANDLER
        expect(containsDangerousSql('CREATE TABLE images (id INT);\nINSERT INTO images VALUES (1);')).toBe(false);
    });

    it('blocks DO statements that can hold the restore session open', () => {
        expect(containsDangerousSql('DO SLEEP(5);')).toBe(true);
        expect(containsDangerousSql('DO 1;')).toBe(true);
        expect(containsDangerousSql("INSERT INTO images VALUES ('DO SLEEP(5);');")).toBe(false);
    });

    it('blocks REVOKE (C5R-RPL-01 defence-in-depth)', () => {
        expect(containsDangerousSql("REVOKE ALL ON *.* FROM 'other'@'%';")).toBe(true);
        expect(containsDangerousSql("REVOKE SELECT ON db.tbl FROM 'u'@'%';")).toBe(true);
        expect(containsDangerousSql("INSERT INTO images VALUES ('Never REVOKE consent');")).toBe(false);
    });

    it('blocks RENAME USER (C5R-RPL-01 defence-in-depth)', () => {
        expect(containsDangerousSql("RENAME USER 'foo'@'%' TO 'bar'@'%';")).toBe(true);
        expect(containsDangerousSql("INSERT INTO images VALUES ('rename user manual');")).toBe(false);
    });

    it('ignores dangerous-looking words inside benign data strings', () => {
        expect(containsDangerousSql("INSERT INTO images VALUES ('Grant Morrison');")).toBe(false);
        expect(containsDangerousSql("INSERT INTO tags VALUES ('Prepare for landing');")).toBe(false);
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

    it('compacts scan-tail whitespace so split routine/view heads cannot outrun the tail window', () => {
        const disallowedTails = [
            'FUNCTION evil() RETURNS INT DETERMINISTIC RETURN 1;',
            'PROCEDURE evil() SELECT 1;',
            'VIEW evil AS SELECT 1;',
            'TRIGGER evil BEFORE DELETE ON images FOR EACH ROW SET @x = 1;',
        ];

        for (const secondChunk of disallowedTails) {
            const firstChunk = `CREATE${' '.repeat(SQL_SCAN_TAIL_BYTES + 1)}`;
            const { combined, nextTail } = appendSqlScanChunk('', firstChunk);
            expect(containsDangerousSql(combined), secondChunk).toBe(false);
            expect(nextTail.length).toBeLessThanOrEqual(SQL_SCAN_TAIL_BYTES);
            expect(nextTail).toBe('CREATE');

            const nextWindow = appendSqlScanChunk(nextTail, secondChunk);
            expect(containsDangerousSql(nextWindow.combined), secondChunk).toBe(true);
        }
    });

    it('keeps enough trailing context to detect dangerous statements split across chunk boundaries', () => {
        const firstChunk = `DROP${' '.repeat(2048)}`;
        const secondChunk = 'DATABASE gallerykit;';

        const { combined, nextTail } = appendSqlScanChunk('', firstChunk);
        expect(containsDangerousSql(combined)).toBe(false);

        const nextWindow = appendSqlScanChunk(nextTail, secondChunk);
        expect(containsDangerousSql(nextWindow.combined)).toBe(true);
    });

    // C6-01 (run-10 cycle-6): the compacted `\n`-join in appendSqlScanChunk
    // injects a newline exactly at the read boundary. When a dangerous keyword
    // TOKEN is split there (e.g. `DROP TAB`|`LE`), the newline breaks the token
    // and `/\bDROP\s+TABLE\b/i` never matches — a byte-alignment evasion. The
    // raw byte-continuous bridge (threaded via `nextRawSuffix`) rejoins the
    // token. This differs from the whitespace-boundary tests above, which split
    // in the inter-token gap and are caught by the `\n`-join itself.
    it('detects dangerous keywords split INSIDE a token at the chunk boundary (raw bridge)', () => {
        const cases: Array<{ first: string; second: string }> = [
            { first: 'DROP TAB', second: 'LE images;' },
            { first: 'DROP DATABA', second: 'SE gallerykit;' },
            { first: 'DELETE FRO', second: 'M images;' },
            { first: 'TRUNC', second: 'ATE TABLE images;' },
        ];

        for (const { first, second } of cases) {
            const label = `${first}|${second}`;
            const firstWindow = appendSqlScanChunk('', first, SQL_SCAN_TAIL_BYTES, '');
            // The benign prefix on its own must not self-trigger.
            expect(containsDangerousSql(firstWindow.combined), label).toBe(false);

            // Regression sentinel: WITHOUT the raw-suffix thread (legacy 2-arg
            // call), the intra-token split evades detection — this documents the
            // exact bug the raw bridge closes.
            const evasion = appendSqlScanChunk(firstWindow.nextTail, second);
            expect(containsDangerousSql(evasion.combined), `${label} (no bridge)`).toBe(false);

            // WITH the raw suffix threaded, the split keyword is rejoined and the
            // dangerous statement is detected.
            const bridged = appendSqlScanChunk(
                firstWindow.nextTail,
                second,
                SQL_SCAN_TAIL_BYTES,
                firstWindow.nextRawSuffix,
            );
            expect(containsDangerousSql(bridged.combined), `${label} (bridge)`).toBe(true);
        }
    });

    // C7-12 (run-10 cycle 7b): the rolling raw suffix must accumulate over the
    // CUMULATIVE stream. The prior per-chunk shape dropped the previous suffix
    // whenever a read returned fewer than SQL_SCAN_RAW_BRIDGE_BYTES bytes, so a
    // legally-possible short fd.read() could split a dangerous keyword across
    // THREE reads and evade the bridge ("DR" | "OP TAB" | "LE images;" — the
    // middle chunk's tiny suffix lost the "DR").
    it('detects dangerous keywords split across THREE short reads (cumulative raw suffix)', () => {
        const cases: Array<[string, string, string]> = [
            ['DR', 'OP TAB', 'LE images;'],
            // (TRUNCATE is deliberately absent: `TRUNCATE ` ALONE is already a
            // dangerous pattern, so a split TRUNCATE detects EARLY at read 2 —
            // early detection is fine, but breaks this test's
            // benign-intermediate shape.)
            ['CREA', 'TE DATABA', 'SE evil;'],
            ['DELE', 'TE FR', 'OM images;'],
        ];

        for (const [first, second, third] of cases) {
            const label = `${first}|${second}|${third}`;
            const w1 = appendSqlScanChunk('', first, SQL_SCAN_TAIL_BYTES, '');
            expect(containsDangerousSql(w1.combined), `${label} (1)`).toBe(false);
            const w2 = appendSqlScanChunk(w1.nextTail, second, SQL_SCAN_TAIL_BYTES, w1.nextRawSuffix);
            expect(containsDangerousSql(w2.combined), `${label} (2)`).toBe(false);
            const w3 = appendSqlScanChunk(w2.nextTail, third, SQL_SCAN_TAIL_BYTES, w2.nextRawSuffix);
            expect(containsDangerousSql(w3.combined), `${label} (3)`).toBe(true);
        }
    });

    it('allows app-schema DROP TABLE when the scanner boundary splits inside a table name', () => {
        const firstWindow = appendSqlScanChunk('', 'DROP TABLE IF EXISTS `ima', SQL_SCAN_TAIL_BYTES, '');
        expect(containsDangerousSql(firstWindow.combined)).toBe(false);

        const secondWindow = appendSqlScanChunk(
            firstWindow.nextTail,
            'ges`;',
            SQL_SCAN_TAIL_BYTES,
            firstWindow.nextRawSuffix,
        );
        expect(containsDangerousSql(secondWindow.combined)).toBe(false);

        expect(containsDangerousSql('DROP TABLE IF EXISTS `not_gallerykit_owned`;')).toBe(true);
    });

    // C7-19 (run-10 cycle 7b): the dangerous-SQL patterns carry the /i flag —
    // pin case-insensitive matching so a future pattern rewrite cannot drop it.
    it('matches dangerous statements case-insensitively', () => {
        const variants = [
            'drop table images;',
            'DrOp TaBlE images;',
            'truncate table images;',
            'delete from images;',
            'GRANT ALL ON *.* TO evil;'.toLowerCase(),
        ];
        for (const statement of variants) {
            expect(containsDangerousSql(statement), statement).toBe(true);
        }
    });
});
