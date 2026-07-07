import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import enMessages from '../../messages/en.json';
import koMessages from '../../messages/ko.json';

/**
 * Run-10 cycle-1 e2e-gate discoveries (C1-35 / C1-36): two shared-link
 * runtime failures shipped by a run that never executed the Playwright gate.
 * Unit tests mock the db and the translator, so BOTH bugs were invisible to
 * the unit suite — these contracts pin the fixed shapes at the source level.
 */

describe('C1-35: shared-link tag_concat SEPARATOR must be a string literal', () => {
    const dataSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'data.ts'), 'utf8');
    const dbActionsSource = fs.readFileSync(
        path.join(__dirname, '..', 'app', '[locale]', 'admin', 'db-actions.ts'),
        'utf8',
    );

    it('does not use the invalid SEPARATOR CHAR(1) expression form', () => {
        // MySQL's GROUP_CONCAT SEPARATOR clause accepts ONLY a string literal;
        // `SEPARATOR CHAR(1)` is an ER_PARSE_ERROR that 500'd every /s/[key]
        // shared-link photo render.
        expect(dataSource).not.toMatch(/SEPARATOR\s+CHAR\(1\)/);
        expect(dbActionsSource).not.toMatch(/SEPARATOR\s+CHAR\(1\)/);
    });

    it('embeds the outer separator as a quoted literal and splits on the same character', () => {
        expect(dataSource).toContain("const TAG_CONCAT_OUTER_SEPARATOR = '\\u0001';");
        expect(dataSource).toMatch(/SEPARATOR \$\{sql\.raw\(`'\$\{TAG_CONCAT_OUTER_SEPARATOR\}'`\)\}/);
        // Consumer splits on the same code point (\x01 === ).
        expect(dataSource).toMatch(/tag_concat\.split\('\\x01'\)/);
    });

    it('admin CSV export uses a quoted tag separator literal and splits on the same character', () => {
        expect(dbActionsSource).toContain("const CSV_TAG_SEPARATOR = '\\u0001';");
        expect(dbActionsSource).toMatch(/SEPARATOR \$\{sql\.raw\(`'\$\{CSV_TAG_SEPARATOR\}'`\)\}/);
        expect(dbActionsSource).toContain("row.tags.split('\\x01').join(', ')");
    });
});

describe('C1-36: sharedGroup namespace carries every key the /g/[key] page renders', () => {
    it('backToSharedPhotos exists in the sharedGroup namespace in both locales', () => {
        // The page calls getTranslations('sharedGroup') and rendered
        // t('backToSharedPhotos') — but the key only existed under the
        // sibling `shared` namespace, producing MISSING_MESSAGE errors on
        // every shared-group photo view. Key-parity tests compare en↔ko key
        // SETS, so a key missing from BOTH locales passes them.
        expect((enMessages as unknown as Record<string, Record<string, string>>).sharedGroup.backToSharedPhotos).toBeTruthy();
        expect((koMessages as unknown as Record<string, Record<string, string>>).sharedGroup.backToSharedPhotos).toBeTruthy();
    });

    it('the /g/[key] page only renders sharedGroup keys that exist', () => {
        const pageSource = fs.readFileSync(
            path.join(__dirname, '..', 'app', '[locale]', '(public)', 'g', '[key]', 'page.tsx'),
            'utf8',
        );
        const sharedGroupKeys = new Set(Object.keys((enMessages as unknown as Record<string, Record<string, string>>).sharedGroup));
        // Match direct translator calls: t('key') / tShared('key', ...).
        const keyPattern = /\bt(?:Shared)?\('([A-Za-z0-9_.]+)'/g;
        for (const match of pageSource.matchAll(keyPattern)) {
            const key = match[1];
            // Only enforce keys without a namespace dot (namespaced lookups
            // go through other translators).
            if (key.includes('.')) continue;
            if (!sharedGroupKeys.has(key)) {
                // Allow keys that belong to the other translators used on the
                // page (common/aria) — only fail when NO namespace carries it.
                const en = enMessages as unknown as Record<string, Record<string, string>>;
                const carried = ['common', 'aria', 'photo', 'shared'].some((ns) => en[ns] && key in en[ns]);
                expect(carried, `sharedGroup page renders unknown key '${key}'`).toBe(true);
            }
        }
    });
});
