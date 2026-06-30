import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSrc = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const readRoot = (rel: string) => readFileSync(resolve(__dirname, '..', '..', rel), 'utf8');

describe('cycle 21 source contracts', () => {
    it('similar photo fallback labels include the image id, not repeated generic Photo text', () => {
        const src = readSrc('components/similar-photos.tsx');
        expect(src).toContain('`${tCommon(\'photo\')} ${item.imageId}`');
        expect(src).not.toContain("?? tCommon('photo');");
    });

    it('settings client renders persistent field errors tied to invalid inputs', () => {
        const src = readSrc('app/[locale]/admin/(protected)/settings/settings-client.tsx');
        expect(src).toContain('const [fieldErrors, setFieldErrors]');
        expect(src).toContain('aria-invalid={!!fieldErrors.image_quality_webp}');
        expect(src).toContain('role="alert"');
        expect(src).toContain("toast.error(t('settings.validationFailed'))");
    });

    it('admin users page has one card chrome instead of nesting the manager in another Card', () => {
        const manager = readSrc('components/admin-user-manager.tsx');
        expect(manager).not.toContain('<Card>');
        expect(manager).toContain('<h2 className="text-lg font-semibold">');
    });

    it('rate-limit comments say disabled semantic responses remain charged after mode lookup', () => {
        const src = readSrc('lib/rate-limit.ts');
        expect(src).toContain('Disabled/stub-mode responses');
        expect(src).not.toContain('for example disabled mode');
    });

    it('proxy admin-route protection has no dead exact-login nested branch', () => {
        const src = readSrc('proxy.ts');
        expect(src).toContain('LOCALES.some((locale) => pathname.startsWith(`/${locale}/admin/`))');
        expect(src).not.toContain('pathname === `/${locale}/admin`');
    });

    it('visible copy describes EXIF alt-text hints, not a real auto-captioning feature', () => {
        const en = readRoot('messages/en.json');
        const ko = readRoot('messages/ko.json');
        expect(en).toContain('EXIF Alt-Text Hints');
        expect(en).toContain('Enable EXIF alt-text hints');
        expect(ko).toContain('EXIF 대체 텍스트 힌트');
    });

    it('manual Docker examples load the app env file explicitly', () => {
        const rootReadme = readRoot('../../README.md');
        expect(rootReadme).toContain('docker compose --env-file apps/web/.env.local -f apps/web/docker-compose.yml up -d --build');
        expect(rootReadme).not.toContain('docker compose -f apps/web/docker-compose.yml up -d --build');
    });

    it('CLIP sidecar examples use deploy-root placeholders instead of one host path', () => {
        const claude = readRoot('../../CLAUDE.md');
        expect(claude).toContain('<deploy-root>/apps/web/src:/app/apps/web/src:ro');
        expect(claude).not.toContain('/home/ubuntu/gallery/apps/web/src:/app/apps/web/src:ro');
    });
});
