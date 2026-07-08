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
const publicRestoreMaintenance = readFileSync(
    resolve(__dirname, '../components/public-restore-maintenance.tsx'),
    'utf8',
);
const enMessages = readFileSync(resolve(__dirname, '../../messages/en.json'), 'utf8');
const koMessages = readFileSync(resolve(__dirname, '../../messages/ko.json'), 'utf8');

describe('privacy page landmarks', () => {
    it('lets the public layout own the single main landmark', () => {
        expect(publicLayout).toContain('<main id="main-content"');
        expect(privacyPage).not.toContain('<main');
    });

    it('keeps shared restore-maintenance content layout-neutral', () => {
        expect(publicRestoreMaintenance).not.toContain('<main');
        expect(publicRestoreMaintenance).toContain('role="status"');
    });

    it('surfaces the public map tile-provider privacy dependency', () => {
        expect(privacyPage).toContain("t('mapTilesTitle')");
        expect(privacyPage).toContain("t('mapTilesBody')");
        expect(enMessages).toContain('"mapTilesTitle": "Map Tiles"');
        expect(enMessages).toContain('OpenStreetMap tile servers');
        expect(koMessages).toContain('"mapTilesTitle": "지도 타일"');
        expect(koMessages).toContain('OpenStreetMap 타일 서버');
    });
});
