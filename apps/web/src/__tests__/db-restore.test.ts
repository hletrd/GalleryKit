import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    hasPlausibleSqlDumpHeader,
    isIgnorableRestoreStdinError,
    isMysqldumpArtifactHeader,
    hasMysqldumpCompletionTrailer,
} from '@/lib/db-restore';

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

    it('keeps maintenance active and cleans temp state on mysql child failure paths', () => {
        const restoreIdx = DB_ACTIONS_SRC.indexOf('// Restore intentionally uses');
        const restoreSource = DB_ACTIONS_SRC.slice(restoreIdx);
        const failRestoreIdx = restoreSource.indexOf('const failRestore = (error: string, logLabel: string, reason: unknown) => {');
        expect(failRestoreIdx).toBeGreaterThan(-1);
        const failRestore = restoreSource.slice(failRestoreIdx, restoreSource.indexOf('};', failRestoreIdx) + 2);

        expect(failRestore).toContain('clearRestoreWatchdog();');
        expect(failRestore).toContain('readStream.destroy();');
        expect(failRestore).toContain('restore.stdin.destroy();');
        expect(failRestore).toContain('restore.kill();');
        expect(failRestore).toContain('cleanupTempFile();');
        expect(failRestore).toContain('keepMaintenance: true');

        expect(restoreSource).toContain("failRestore(t('restoreFailed'), 'mysql restore timeout:', err)");
        expect(restoreSource).toContain("failRestore(t('failedToReadRestore'), 'Failed to read restore file:', err)");
        expect(restoreSource).toContain("failRestore(t('restoreFailed'), 'mysql restore stdin error:', err)");
        expect(restoreSource).toContain("failRestore(t('restoreFailed'), 'mysql restore spawn error:', err)");
    });
});

describe('backup dump validation', () => {
    it('serializes backup creation with restore using LOCK_DB_RESTORE', () => {
        const dumpDatabaseSource = DB_ACTIONS_SRC.slice(
            DB_ACTIONS_SRC.indexOf('export async function dumpDatabase()'),
            DB_ACTIONS_SRC.indexOf('// Restore intentionally uses'),
        );

        expect(dumpDatabaseSource).toContain('connection.getConnection()');
        expect(dumpDatabaseSource).toContain('SELECT GET_LOCK(?, 0) AS acquired');
        expect(dumpDatabaseSource).toContain('[LOCK_DB_RESTORE]');
        expect(dumpDatabaseSource).toContain("releasePooledAdvisoryLocks(conn, [LOCK_DB_RESTORE], 'backup finally')");
        expect(dumpDatabaseSource).toMatch(/finally\s*\{[\s\S]*releasePooledAdvisoryLocks[\s\S]*else\s*\{[\s\S]*conn\.release\(\)/);
    });

    it('validates the generated backup header before returning a downloadable filename', () => {
        const dumpDatabaseSource = DB_ACTIONS_SRC.slice(
            DB_ACTIONS_SRC.indexOf('export async function dumpDatabase()'),
            DB_ACTIONS_SRC.indexOf('// Restore intentionally uses'),
        );

        expect(dumpDatabaseSource).toContain('hasPlausibleSqlDumpHeader(headerBytes)');
        expect(dumpDatabaseSource.indexOf('hasPlausibleSqlDumpHeader(headerBytes)')).toBeLessThan(
            dumpDatabaseSource.indexOf('resolve({ success: true, filename'),
        );
        expect(dumpDatabaseSource).toMatch(/fs\.unlink\(tmpOutputPath\)\.catch\(\(\) => \{\}\);[\s\S]*resolve\(\{ success: false, error: t\('failedToWriteBackup'\) \}\);/);
    });

    it('C1-02: streams the dump to a .tmp sibling and atomically renames only after all checks pass', () => {
        const dumpDatabaseSource = DB_ACTIONS_SRC.slice(
            DB_ACTIONS_SRC.indexOf('export async function dumpDatabase()'),
            DB_ACTIONS_SRC.indexOf('// Restore intentionally uses'),
        );

        // Write goes to the .tmp path, never directly to the canonical filename.
        expect(dumpDatabaseSource).toMatch(/const tmpOutputPath = `\$\{outputPath\}\.tmp`/);
        expect(dumpDatabaseSource).toContain('createWriteStream(tmpOutputPath');
        expect(dumpDatabaseSource).not.toContain('createWriteStream(outputPath');
        // The atomic publish happens after the trailer completeness check and
        // before the success resolve.
        const trailerIdx = dumpDatabaseSource.indexOf('hasMysqldumpCompletionTrailer(tailBytes)');
        const renameIdx = dumpDatabaseSource.indexOf('await fs.rename(tmpOutputPath, outputPath)');
        const successIdx = dumpDatabaseSource.indexOf('resolve({ success: true, filename');
        expect(trailerIdx).toBeGreaterThan(-1);
        expect(renameIdx).toBeGreaterThan(trailerIdx);
        expect(successIdx).toBeGreaterThan(renameIdx);
    });

    it('C1-02: restore requires the mysqldump completion trailer for mysqldump-headed files', () => {
        const restoreIdx = DB_ACTIONS_SRC.indexOf('// Restore intentionally uses');
        const restoreSource = DB_ACTIONS_SRC.slice(restoreIdx);
        expect(restoreSource).toContain('isMysqldumpArtifactHeader(headerBytes)');
        expect(restoreSource).toContain('hasMysqldumpCompletionTrailer(tailBytes)');
        expect(restoreSource).toContain("t('truncatedSqlDump')");
        // The completeness gate must run before the mysql child is spawned.
        expect(restoreSource.indexOf('hasMysqldumpCompletionTrailer(tailBytes)')).toBeLessThan(
            restoreSource.indexOf("spawn('mysql'"),
        );
    });
});

describe('isMysqldumpArtifactHeader (C1-02)', () => {
    it('identifies mysqldump and mariadb-dump artifacts', () => {
        expect(isMysqldumpArtifactHeader('-- MySQL dump 10.13  Distrib 8.0.36')).toBe(true);
        expect(isMysqldumpArtifactHeader('-- MariaDB dump 10.19')).toBe(true);
        expect(isMysqldumpArtifactHeader('\n-- MySQL dump 10.13')).toBe(true);
    });

    it('does not classify operator-authored SQL as a mysqldump artifact', () => {
        expect(isMysqldumpArtifactHeader('-- my hand-written backup')).toBe(false);
        expect(isMysqldumpArtifactHeader('CREATE TABLE `images` (`id` int);')).toBe(false);
        expect(isMysqldumpArtifactHeader('SET NAMES utf8mb4;')).toBe(false);
    });
});

describe('hasMysqldumpCompletionTrailer (C1-02)', () => {
    it('accepts a complete dump tail', () => {
        expect(hasMysqldumpCompletionTrailer('UNLOCK TABLES;\n\n-- Dump completed on 2026-07-06 12:00:00\n')).toBe(true);
        expect(hasMysqldumpCompletionTrailer('-- Dump completed\n')).toBe(true);
    });

    it('rejects a tail truncated at a clean statement boundary', () => {
        // The dangerous case: every statement is complete, but the dump was
        // cut short — imports cleanly with exit code 0 while missing tables.
        expect(hasMysqldumpCompletionTrailer("INSERT INTO `images` VALUES (42,'x');\n")).toBe(false);
        expect(hasMysqldumpCompletionTrailer('UNLOCK TABLES;\n')).toBe(false);
        expect(hasMysqldumpCompletionTrailer('')).toBe(false);
    });
});
