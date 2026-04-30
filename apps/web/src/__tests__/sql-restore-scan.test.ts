import { describe, expect, it } from 'vitest';

import { appendSqlScanChunk, containsDangerousSql, SQL_SCAN_TAIL_BYTES, stripSqlCommentsAndLiterals } from '@/lib/sql-restore-scan';

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
