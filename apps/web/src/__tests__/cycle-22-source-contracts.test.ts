import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSrc = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const readRoot = (rel: string) => readFileSync(resolve(__dirname, '..', '..', rel), 'utf8');
const readRepo = (rel: string) => readFileSync(resolve(__dirname, '..', '..', '..', '..', rel), 'utf8');

describe('cycle 22 source contracts', () => {
    it('normalizes MySQL advisory lock acquisition values at every acquisition site', () => {
        const helper = readSrc('lib/advisory-locks.ts');
        expect(helper).toContain('export function isAdvisoryLockAcquired(value: unknown): boolean');
        expect(helper).toContain("value === 1 || value === BigInt(1) || value === '1'");

        const acquisitionSources = [
            'lib/image-queue.ts',
            'lib/admin-backfill-runner.ts',
            'lib/upload-processing-contract-lock.ts',
            'scripts/backfill-color-pipeline.ts',
            'scripts/backfill-clip-embeddings.ts',
            'app/actions/embeddings.ts',
            'app/actions/admin-users.ts',
            'app/actions/topics.ts',
            'app/[locale]/admin/db-actions.ts',
        ];

        for (const rel of acquisitionSources) {
            const source = rel.startsWith('scripts/')
                ? readRoot(rel)
                : readSrc(rel);
            expect(source).toContain('isAdvisoryLockAcquired');
            expect(source).not.toMatch(/acquired\s*(?:===|!==)\s*1/);
            expect(source).not.toMatch(/acquired\s*(?:===|!==)\s*BigInt\(1\)/);
        }
    });

    it('keeps the destructive re-encode action behind an explicit confirmation dialog', () => {
        const source = readSrc('app/[locale]/admin/(protected)/settings/settings-client.tsx');
        expect(source).toContain('const [showBackfillConfirm, setShowBackfillConfirm] = useState(false)');
        expect(source).toContain('const runBackfill = () => {');
        expect(source).toContain('const handleBackfill = () => {');
        expect(source).toContain('setShowBackfillConfirm(true);');
        expect(source).toContain('<AlertDialog open={showBackfillConfirm}');
        expect(source).toContain("t('settings.backfillConfirmDesc')");
        expect(source).toContain("t('settings.backfillConfirmCta')");
        expect(source).toContain('event.preventDefault();');
    });

    it('requires acknowledgement before the one-time token plaintext dialog can close', () => {
        const source = readSrc('app/[locale]/admin/(protected)/tokens/tokens-client.tsx');
        const createDialog = source.slice(source.indexOf('{/* Create dialog */'), source.indexOf('{/* Show plaintext once */'));
        const plaintextDialog = source.slice(source.indexOf('{/* Show plaintext once */'), source.indexOf('{/* Revoke confirm dialog */'));

        expect(source).toContain("import { copyToClipboard } from '@/lib/clipboard'");
        expect(source).toContain('copyToClipboard(text).then((copied)');
        expect(createDialog).toContain('<DialogContent>');
        expect(createDialog).not.toContain('showCloseButton={false}');
        expect(plaintextDialog).toContain('<DialogContent showCloseButton={false}>');
        expect(plaintextDialog).toContain('disabled={!plaintextAcknowledged}');
    });

    it('keeps admin login renderable if the pre-login session probe fails', () => {
        const layout = readSrc('app/[locale]/admin/layout.tsx');
        const page = readSrc('app/[locale]/admin/page.tsx');
        expect(layout).toContain('try {');
        expect(layout).toContain('currentUser = await getCurrentUser()');
        expect(layout).toContain("console.error('Admin layout: failed to resolve current user', err)");
        expect(page).toContain('alreadyAdmin = await isAdmin()');
        expect(page).toContain("console.error('Admin login: failed to check current admin session', err)");
        expect(page).toContain('return <LoginForm />');
    });

    it('exposes the P3 gamut badge and route-error escape hatch to assistive tech', () => {
        const home = readSrc('components/home-client.tsx');
        expect(home).toContain('aria-label={t(\'viewer.gamutBadgeP3\')}');
        expect(home).toContain('title={t(\'viewer.gamutBadgeP3\')}');
        expect(home).not.toMatch(/className="gamut-p3-badge[\s\S]{0,220}aria-hidden="true"/);

        const routeError = readSrc('app/[locale]/error.tsx');
        expect(routeError).toContain('aria-label={t(\'nav.label\')}');
        expect(routeError).toContain('{t(\'nav.home\')}');
    });

    it('documents analytics boundaries, deploy entrypoints, and local env knobs consistently', () => {
        const readme = readRepo('README.md');
        expect(readme).toContain('without handing originals or AI features to a hosted SaaS');
        expect(readme).toContain('Google Analytics is optional and disabled unless you configure `google_analytics_id`');
        expect(readme).toContain('For:');
        expect(readme).toContain('Not for:');

        const appReadme = readRoot('README.md');
        expect(appReadme).toContain('Leave `google_analytics_id` empty to keep analytics fully first-party/self-hosted');

        const claude = readRepo('CLAUDE.md');
        expect(claude).toContain('Local/manual Docker smoke only');
        expect(claude).toContain('docker compose --env-file apps/web/.env.local -f apps/web/docker-compose.yml up -d --build');
        expect(claude).not.toContain('docker compose -f apps/web/docker-compose.yml up -d --build');

        const envExample = readRoot('.env.local.example');
        expect(envExample).toContain('ADMIN_BACKFILL_CONCURRENCY');
        expect(envExample).toContain('BACKFILL_CONCURRENCY');
        expect(envExample).toContain('UPLOAD_ORIGINAL_ROOT');
        expect(envExample).toContain('VIEW_RETENTION_DAYS');

        const clipPlan = readRepo('docs/superpowers/plans/2026-06-15-clip-semantic-search.md');
        expect(clipPlan).toContain('not operator runbooks');
    });

    it('keeps upload quota claims settled if awaited pre-ingest checks fail after claim', () => {
        const source = readSrc('app/actions/images.ts');
        const claimToProcessing = source.slice(
            source.indexOf('tracker.bytes += totalSize;'),
            source.indexOf('let successCount = 0;'),
        );

        expect(claimToProcessing).toContain('const settleClaim = (successfulFiles: number, successfulBytes: number)');
        expect(claimToProcessing).toContain('settleUploadTrackerClaim(uploadTracker, uploadTrackerKey, files.length, totalSize, successfulFiles, successfulBytes)');
        expect(claimToProcessing).toContain('Failed to inspect upload disk space');
        expect(claimToProcessing).toContain('The one-shot settleClaim helper owns all post-claim exits');
        expect(claimToProcessing).toContain('try {\n            [topicRow] = await db.select');
        expect(claimToProcessing).toContain('} catch (err) {\n            settleClaim(0, 0);');
    });
});
