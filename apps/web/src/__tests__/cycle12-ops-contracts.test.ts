import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..', '..', '..');

describe('cycle 12 operational proof surfaces', () => {
    it('keeps production dependency audit in the default quality workflow', () => {
        const quality = readFileSync(resolve(ROOT, '.github/workflows/quality.yml'), 'utf8');
        expect(quality).toContain('npm audit --workspace=apps/web --omit=dev --audit-level=moderate');
    });

    it('pins Docker production bases to the reviewed node:24-slim digest', () => {
        const dockerfile = readFileSync(resolve(ROOT, 'apps/web/Dockerfile'), 'utf8');
        const pinnedBase = 'node:24-slim@sha256:b31e7a42fdf8b8aa5f5ed477c72d694301273f1069c5a2f71d53c6482e99a2fc';
        expect(dockerfile.match(new RegExp(`FROM ${pinnedBase}`, 'g'))?.length).toBe(2);
        expect(dockerfile).toContain('docker buildx imagetools inspect node:24-slim');
    });

    it('exposes a non-destructive public-edge proxy topology probe', () => {
        const rootPackage = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
            scripts: Record<string, string>;
        };
        const script = readFileSync(resolve(ROOT, 'scripts/check-proxy-topology.mjs'), 'utf8');
        expect(rootPackage.scripts['check:proxy-topology']).toContain('scripts/check-proxy-topology.mjs');
        expect(script).toContain('/api/search/semantic');
        expect(script).toContain("'X-Forwarded-Host': 'attacker.invalid'");
        expect(script).toContain("'X-Forwarded-Proto'");
        expect(script).toContain("'X-Forwarded-For'");
        expect(script).toContain('TRUST_PROXY=true');
        expect(script).toContain("'Content-Type': 'application/json'");
        expect(script).toContain("JSON.stringify({ query: '', topK: 1 })");
        expect(script).toContain('client-IP/rate-limit handling');
        expect(script).toContain('unexpected HTTP ${status}');
        expect(script).not.toContain("'Content-Type': 'text/plain'");
    });

    it('keeps E2E runtime BASE_URL aligned with the local Playwright origin', () => {
        const script = readFileSync(resolve(ROOT, 'apps/web/scripts/run-e2e-server.mjs'), 'utf8');
        expect(script).toContain('const runtimeBaseUrl = `http://${host}:${port}`');
        expect(script).toContain('BASE_URL: runtimeBaseUrl');
        expect(script).toContain("E2E_PUBLIC_BASE_URL || 'https://gallerykit-e2e.invalid'");
    });

    it('runs real-model CLIP preflight from a durable scheduled/manual workflow', () => {
        const workflow = readFileSync(resolve(ROOT, '.github/workflows/clip-preflight.yml'), 'utf8');
        expect(workflow).toContain('workflow_dispatch');
        expect(workflow).toContain('schedule:');
        expect(workflow).toContain('CLIP_MODELS_ROOT');
        expect(workflow).toContain('CLIP_OFFLINE_LOAD: "1"');
        expect(workflow).toContain('CLIP_INTEGRATION: "1"');
        expect(workflow).toContain('scripts/download-clip-models.ts');
        expect(workflow).toContain('npm run test:clip:preflight');
    });
});
