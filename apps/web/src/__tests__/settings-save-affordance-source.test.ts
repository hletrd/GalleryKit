import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
    resolve(__dirname, '../app/[locale]/admin/(protected)/settings/settings-client.tsx'),
    'utf8',
);

describe('settings save affordances', () => {
    it('keeps a repeated save action after the lower settings sections', () => {
        const saveHandlers = source.match(/onClick=\{handleSave\}/g) ?? [];

        expect(saveHandlers.length).toBeGreaterThanOrEqual(2);
        expect(source).toContain('<div className="flex justify-end border-t pt-4">');
        expect(source).toContain('className="min-h-11 gap-2"');
    });
});

