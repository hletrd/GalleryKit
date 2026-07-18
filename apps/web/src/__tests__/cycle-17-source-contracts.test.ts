import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = resolve(__dirname, '..', '..');
const repoRoot = resolve(appRoot, '..', '..');
const readApp = (rel: string) => readFileSync(resolve(appRoot, rel), 'utf8');
const readRepo = (rel: string) => readFileSync(resolve(repoRoot, rel), 'utf8');

describe('cycle 17 maintenance-lock and upload contracts', () => {
    it('drains in-app admin backfill during graceful shutdown', () => {
        const runnerSource = readApp('src/lib/admin-backfill-runner.ts');
        const instrumentationSource = readApp('src/instrumentation.ts');

        expect(runnerSource).toContain('activeRunPromise: Promise<void> | null');
        expect(runnerSource).toContain('export async function shutdownAdminBackfillRunner()');
        expect(runnerSource).toContain('const activeRunPromise = runBackfill(lockConnHandoff);');
        expect(runnerSource).toContain('state.activeRunPromise = activeRunPromise;');
        expect(instrumentationSource).toContain("const { shutdownAdminBackfillRunner } = await import('@/lib/admin-backfill-runner');");
        expect(instrumentationSource).toContain('shutdownAdminBackfillRunner()');
    });

    it('destroys pooled advisory-lock sessions when acquisition state is ambiguous', () => {
        const helperSource = readApp('src/lib/advisory-lock-release.ts');
        expect(helperSource).toContain('export function destroyPooledAdvisoryLockConnectionOnAcquireError');
        expect(helperSource).toContain('GET_LOCK (${label}) failed; destroying pooled connection');
        expect(helperSource).toContain('conn.destroy()');

        for (const rel of [
            'src/lib/upload-processing-contract-lock.ts',
            'src/app/actions/topics.ts',
            'src/app/actions/settings.ts',
            'src/app/actions/admin-users.ts',
            'src/app/actions/embeddings.ts',
            'src/lib/admin-backfill-runner.ts',
            'src/lib/image-queue.ts',
            'src/app/[locale]/admin/db-actions.ts',
        ]) {
            expect(readApp(rel), rel).toContain('destroyPooledAdvisoryLockConnectionOnAcquireError');
        }
    });

    it('returns structured DB backup and restore failures before child processes complete', () => {
        const source = readApp('src/app/[locale]/admin/db-actions.ts');
        expect(source).toContain("console.error('Failed to prepare backup directory:', err)");
        expect(source).toContain("console.error('Database backup failed before child process completed:', err)");
        expect(source).toContain("return { success: false as const, error: t('backupFailed') };");
        expect(source).toContain("console.error('Database restore connection acquisition failed:', err)");
        expect(source).toContain("console.error('Database restore failed before structured restore result:', err)");
        expect(source).toContain('restoreLockConnectionDestroyed = true');
        expect(source).toContain('if (!restoreLockConnectionDestroyed)');
    });

    it('settles Lightroom quota claims when upload storage setup fails', () => {
        const source = readApp('src/app/api/admin/lr/upload/route.ts');
        expect(source).toContain("import { acquireAdminMutationSlot } from '@/lib/admin-mutation-barrier';");
        expect(source).toContain('using mutationSlot = acquireAdminMutationSlot();');
        expect(source).toContain('if (!mutationSlot.acquired)');
        expect(source.indexOf('using mutationSlot = acquireAdminMutationSlot();')).toBeGreaterThan(
            source.indexOf('formData = await request.formData();'),
        );

        const ensureIdx = source.indexOf('await ensureUploadDirectories()');
        const failureWindow = source.slice(ensureIdx, ensureIdx + 700);

        expect(ensureIdx).toBeGreaterThan(-1);
        expect(failureWindow).toContain("console.error('LR upload: failed to prepare upload directories', err)");
        expect(failureWindow).toContain('settleTrackerToActual(false)');
        expect(failureWindow).toContain("Upload storage unavailable; retry shortly");
    });
});

