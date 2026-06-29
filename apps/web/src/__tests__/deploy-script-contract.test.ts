import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..', '..', '..');
const deployScript = readFileSync(resolve(repoRoot, 'apps/web/deploy.sh'), 'utf8');
const remoteDeployScript = readFileSync(resolve(repoRoot, 'scripts/deploy-remote.sh'), 'utf8');

describe('deploy script safety contract', () => {
    it('starts the stack before pruning Docker artifacts', () => {
        const upIndex = deployScript.indexOf('docker compose -f apps/web/docker-compose.yml up -d --build');
        expect(upIndex).toBeGreaterThan(-1);
        for (const command of [
            'docker container prune -f',
            'docker image prune -af',
            'docker builder prune -af',
            'docker volume prune -f',
        ]) {
            const pruneIndex = deployScript.indexOf(command);
            expect(pruneIndex, command).toBeGreaterThan(-1);
            expect(pruneIndex, command).toBeGreaterThan(upIndex);
        }
    });

    it('never uses automatic all-volume pruning', () => {
        expect(deployScript).not.toMatch(/docker\s+volume\s+prune\s+-(?:[a-z]*a|-[^\n]*\ball\b)/);
    });

    it('documents only narrow mutable public bind mounts as persistent', () => {
        expect(deployScript).toContain('./public/uploads');
        expect(deployScript).toContain('./public/resources');
        expect(deployScript).not.toContain('./public -> /app/apps/web/public');
    });

    it('keeps remote deploy target config-driven', () => {
        expect(remoteDeployScript).toContain('ROOT_DEPLOY_ENV_FILE="$ROOT_DIR/.env.deploy"');
        expect(remoteDeployScript).toContain('DEFAULT_DEPLOY_ENV_FILE="$HOME/.gallerykit-secrets/gallery-deploy.env"');
        expect(remoteDeployScript).toContain('DEPLOY_HOST');
        expect(remoteDeployScript).toContain('DEPLOY_USER');
        expect(remoteDeployScript).toContain('DEPLOY_PATH');
        expect(remoteDeployScript).not.toMatch(/ssh\s+[-\w\s]*[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/);
    });
});

