import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptPath = resolve(__dirname, '..', '..', 'scripts', 'ensure-site-config.mjs');
const tmpRoots: string[] = [];

function makeProject(config?: unknown) {
    const root = mkdtempSync(join(tmpdir(), 'gk-site-config-'));
    tmpRoots.push(root);
    if (config !== undefined) {
        mkdirSync(join(root, 'src'), { recursive: true });
        writeFileSync(join(root, 'src', 'site-config.json'), JSON.stringify(config), 'utf8');
    }
    return root;
}

function runValidator(cwd: string, env: Record<string, string | undefined> = {}) {
    return spawnSync(process.execPath, [scriptPath], {
        cwd,
        env: {
            ...process.env,
            NODE_ENV: 'production',
            BASE_URL: '',
            ...env,
        },
        encoding: 'utf8',
    });
}

afterEach(() => {
    while (tmpRoots.length > 0) {
        const root = tmpRoots.pop();
        if (root) rmSync(root, { recursive: true, force: true });
    }
});

describe('ensure-site-config production validation', () => {
    it('fails when src/site-config.json is missing', () => {
        const result = runValidator(makeProject());
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Missing required src/site-config.json');
    });

    it('fails when production URL is missing', () => {
        const result = runValidator(makeProject({ title: 'Gallery', url: '' }));
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Missing production base URL');
    });

    it('fails for placeholder hosts', () => {
        const result = runValidator(makeProject({ title: 'Gallery', url: 'https://example.com' }));
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('placeholder base URL');
    });

    it('fails for non-http and relative URLs', () => {
        const fileResult = runValidator(makeProject({ title: 'Gallery', url: 'file:///tmp/gallery' }));
        expect(fileResult.status).toBe(1);
        expect(fileResult.stderr).toContain('must use http or https');

        const relativeResult = runValidator(makeProject({ title: 'Gallery', url: '/gallery' }));
        expect(relativeResult.status).toBe(1);
        expect(relativeResult.stderr).toContain('must be absolute');
    });

    it('passes when BASE_URL overrides an example config with a real URL', () => {
        const result = runValidator(
            makeProject({ title: 'Gallery', url: 'https://example.com' }),
            { BASE_URL: 'https://gallerykit-ci.invalid' },
        );
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
    });
});

