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
        expect(() => getMysqlCliSslArgs('db.example.com')).toThrow('DB_SSL_CA is required');
    });

    it('verifies the remote MySQL server identity when a CA is configured', () => {
        expect(getMysqlCliSslArgs('db.example.com', undefined, '/etc/mysql/ca.pem')).toEqual([
            '--ssl',
            '--ssl-ca=/etc/mysql/ca.pem',
            '--ssl-verify-server-cert',
        ]);
    });

    it('honors DB_SSL=false for non-local backup and restore CLI paths', () => {
        expect(shouldRequireMysqlCliSsl('db.internal', 'false')).toBe(false);
        expect(getMysqlCliSslArgs('db.internal', 'false')).toEqual([]);
    });
});
