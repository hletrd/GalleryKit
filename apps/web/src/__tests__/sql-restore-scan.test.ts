import { describe, expect, it } from 'vitest';

import { containsDangerousSql, stripSqlCommentsAndLiterals } from '@/lib/sql-restore-scan';

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

    it('ignores dangerous-looking words inside benign data strings', () => {
        expect(containsDangerousSql("INSERT INTO notes VALUES ('Grant Morrison');")).toBe(false);
        expect(containsDangerousSql("INSERT INTO captions VALUES ('Prepare for landing');")).toBe(false);
    });
});
