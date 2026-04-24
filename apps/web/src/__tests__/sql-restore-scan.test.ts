import { describe, expect, it } from 'vitest';

import { appendSqlScanChunk, containsDangerousSql, stripSqlCommentsAndLiterals } from '@/lib/sql-restore-scan';

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

    it('keeps enough trailing context to detect dangerous statements split across chunk boundaries', () => {
        const firstChunk = `DROP${' '.repeat(2048)}`;
        const secondChunk = 'DATABASE gallerykit;';

        const { combined, nextTail } = appendSqlScanChunk('', firstChunk);
        expect(containsDangerousSql(combined)).toBe(false);

        const nextWindow = appendSqlScanChunk(nextTail, secondChunk);
        expect(containsDangerousSql(nextWindow.combined)).toBe(true);
    });
});
