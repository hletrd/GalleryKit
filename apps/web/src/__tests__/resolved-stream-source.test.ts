import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const serveUploadSource = readFileSync(resolve(__dirname, '..', 'lib', 'serve-upload.ts'), 'utf8');
const backupDownloadSource = readFileSync(resolve(__dirname, '..', 'app', 'api', 'admin', 'db', 'download', 'route.ts'), 'utf8');

describe('resolved-path streaming contracts', () => {
    it('serves uploads from the validated descriptor, not a path reopen', () => {
        expect(serveUploadSource).toContain('const resolvedPath = await realpath(absolutePath)');
        expect(serveUploadSource).toContain("fileHandle = await open(resolvedPath, 'r')");
        // PERF3-07 (run-10 c3): 304/HEAD use a path-stat (no body served, no
        // fd), but the GET BODY path still stats THROUGH the descriptor it
        // streams from — that is the load-bearing race-safety contract.
        expect(serveUploadSource).toContain('const bodyStats = await fileHandle.stat();');
        expect(serveUploadSource).toContain('fileStream = fileHandle.createReadStream({ autoClose: true })');
        expect(serveUploadSource).toContain('same descriptor');
        expect(serveUploadSource).not.toContain('createReadStream(absolutePath)');
        expect(serveUploadSource).not.toContain('createReadStream(resolvedPath)');
    });

    it('downloads backups from a validated file handle, not a path reopen', () => {
        expect(backupDownloadSource).toContain('const resolvedFilePath = await realpath(filePath)');
        expect(backupDownloadSource).toContain("fileHandle = await open(resolvedFilePath, 'r')");
        expect(backupDownloadSource).toContain('const stats = await fileHandle.stat();');
        expect(backupDownloadSource).toContain('const stream = fileHandle.createReadStream();');
        expect(backupDownloadSource).toContain('same descriptor');
        expect(backupDownloadSource).not.toContain('createReadStream(resolvedFilePath)');
        expect(backupDownloadSource).not.toContain('createReadStream(filePath)');
    });
});
