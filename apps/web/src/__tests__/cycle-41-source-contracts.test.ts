import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSrc = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const readWorkspace = (rel: string) => readFileSync(resolve(__dirname, '..', '..', '..', '..', rel), 'utf8');

describe('cycle 41 source contracts', () => {
    it('CLIP sidecar runbook examples mount tsconfig for tsx path aliases', () => {
        const claude = readWorkspace('CLAUDE.md');
        const tsconfigMount = '-v <deploy-root>/apps/web/tsconfig.json:/app/apps/web/tsconfig.json:ro';

        expect(claude).toMatch(new RegExp(`--name gk-clip-seed[\\s\\S]*${tsconfigMount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
        expect(claude).toMatch(new RegExp(`--name gk-clip-backfill[\\s\\S]*${tsconfigMount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    });

    it('root README states GPS stripping is locked once photos exist', () => {
        const readme = readWorkspace('README.md');
        expect(readme).toContain('once any photo exists, the setting is locked');
        expect(readme).not.toContain('changing the setting later does not rewrite already stored originals.');
    });

    it('shared photo viewers do not render whole-library similar-photo discovery', () => {
        const viewer = readSrc('components/photo-viewer.tsx');
        const sheet = readSrc('components/info-bottom-sheet.tsx');
        expect(viewer).toContain('{!isSharedView && <SimilarPhotos');
        expect(viewer).toContain('semanticSearchMode={semanticSearchMode}');
        expect(sheet).toContain("import SimilarPhotos from '@/components/similar-photos'");
        expect(sheet).toContain('{!isSharedView && <SimilarPhotos');
    });
});
