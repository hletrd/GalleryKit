import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const actionsSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'actions', 'images.ts'), 'utf8');
const schemaSource = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.ts'), 'utf8');
const cleanupSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pending-file-deletions.ts'), 'utf8');
const migrateSource = fs.readFileSync(path.join(process.cwd(), 'scripts', 'migrate.js'), 'utf8');
const migrationSource = fs.readFileSync(path.join(process.cwd(), 'drizzle', '0030_pending_file_deletions.sql'), 'utf8');

describe('pending file deletion durability', () => {
    it('declares and migrates the pending_file_deletions ledger', () => {
        expect(schemaSource).toContain('pending_file_deletions');
        expect(migrationSource).toContain('CREATE TABLE `pending_file_deletions`');
        expect(migrationSource).toContain('idx_pending_file_deletions_image_id');
        expect(migrateSource).toContain('CREATE TABLE IF NOT EXISTS pending_file_deletions');
    });

    it('adds the pipeline-version candidate index to schema, migration, and reconcile', () => {
        expect(schemaSource).toContain('idx_images_processed_pipeline_version');
        expect(migrationSource).toContain('CREATE INDEX `idx_images_processed_pipeline_version`');
        expect(migrateSource).toContain('CREATE INDEX idx_images_processed_pipeline_version ON images (processed, pipeline_version, id)');
    });

    it('inserts pending cleanup rows before deleting image rows', () => {
        const deleteImageBody = extractFnBody(actionsSource, 'export async function deleteImage(');
        expect(deleteImageBody, 'deleteImage body must be findable').toBeTruthy();
        expect(deleteImageBody!).toContain('tx.insert(pendingFileDeletions)');
        expect(deleteImageBody!.indexOf('tx.insert(pendingFileDeletions)')).toBeLessThan(deleteImageBody!.indexOf('tx.delete(images)'));
        expect(deleteImageBody!).toContain('cleanupPendingFileDeletion(pendingDeletionRef.current)');

        const deleteImagesBody = extractFnBody(actionsSource, 'export async function deleteImages(');
        expect(deleteImagesBody, 'deleteImages body must be findable').toBeTruthy();
        expect(deleteImagesBody!).toContain('tx.insert(pendingFileDeletions)');
        expect(deleteImagesBody!.indexOf('tx.insert(pendingFileDeletions)')).toBeLessThan(deleteImagesBody!.indexOf('tx.delete(images)'));
        expect(deleteImagesBody!).toContain('cleanupPendingFileDeletion(pendingDeletion)');
    });

    it('keeps ledger rows on cleanup failure and deletes them only after full cleanup success', () => {
        expect(cleanupSource).toMatch(/if\s*\(\s*failures\.length\s*===\s*0\s*\)\s*\{/);
        expect(cleanupSource).toContain('db.delete(pendingFileDeletions)');
        expect(cleanupSource).toContain('db.update(pendingFileDeletions)');
        expect(cleanupSource).toContain('attempts: sql`${pendingFileDeletions.attempts} + 1`');
        expect(cleanupSource).toContain('last_error: describeCleanupFailures(failures)');
    });
});

function extractFnBody(source: string, header: string): string | null {
    const headerIdx = source.indexOf(header);
    if (headerIdx === -1) return null;
    const openBrace = source.indexOf('{', headerIdx);
    if (openBrace === -1) return null;

    let depth = 0;
    for (let i = openBrace; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') depth++;
        if (ch === '}') {
            depth--;
            if (depth === 0) return source.slice(openBrace, i + 1);
        }
    }
    return null;
}
