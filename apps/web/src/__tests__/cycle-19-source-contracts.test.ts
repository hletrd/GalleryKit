import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSafePositiveInteger } from '@/lib/validation';

const readSrc = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const readRoot = (rel: string) => readFileSync(resolve(__dirname, '..', '..', rel), 'utf8');

describe('cycle 19 source contracts', () => {
    it('keeps DB child processes under a watchdog', () => {
        const src = readSrc('app/[locale]/admin/db-actions.ts');
        const watchdog = readSrc('lib/db-child-watchdog.ts');
        expect(watchdog).toContain('DB_CHILD_PROCESS_TIMEOUT_MS');
        expect(src).toContain("import { armDbChildProcessWatchdog } from \"@/lib/db-child-watchdog\"");
        expect(src).toContain("armDbChildProcessWatchdog(dump, 'mysqldump backup'");
        expect(src).toContain("armDbChildProcessWatchdog(restore, 'mysql restore import'");
        expect(src).toContain("armDbChildProcessWatchdog(migrate, 'post-restore migration'");
    });

    it('keeps topic delete success independent from best-effort image cleanup', () => {
        const src = readSrc('app/actions/topics.ts');
        const deleteTopicBody = src.slice(src.indexOf('export async function deleteTopic'), src.indexOf('export async function createTopicAlias'));
        expect(src).toContain("console.warn('Topic deleted but topic image cleanup failed'");
        expect(deleteTopicBody.indexOf('await deleteTopicImage(deletedImageFilename)')).toBeLessThan(deleteTopicBody.indexOf("logAuditEvent(currentUser?.id ?? null, 'topic_delete'"));
        expect(deleteTopicBody.indexOf("logAuditEvent(currentUser?.id ?? null, 'topic_delete'")).toBeLessThan(deleteTopicBody.indexOf('revalidateAllAppData();'));
    });

    it('resets bulk-edit draft state when the parent closes the dialog', () => {
        const src = readSrc('components/bulk-edit-dialog.tsx');
        const managerSrc = readSrc('components/image-manager.tsx');
        expect(src).toContain("import { useCallback, useState } from 'react'");
        expect(src).toContain('if (!nextOpen) resetState();');
        expect(src).toContain('const submitted = await onSubmit(input);');
        expect(src).toContain('if (submitted !== false)');
        expect(managerSrc).toContain('return true;');
        expect(managerSrc).toContain('return false;');
    });

    it('names the zoom focus target with the current photo identity', () => {
        const zoomSrc = readSrc('components/image-zoom.tsx');
        const viewerSrc = readSrc('components/photo-viewer.tsx');
        expect(zoomSrc).toContain('accessibleName?: string');
        expect(zoomSrc).toContain('const zoomAriaLabel = accessibleName ?');
        expect(viewerSrc).toContain('const primaryPhotoAccessibleName = getConcisePhotoAltText');
        expect(viewerSrc).toContain('accessibleName={primaryPhotoAccessibleName}');
    });

    it('binds mobile photo swipes to the media container, not window', () => {
        const navSrc = readSrc('components/photo-navigation.tsx');
        const viewerSrc = readSrc('components/photo-viewer.tsx');
        expect(navSrc).toContain('swipeTargetRef');
        expect(navSrc).toContain("swipeTarget.addEventListener('touchstart'");
        expect(navSrc).not.toContain("window.addEventListener('touchstart'");
        expect(viewerSrc).toContain('swipeTargetRef={mediaContainerRef}');
    });

    it('keeps similar-photo failures visible and localized', () => {
        const src = readSrc('components/similar-photos.tsx');
        const en = JSON.parse(readRoot('messages/en.json')) as { search: Record<string, string> };
        const ko = JSON.parse(readRoot('messages/ko.json')) as { search: Record<string, string> };
        expect(src).toContain("results === 'error'");
        expect(src).toContain("t('similarError')");
        expect(en.search.similarError).toBeTruthy();
        expect(ko.search.similarError).toBeTruthy();
    });

    it('caps failed-image dashboard queries', () => {
        const src = readSrc('lib/data.ts');
        expect(src).toContain('FAILED_IMAGES_DASHBOARD_LIMIT = 50');
        expect(src).toContain('.limit(effectiveLimit)');
    });

    it('writes topic-image scratch files outside public resources by default', () => {
        const src = readSrc('lib/process-topic-image.ts');
        expect(src).toContain('data/tmp/topic-resources');
        expect(src).toContain('TOPIC_TMP_ROOT');
        expect(src).toContain('path.join(TOPIC_TMP_ROOT, `tmp-${id}`)');
        expect(src).toContain('[TOPIC_TMP_ROOT, RESOURCES_DIR]');
    });

    it('pins upload fallback routes to the Node runtime', () => {
        expect(readSrc('app/uploads/[...path]/route.ts')).toContain("export const runtime = 'nodejs'");
        expect(readSrc('app/[locale]/(public)/uploads/[...path]/route.ts')).toContain("export const runtime = 'nodejs'");
    });

    it('uses safe public positive integer parsing for public route IDs', () => {
        expect(parseSafePositiveInteger('9007199254740993')).toBeNull();
        expect(parseSafePositiveInteger('42')).toBe(42);
        for (const rel of [
            'app/[locale]/(public)/p/[id]/page.tsx',
            'app/[locale]/(public)/g/[key]/page.tsx',
            'app/api/search/similar/[id]/route.ts',
            'app/api/og/photo/[id]/route.tsx',
        ]) {
            expect(readSrc(rel)).toContain('parseSafePositiveInteger');
        }
    });

    it('keeps revoke-confirm cancel disabled while revocation is pending', () => {
        const src = readSrc('app/[locale]/admin/(protected)/tokens/tokens-client.tsx');
        expect(src).toContain('onOpenChange={(open) => { if (!open && !isPending) setConfirmRevokeId(null); }}');
        expect(src).toContain('onClick={() => setConfirmRevokeId(null)} disabled={isPending}');
    });

    it('renders EXIF key/value metadata as description lists', () => {
        for (const rel of ['components/photo-viewer.tsx', 'components/info-bottom-sheet.tsx']) {
            const src = readSrc(rel);
            expect(src).toContain('<dl className="grid grid-cols-2 gap-y-4 gap-x-2 text-sm">');
            expect(src).toContain('<dt className="text-muted-foreground text-xs">{t(\'viewer.camera\')}</dt>');
            expect(src).toContain('<dd className="font-medium');
            expect(src).toContain('</dl>');
        }
    });
});
