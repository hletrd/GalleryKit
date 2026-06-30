import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSrc = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const readRoot = (rel: string) => readFileSync(resolve(__dirname, '..', '..', rel), 'utf8');

describe('cycle 47 source contracts', () => {
    it('renders admin HDR independently of wide-gamut status in the image manager', () => {
        const source = readSrc('components/image-manager.tsx');
        const gamutCell = source.slice(
            source.indexOf('<TableCell>\n                                    <span className="inline-flex flex-wrap items-center gap-1">'),
            source.indexOf('<TableCell suppressHydrationWarning>'),
        );

        expect(source).toContain('const isWideGamut = isWideGamutPrimary(image.color_primaries)');
        expect(source).toContain('const knownSrgb = image.color_primaries === \'bt709\' || image.color_primaries === \'srgb\'');
        expect(gamutCell).toContain("{knownSrgb ? 'sRGB' : t('common.unknown')}");
        expect(gamutCell).toContain('{image.is_hdr && (');
        expect(gamutCell.indexOf('{image.is_hdr && (')).toBeGreaterThan(gamutCell.indexOf('{isWideGamut ? ('));
        expect(gamutCell).toContain('from-amber-300 to-orange-400 text-amber-950');
    });

    it('keeps sidecar deleted-row encode-failure checks wired into the production loop', () => {
        const source = readRoot('scripts/backfill-color-pipeline.ts');

        expect(source).toContain('async function rowExists(id: number): Promise<boolean>');
        expect(source).toContain('SELECT id FROM images WHERE id = ${id} LIMIT 1');
        expect(source).toContain('const result = await reprocessRow(row, backfillSettings, rowExists);');
    });
});
