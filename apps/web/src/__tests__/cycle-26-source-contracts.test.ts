import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'src');

function read(relativePath: string) {
    return readFileSync(join(ROOT, relativePath), 'utf8');
}

describe('cycle 26 source contracts', () => {
    it('custom modal surfaces isolate background accessibility trees', () => {
        const search = read('components/search.tsx');
        const lightbox = read('components/lightbox.tsx');
        const bottomSheet = read('components/info-bottom-sheet.tsx');
        const helper = read('components/use-modal-tree-isolation.ts');

        expect(helper).toContain("element.setAttribute('aria-hidden', 'true')");
        expect(helper).toContain('setInert(element, true)');
        expect(helper).toContain('element.removeAttribute');
        expect(search).toContain('useModalTreeIsolation(isOpen, modalRootRef)');
        expect(lightbox).toContain('useModalTreeIsolation(true, dialogRef)');
        expect(bottomSheet).toContain('useModalTreeIsolation(isOpen, modalRootRef)');
    });

    it('restore maintenance recovery command requires an explicit clear confirmation', () => {
        const script = readFileSync(join(process.cwd(), 'scripts/restore-maintenance-recovery.mjs'), 'utf8');
        const packageJson = readFileSync(join(process.cwd(), 'package.json'), 'utf8');
        const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');

        expect(packageJson).toContain('"restore:maintenance": "node scripts/restore-maintenance-recovery.mjs"');
        expect(dockerfile).toContain('restore-maintenance-recovery.mjs ./apps/web/scripts/restore-maintenance-recovery.mjs');
        expect(script).toContain("'--confirm-clear-restore-maintenance'");
        expect(script).toContain('Refusing to clear restore maintenance without');
        expect(script).toContain('clearMarker()');
    });

    it('admin layouts check restore maintenance before session auth lookups', () => {
        const adminLayout = read('app/[locale]/admin/layout.tsx');
        const protectedLayout = read('app/[locale]/admin/(protected)/layout.tsx');

        expect(adminLayout.indexOf('isRestoreMaintenanceActive()')).toBeLessThan(adminLayout.indexOf('getCurrentUser()'));
        expect(protectedLayout.indexOf('isRestoreMaintenanceActive()')).toBeLessThan(protectedLayout.indexOf('isAdmin()'));
    });

    it('restore finalizer does not reopen the process after durable marker clear failure', () => {
        const dbActions = read('app/[locale]/admin/db-actions.ts');
        const durable = read('lib/restore-maintenance-durable.ts');

        expect(durable).toMatch(/clearDurableRestoreMaintenance\(\);\s+endRestoreMaintenance\(\);/);
        expect(durable).not.toMatch(/finally\s*\{\s*endRestoreMaintenance\(\)/);
        expect(dbActions).toContain('Failed to clear durable restore maintenance marker; keeping restore maintenance active');
        expect(dbActions).toContain("restoreFinalizerResult = { success: false, error: t('restoreFailed'), keepMaintenance: true }");
        expect(dbActions).toContain('if (restoreMaintenanceEnded && (restoreLifecycleVerified || imageQueueQuiesced))');
    });

    it('lightbox color pip ties the disclosure trigger to a named panel region', () => {
        const source = read('components/lightbox-color-pip.tsx');

        expect(source).toContain('useId');
        expect(source).toContain('aria-controls={panelId}');
        expect(source).toContain('id={panelId}');
        expect(source).toContain('role="region"');
        expect(source).toContain("aria-label={t('aria.toggleColorPip')}");
    });

    it('shared group empty shares render the empty-state copy instead of processing copy', () => {
        const source = read('app/[locale]/(public)/g/[key]/page.tsx');

        expect(source).toContain("group.images.length === 0");
        expect(source).toContain("{t('empty')}");
        expect(source).not.toContain("{t('processing')}");
    });

    it('map fallback list carries the configured topic label instead of only the raw slug', () => {
        const page = read('app/[locale]/(public)/map/page.tsx');
        const client = read('components/map/map-client.tsx');

        expect(client).toContain('topic_label: string | null');
        expect(page).toContain('topic_label: img.topic_label ?? null');
        expect(page).toContain('{marker.topic_label ?? marker.topic}');
    });
});
