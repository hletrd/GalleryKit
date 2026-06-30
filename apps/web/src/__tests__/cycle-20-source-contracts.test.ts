import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSrc = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const readRoot = (rel: string) => readFileSync(resolve(__dirname, '..', '..', rel), 'utf8');

describe('cycle 20 source contracts', () => {
    it('force-kills timed-out DB child processes based on observed settlement, not child.killed', () => {
        const src = readSrc('app/[locale]/admin/db-actions.ts');
        const watchdog = src.slice(src.indexOf('function armDbChildProcessWatchdog'), src.indexOf('export async function exportImagesCsv'));
        expect(watchdog).toContain('let childSettled = false');
        expect(watchdog).toContain("child.once('exit', markSettled)");
        expect(watchdog).toContain("child.once('close', markSettled)");
        expect(watchdog).toContain("if (!childSettled) child.kill('SIGKILL')");
        expect(watchdog).not.toContain('if (!child.killed)');
    });

    it('keeps visitor keyword search imported directly from the public server-action module', () => {
        const src = readSrc('components/search.tsx');
        expect(src).toContain("import { searchImagesAction } from '@/app/actions/public'");
        expect(src).not.toContain("import { searchImagesAction } from '@/app/actions'");
    });

    it('does not prefetch photo detail routes from dense grids or hidden adjacent links', () => {
        const home = readSrc('components/home-client.tsx');
        const photoPage = readSrc('app/[locale]/(public)/p/[id]/page.tsx');
        const viewer = readSrc('components/photo-viewer.tsx');
        const navigation = readSrc('components/photo-navigation.tsx');
        expect(home).toContain('prefetch={false}');
        expect(photoPage).toContain('prefetch={false} className="hidden"');
        expect(viewer).not.toContain('router.prefetch(buildPhotoPath(id))');
        expect(navigation).not.toContain('router.prefetch(getPhotoPath(');
    });

    it('records single-photo share views through the same public photo-view recorder', () => {
        const src = readSrc('app/[locale]/(public)/s/[key]/page.tsx');
        expect(src).toContain("import { recordPhotoView } from '@/app/actions/public'");
        expect(src).toContain('void recordPhotoView(image.id);');
    });

    it('streams admin backup downloads from the validated file handle', () => {
        const src = readSrc('app/api/admin/db/download/route.ts');
        expect(src).toContain("import { open, realpath } from 'fs/promises'");
        expect(src).toContain("fileHandle = await open(resolvedFilePath, 'r')");
        expect(src).toContain('const stats = await fileHandle.stat();');
        expect(src).toContain('const stream = fileHandle.createReadStream();');
        expect(src).not.toContain('createReadStream(resolvedFilePath)');
    });

    it('returns not-found after a raced single-image delete affects zero rows', () => {
        const src = readSrc('app/actions/images.ts');
        const fn = src.slice(src.indexOf('export async function deleteImage'), src.indexOf('export async function deleteImages'));
        expect(fn).toContain('if (deletedRows === 0)');
        expect(fn.indexOf('if (deletedRows === 0)')).toBeLessThan(fn.indexOf('collectImageCleanupFailures'));
        expect(fn.indexOf('if (deletedRows === 0)')).toBeLessThan(fn.indexOf('revalidateLocalizedPaths'));
    });

    it('privacy copy discloses first-party analytics without claiming stored fingerprints', () => {
        const en = JSON.parse(readRoot('messages/en.json')) as { privacy: Record<string, string> };
        const ko = JSON.parse(readRoot('messages/ko.json')) as { privacy: Record<string, string> };
        expect(en.privacy.analyticsDisabled).toContain('first-party photo, topic, and shared-gallery view events');
        expect(en.privacy.analyticsEnabled).toContain('client fingerprints are not stored');
        expect(en.privacy.analyticsEnabled).not.toContain('short client fingerprint');
        expect(ko.privacy.analyticsDisabled).toContain('사진, 토픽, 공유 갤러리 조회 이벤트');
        expect(ko.privacy.analyticsEnabled).not.toContain('짧은 클라이언트 지문');
    });
});
