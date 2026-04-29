import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const serveUploadSource = readFileSync(resolve(__dirname, '..', 'lib', 'serve-upload.ts'), 'utf8');
const backupDownloadSource = readFileSync(resolve(__dirname, '..', 'app', 'api', 'admin', 'db', 'download', 'route.ts'), 'utf8');

describe('resolved-path streaming contracts', () => {
    it('serves uploads from the validated realpath, not the pre-validation path', () => {
        expect(serveUploadSource).toContain('const resolvedPath = await realpath(absolutePath)');
        expect(serveUploadSource).toContain('createReadStream(resolvedPath)');
        expect(serveUploadSource).not.toContain('createReadStream(absolutePath)');
    });

    it('downloads backups from the validated realpath, not the pre-validation path', () => {
        expect(backupDownloadSource).toContain('const resolvedFilePath = await realpath(filePath)');
        expect(backupDownloadSource).toContain('createReadStream(resolvedFilePath)');
        expect(backupDownloadSource).not.toContain('createReadStream(filePath)');
    });
});
