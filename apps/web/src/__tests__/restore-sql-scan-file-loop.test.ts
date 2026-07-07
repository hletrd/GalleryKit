import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dbActionsSource = readFileSync(
    path.resolve(__dirname, '..', 'app', '[locale]', 'admin', 'db-actions.ts'),
    'utf8',
);

describe('restore SQL scan file loop source contracts', () => {
    it('advances by actual bytes read so short reads cannot skip spans', () => {
        const scanStart = dbActionsSource.indexOf('let dangerousSqlDetected = false;');
        expect(scanStart).toBeGreaterThanOrEqual(0);
        const loopStart = dbActionsSource.indexOf('let scanOffset = 0;', scanStart);
        const whileStart = dbActionsSource.indexOf('while (scanOffset < fileSize)', loopStart);
        const readIndex = dbActionsSource.indexOf('scanFd.read(chunkBuf, 0, readSize, scanOffset)', whileStart);
        const advanceIndex = dbActionsSource.indexOf('scanOffset += bytesRead;', readIndex);
        const catchIndex = dbActionsSource.indexOf('failed to scan SQL dump for disallowed statements', advanceIndex);

        expect(whileStart).toBeGreaterThan(loopStart);
        expect(readIndex).toBeGreaterThan(whileStart);
        expect(advanceIndex).toBeGreaterThan(readIndex);
        expect(catchIndex).toBeGreaterThan(advanceIndex);

        const scanWindow = dbActionsSource.slice(loopStart, catchIndex);
        expect(scanWindow).not.toContain('off += CHUNK_SIZE');
    });
});
