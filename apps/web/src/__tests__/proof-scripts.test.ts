import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PACKAGE_JSON = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
    scripts: Record<string, string>;
};
const APP_README = readFileSync(resolve(__dirname, '../../README.md'), 'utf8');
const CLAUDE = readFileSync(resolve(__dirname, '../../../../CLAUDE.md'), 'utf8');

describe('manual proof scripts', () => {
    it('exposes a command for authenticated admin browser proof', () => {
        expect(PACKAGE_JSON.scripts['test:e2e:admin']).toContain('E2E_ADMIN_ENABLED=true');
        expect(PACKAGE_JSON.scripts['test:e2e:admin']).toContain('e2e/admin.spec.ts');
        expect(PACKAGE_JSON.scripts['test:e2e:admin']).toContain('e2e/origin-guard.spec.ts');
        expect(APP_README).toContain('npm run test:e2e:admin');
        expect(CLAUDE).toContain('npm run test:e2e:admin --workspace=apps/web');
    });

    it('exposes a single CLIP production preflight command that requires seeded weights', () => {
        expect(PACKAGE_JSON.scripts['test:clip:preflight']).toContain('CLIP_MODELS_ROOT');
        expect(PACKAGE_JSON.scripts['test:clip:preflight']).toContain('CLIP_OFFLINE_LOAD=1');
        expect(PACKAGE_JSON.scripts['test:clip:preflight']).toContain('CLIP_INTEGRATION=1');
        expect(APP_README).toContain('npm run test:clip:preflight');
        expect(CLAUDE).toContain('npm run test:clip:preflight');
    });
});
