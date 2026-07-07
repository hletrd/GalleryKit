import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSrc = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const readRoot = (rel: string) => readFileSync(resolve(__dirname, '..', '..', rel), 'utf8');

describe('cycle 20 source contracts', () => {
    it('force-kills timed-out DB child processes based on observed settlement, not child.killed', () => {
        const src = readSrc('lib/db-child-watchdog.ts');
        const watchdog = src.slice(src.indexOf('export function armDbChildProcessWatchdog'));
        expect(watchdog).toContain('let childSettled = false');
        expect(watchdog).toContain("child.once('exit', markSettled)");
        expect(watchdog).toContain("child.once('close', markSettled)");
        expect(watchdog).toContain("if (!childSettled) child.kill('SIGKILL')");
        expect(watchdog).not.toContain('if (!child.killed)');
        expect(watchdog.indexOf("child.kill('SIGTERM')")).toBeLessThan(watchdog.indexOf('onTimeout(err)'));
        expect(watchdog.indexOf("child.kill('SIGKILL')")).toBeLessThan(watchdog.indexOf('onTimeout(err)'));
        // AGG8b-14 (run-10 c8b) strengthened the cleanup: it is a no-op once
        // the timeout fired — markSettled/child.off are only reachable behind
        // the early-return guard, so kill escalation survives a late cleanup
        // AND the settle listeners stay attached to cancel the SIGKILL grace
        // timer on a late child exit. This preserves the intent originally
        // pinned here (no unconditional settle-in-cleanup after fire).
        const cleanupBody = watchdog.slice(watchdog.indexOf('return () => {'));
        expect(cleanupBody).toContain('if (fired) return;');
        expect(cleanupBody.indexOf('if (fired) return;')).toBeLessThan(cleanupBody.indexOf('markSettled()'));
        expect(cleanupBody.indexOf('if (fired) return;')).toBeLessThan(cleanupBody.indexOf("child.off('exit', markSettled)"));
    });

    it('keeps visitor keyword search imported directly from the public server-action module', () => {
        const src = readSrc('components/search.tsx');
        expect(src).toContain("import { searchImagesAction } from '@/app/actions/public'");
        expect(src).not.toContain("import { searchImagesAction } from '@/app/actions'");
    });

    it('does not prefetch photo detail routes from dense grids or hidden adjacent links', () => {
        // C2-19 (run-10 c2): the per-card <Link> moved from home-client.tsx's
        // inline orderedImages.map into the extracted, memoized MasonryCard.
        const masonryCard = readSrc('components/masonry-card.tsx');
        const photoPage = readSrc('app/[locale]/(public)/p/[id]/page.tsx');
        const viewer = readSrc('components/photo-viewer.tsx');
        const navigation = readSrc('components/photo-navigation.tsx');
        expect(masonryCard).toContain('prefetch={false}');
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
        expect(ko.privacy.analyticsDisabled).toContain('사진, 카테고리, 공유 갤러리 조회 이벤트');
        expect(ko.privacy.analyticsEnabled).not.toContain('짧은 클라이언트 지문');
    });
});
