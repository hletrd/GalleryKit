import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const settingsSource = readFileSync(
    resolve(__dirname, '..', 'app', 'actions', 'settings.ts'),
    'utf-8',
);

describe('settings image_sizes locking', () => {
    const imageSizesBlock = settingsSource.slice(
        settingsSource.indexOf("hasOwnProperty.call(sanitizedSettings, 'image_sizes')"),
        settingsSource.indexOf('try {', settingsSource.indexOf("hasOwnProperty.call(sanitizedSettings, 'image_sizes')")),
    );

    it('locks output-size changes once any image row exists', () => {
        expect(imageSizesBlock).toMatch(/from\(images\)[\s\S]*\.limit\(1\)/);
    });

    it('does not only lock after processed images exist', () => {
        expect(imageSizesBlock).not.toMatch(/images\.processed/);
    });
});
