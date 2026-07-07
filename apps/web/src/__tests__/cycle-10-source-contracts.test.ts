import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

function src(path: string) {
    return readFileSync(resolve(__dirname, '..', path), 'utf8');
}

describe('cycle 10 source contracts', () => {
    it('charges public analytics rate limits before public-target DB lookups', () => {
        const code = src('app/actions/public.ts');
        const admissionIdx = code.indexOf('async function buildRequestViewParams()');
        const rateLimitIdx = code.indexOf('checkViewRecordRateLimit', admissionIdx);
        expect(rateLimitIdx).toBeGreaterThan(admissionIdx);

        for (const fnName of ['recordPhotoView', 'recordTopicView', 'recordSharedGroupView']) {
            const start = code.indexOf(`export async function ${fnName}`);
            const end = code.indexOf('\n}\n', start);
            const body = code.slice(start, end);
            expect(body.indexOf('buildRequestViewParams')).toBeGreaterThan(0);
            expect(body.indexOf('checkViewRecordRateLimit')).toBeGreaterThan(body.indexOf('buildRequestViewParams'));
            expect(body.indexOf('checkViewRecordRateLimit')).toBeLessThan(body.indexOf('db.select'));
        }
    });

    it('captures public analytics request metadata before queueing background writes', () => {
        const code = src('app/actions/public.ts');
        expect(code).toContain('async function buildRequestViewParams()');
        expect(code).toContain('const requestHeaders = await headers();');
        expect(code).toContain('return buildViewParams(requestHeaders);');
        expect(code).toContain('trackAnalyticsDbWrite(async () => {');

        const firstQueueIdx = code.indexOf('trackAnalyticsDbWrite(async () => {');
        const queuedBody = code.slice(firstQueueIdx, code.indexOf('}).catch', firstQueueIdx));
        expect(queuedBody).not.toContain('await headers()');
        expect(queuedBody).not.toContain('checkViewRecordRateLimit');
    });

    it('restores pre-existing derivative files when a re-encode fails mid-run', () => {
        const code = src('lib/process-image.ts');

        expect(code).toContain('const backupFinalPaths = new Map<string, string>()');
        expect(code).toContain('async (outputPath: string)');
        expect(code).toContain('await fs.copyFile(outputPath, backupPath)');
        expect(code).toContain('const restorePreviousFinalPaths = async () =>');
        expect(code).toContain('await fs.rename(backupPath, outputPath)');
        expect(code).toContain('await restorePreviousFinalPaths();');
        expect(code).not.toContain('writtenSizedPaths');
    });

    it('uses throwing cleanup helpers after committed image deletions', () => {
        const actions = src('app/actions/images.ts');
        const uploadPaths = src('lib/upload-paths.ts');
        const processImage = src('lib/process-image.ts');

        expect(actions).toContain('cleanupPendingFileDeletion(pendingDeletionRef.current)');
        expect(actions).toContain('cleanupPendingFileDeletion(pendingDeletion)');
        expect(uploadPaths).toContain('export async function deleteOriginalUploadFileStrict');
        expect(processImage).toContain('export async function deleteImageVariantsStrict');
    });

    it('resolves upload tag records once per batch before per-file inserts', () => {
        const code = src('app/actions/images.ts');
        const resolveIdx = code.indexOf('const resolvedTagRecords: Array<{ id: number }> = []');
        const fileLoopIdx = code.indexOf('// Track saved original filename for cleanup on DB insert failure');
        const phaseIdx = code.indexOf('// Phase 3: Process Tags (batched)');

        expect(resolveIdx).toBeGreaterThan(0);
        expect(resolveIdx).toBeLessThan(fileLoopIdx);
        expect(phaseIdx).toBeGreaterThan(fileLoopIdx);
        expect(code.slice(phaseIdx, phaseIdx + 1200)).toContain('resolvedTagRecords.map');
        expect(code.slice(phaseIdx, phaseIdx + 1200)).not.toContain('ensureTagRecord');
    });

    it('aborts stale semantic search requests on the client and observes aborts server-side', () => {
        const client = src('components/search.tsx');
        const route = src('app/api/search/semantic/route.ts');

        expect(client).toContain('const semanticAbortRef = useRef<AbortController | null>(null)');
        expect(client).toContain('semanticAbortRef.current?.abort()');
        expect(client).toContain('signal: abortController.signal');
        expect(route).toContain('request.signal?.aborted === true');
        expect(route).toContain("status: 499");
    });

    it('keeps shared-group grid geometry finite and links named by photo title', () => {
        const code = src('app/[locale]/(public)/g/[key]/page.tsx');

        expect(code).toContain('const aspectWidth = image.width > 0 ? image.width : 1');
        expect(code).toContain('const aspectHeight = image.height > 0 ? image.height : 1');
        expect(code).toContain("aria-label={tAria('viewPhoto', { title: altText })}");
    });
});