describe('cycle 17 sidecar backfill contracts', () => {
    it('reads color-backfill settings only after the shared advisory lock and restore guard', () => {
        const source = readApp('scripts/backfill-color-pipeline.ts');
        const mainIdx = source.indexOf('async function main()');
        const mainSource = source.slice(mainIdx);
        const lockIdx = mainSource.indexOf('SELECT GET_LOCK(?, 10) AS acquired');
        const postLockGuardIdx = mainSource.indexOf('assertNoDurableRestoreMaintenanceForScript(SCRIPT_NAME)', lockIdx);
        const configIdx = mainSource.indexOf('const config = await getGalleryConfigDetachedStrict()');

        expect(mainIdx).toBeGreaterThan(-1);
        expect(lockIdx).toBeGreaterThan(-1);
        expect(postLockGuardIdx).toBeGreaterThan(lockIdx);
        expect(configIdx).toBeGreaterThan(postLockGuardIdx);
    });

    it('sidecar color backfill claims the per-image processing lock through persistence', () => {
        const source = readApp('scripts/backfill-color-pipeline.ts');
        expect(source).toContain("import { destroyPooledAdvisoryLockConnectionOnAcquireError, releasePooledAdvisoryLocks } from '../src/lib/advisory-lock-release';");
        expect(source).toContain('getImageProcessingLockName');
        expect(source).toContain('async function acquireImageProcessingClaim');
        expect(source).toContain('SELECT GET_LOCK(?, 0) AS acquired');
        expect(source).toContain('await flushBatch();');
        expect(source).toContain('await releaseImageProcessingClaim(row.id, claimConn)');
        expect(source.indexOf('const result = await reprocessRow(row, backfillSettings, rowExists);')).toBeGreaterThan(
            source.indexOf('claimConn = await acquireImageProcessingClaim(connection, row.id);'),
        );
        expect(source.indexOf('await releaseImageProcessingClaim(row.id, claimConn)')).toBeGreaterThan(
            source.indexOf('await flushBatch();'),
        );
    });

    it('caps actual CLIP embedding attempts without letting failed prefixes starve later rows', () => {
        const source = readApp('scripts/backfill-clip-embeddings.ts');
        expect(source).toContain('let attemptedEmbeddings = 0');
        expect(source).toContain('SEMANTIC_SCAN_LIMIT - attemptedEmbeddings');
        expect(source).toContain('if (!filenameOriginal) { failed++; failedImageIds.push(id); return; }');
        expect(source).toContain('if (!originalPath) { failed++; failedImageIds.push(id); return; }');
        expect(source).toContain('Missing-original rows advance the keyset cursor without');
        expect(source).toContain('attemptedEmbeddings++');
        expect(source).toContain('if (attemptedEmbeddings >= SEMANTIC_SCAN_LIMIT)');
    });
});

describe('cycle 17 operator-facing copy and routing contracts', () => {
    it('keeps root metadata icon routes out of locale proxying', () => {
        const source = readApp('src/proxy.ts');
        expect(source).toContain('icon(?:/)?$');
        expect(source).toContain('apple-icon(?:/)?$');
        expect(source).toContain('icons(?:/|$)');
    });

    it('shows destructive-dialog targets and localized analytics countries', () => {
        expect(readApp('src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx')).toContain('confirmRevokeLabel');
        expect(readApp('src/app/[locale]/admin/(protected)/categories/topic-manager.tsx')).toContain('topicLabel: editingTopic.label');

        const analyticsSource = readApp('src/app/[locale]/admin/(protected)/analytics/analytics-client.tsx');
        expect(analyticsSource).toContain('new Intl.DisplayNames([locale], { type: \'region\' })');
        expect(analyticsSource).toContain('unknownCountry');

        const en = readApp('messages/en.json');
        const ko = readApp('messages/ko.json');
        for (const source of [en, ko]) {
            expect(source).toContain('{label}');
            expect(source).toContain('{alias}');
            expect(source).toContain('unknownCountry');
        }
    });

    it('documents semantic-search stub limits and includes required copyright examples', () => {
        const en = readApp('messages/en.json');
        expect(en).toContain('Stub mode uses deterministic placeholder embeddings');
        expect(en).toContain("Production CLIP search can't be enabled here");
        expect(en).toContain('SEMANTIC_SEARCH_ALLOW_PRODUCTION');
        const copyright = String.fromCodePoint(0xa9);
        expect(readRepo('README.md')).toContain(`"copyright": "${copyright} 2026 Author Name"`);
        expect(readApp('src/site-config.example.json')).toContain(`"copyright": "${copyright} 2026 GalleryKit"`);
    });
});
