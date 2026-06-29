import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { hasPlausibleSqlDumpHeader, isIgnorableRestoreStdinError } from '@/lib/db-restore';

const DB_ACTIONS_SRC = readFileSync(
    resolve(__dirname, '../app/[locale]/admin/db-actions.ts'),
    'utf8',
);

describe('hasPlausibleSqlDumpHeader', () => {
    it('accepts normal mysqldump-style leading statements and comments', () => {
        expect(hasPlausibleSqlDumpHeader('-- MySQL dump')).toBe(true);
        expect(hasPlausibleSqlDumpHeader('  /*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;')).toBe(true);
        expect(hasPlausibleSqlDumpHeader('CREATE TABLE `images` (`id` int);')).toBe(true);
        expect(hasPlausibleSqlDumpHeader('INSERT INTO `images` VALUES (1);')).toBe(true);
        expect(hasPlausibleSqlDumpHeader('DROP TABLE IF EXISTS `images`;')).toBe(true);
        expect(hasPlausibleSqlDumpHeader('SET NAMES utf8mb4;')).toBe(true);
    });

    it('does not accept allowed-looking tokens after an arbitrary prefix', () => {
        expect(hasPlausibleSqlDumpHeader('garbage\nCREATE TABLE `images` (`id` int);')).toBe(false);
        expect(hasPlausibleSqlDumpHeader('/* plain block comment */\nINSERT INTO `images` VALUES (1);')).toBe(false);
        expect(hasPlausibleSqlDumpHeader('not-a-dump -- MySQL dump')).toBe(false);
    });
});

describe('isIgnorableRestoreStdinError', () => {
    it('treats broken-pipe style child-stdin errors as benign', () => {
        expect(isIgnorableRestoreStdinError({ code: 'EPIPE' })).toBe(true);
        expect(isIgnorableRestoreStdinError({ code: 'ERR_STREAM_DESTROYED' })).toBe(true);
    });

    it('rejects unrelated or missing error codes', () => {
        expect(isIgnorableRestoreStdinError({ code: 'ECONNRESET' })).toBe(false);
        expect(isIgnorableRestoreStdinError(new Error('boom'))).toBe(false);
        expect(isIgnorableRestoreStdinError(null)).toBe(false);
    });
});

describe('restore temp-file cleanup ownership', () => {
    it('uses one finalizer until cleanup is transferred to the mysql restore process', () => {
        expect(DB_ACTIONS_SRC).toContain('let cleanupTransferredToRestoreProcess = false');
        expect(DB_ACTIONS_SRC).toContain('const cleanupTempFile = async () =>');
        expect(DB_ACTIONS_SRC).toContain('cleanupTransferredToRestoreProcess = true');
        expect(DB_ACTIONS_SRC).toMatch(/return\s+await\s+new\s+Promise<RestoreResult>/);
        expect(DB_ACTIONS_SRC).toMatch(/finally\s*\{[\s\S]*if\s*\(!cleanupTransferredToRestoreProcess\)\s*\{[\s\S]*await cleanupTempFile\(\)/);
    });
});
