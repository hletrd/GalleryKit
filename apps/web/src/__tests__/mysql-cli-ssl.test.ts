import { describe, expect, it } from 'vitest';

import { getMysqlCliSslArgs, shouldRequireMysqlCliSsl } from '@/lib/mysql-cli-ssl';

describe('mysql CLI SSL args', () => {
    it('does not require SSL for local MySQL hosts', () => {
        expect(getMysqlCliSslArgs('127.0.0.1')).toEqual([]);
        expect(getMysqlCliSslArgs('localhost')).toEqual([]);
        expect(getMysqlCliSslArgs('::1')).toEqual([]);
    });

    it('requires SSL for non-local MySQL hosts by default', () => {
        expect(shouldRequireMysqlCliSsl('db.example.com')).toBe(true);
        expect(getMysqlCliSslArgs('db.example.com')).toEqual(['--ssl-mode=REQUIRED']);
    });

    it('honors DB_SSL=false for non-local backup and restore CLI paths', () => {
        expect(shouldRequireMysqlCliSsl('db.internal', 'false')).toBe(false);
        expect(getMysqlCliSslArgs('db.internal', 'false')).toEqual([]);
    });
});
