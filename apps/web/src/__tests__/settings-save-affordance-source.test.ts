import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
    resolve(__dirname, '../app/[locale]/admin/(protected)/settings/settings-client.tsx'),
    'utf8',
);

describe('settings save affordances', () => {
    it('keeps a repeated save action after the lower settings sections', () => {
        const saveHandlers = source.match(/handleSave\(\);/g) ?? [];

        expect(saveHandlers.length).toBeGreaterThanOrEqual(2);
        expect(source).toContain('<div className="flex justify-end border-t pt-4">');
        expect(source).toContain('className="min-h-11 gap-2"');
    });

    it('restores focus to the save button the user activated', () => {
        expect(source).toContain('const bottomSaveButtonRef = useRef<HTMLButtonElement>(null)');
        expect(source).toContain('const lastActivatedSaveRef = useRef<HTMLButtonElement | null>(null)');
        expect(source).toContain('useRestoreFocusAfterPending(lastActivatedSaveRef, isPending)');
        expect(source).toContain('lastActivatedSaveRef.current = saveButtonRef.current');
        expect(source).toContain('lastActivatedSaveRef.current = bottomSaveButtonRef.current');
        expect(source).not.toContain('useRestoreFocusAfterPending(saveButtonRef, isPending)');
    });
});
