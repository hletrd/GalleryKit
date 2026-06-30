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
        const script = readFileSync(join(process.cwd(), 'scripts/restore-maintenance-recovery.ts'), 'utf8');
        const packageJson = readFileSync(join(process.cwd(), 'package.json'), 'utf8');

        expect(packageJson).toContain('"restore:maintenance": "tsx scripts/restore-maintenance-recovery.ts"');
        expect(script).toContain("'--confirm-clear-restore-maintenance'");
        expect(script).toContain('Refusing to clear restore maintenance without');
        expect(script).toContain('clearDurableRestoreMaintenanceForRecovery()');
    });
});
