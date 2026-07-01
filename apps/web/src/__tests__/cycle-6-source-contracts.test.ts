import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');

describe('cycle 6 source contracts', () => {
    it('backfill-clip embeddings honors small SEMANTIC_SCAN_LIMIT values by limiting the query before processing', () => {
        const source = read('scripts/backfill-clip-embeddings.ts');

        expect(source).toContain('const remainingScanBudget = Math.max(SEMANTIC_SCAN_LIMIT - processed - failed, 0)');
        expect(source).toContain('.limit(Math.min(BATCH_SIZE, remainingScanBudget))');
        expect(source).toContain('function logScanLimitReached()');
        expect(source).toMatch(/if \(processed \+ failed >= SEMANTIC_SCAN_LIMIT\) \{\s*logScanLimitReached\(\);\s*break;\s*\}\s*if \(rows\.length < BATCH_SIZE\) break;/);
        expect(source).not.toContain('processed + failed + rows.length > SEMANTIC_SCAN_LIMIT');
    });

    it('process-image writes sized derivatives through temp files before rename', () => {
        const source = read('src/lib/process-image.ts');

        expect(source).toContain('writeFinalPathAtomically');
        expect(source).toContain('await writeTemp(tmpPath)');
        expect(source).toContain('await fs.rename(tmpPath, outputPath)');
        expect(source).not.toContain('.toFile(outputPath);');
    });

    it('info bottom sheet no longer exposes a collapsed modal focus-trap state', () => {
        const source = read('src/components/info-bottom-sheet.tsx');

        expect(source).toContain("type SheetState = 'peek' | 'expanded'");
        expect(source).not.toContain("'collapsed'");
        expect(source).not.toContain("calc(100% - 28px)");
    });

    it('upload dropzone disables preview queue controls while upload is in progress', () => {
        const source = read('src/components/upload-dropzone.tsx');

        expect(source).toContain('disabled={uploading}');
        expect(source).toContain('aria-disabled={uploading}');
        expect(source).not.toContain('pointer-events-none');
    });

    it('photo viewer toolbar truncates long localized back labels and keeps action buttons visible', () => {
        const source = read('src/components/photo-viewer.tsx');

        expect(source).toContain('photo-viewer-toolbar');
        expect(source).toContain('max-w-[min(58vw,24rem)]');
        expect(source).toContain('<span className="truncate">');
        expect(source).toContain('className="flex shrink-0 gap-2"');
    });

    it('DB admin page tracks which operation is pending instead of using one label state', () => {
        const source = read('src/app/[locale]/admin/(protected)/db/page.tsx');

        expect(source).toContain("type PendingDbAction = 'backup' | 'restore' | 'export' | null");
        expect(source).toContain('pendingAction === \'backup\'');
        expect(source).toContain('pendingAction === \'restore\'');
        expect(source).toContain('pendingAction === \'export\'');
    });
});
