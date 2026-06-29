import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const privacyPage = readFileSync(
    resolve(__dirname, '../app/[locale]/(public)/privacy/page.tsx'),
    'utf8',
);
const publicLayout = readFileSync(
    resolve(__dirname, '../app/[locale]/(public)/layout.tsx'),
    'utf8',
);

describe('privacy page landmarks', () => {
    it('lets the public layout own the single main landmark', () => {
        expect(publicLayout).toContain('<main id="main-content"');
        expect(privacyPage).not.toContain('<main');
    });
});
