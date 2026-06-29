import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..', '..', '..');
const deployScript = readFileSync(resolve(repoRoot, 'apps/web/deploy.sh'), 'utf8');
const remoteDeployScript = readFileSync(resolve(repoRoot, 'scripts/deploy-remote.sh'), 'utf8');
const dockerfile = readFileSync(resolve(repoRoot, 'apps/web/Dockerfile'), 'utf8');
const rootDockerignore = readFileSync(resolve(repoRoot, '.dockerignore'), 'utf8');
const appDockerignore = readFileSync(resolve(repoRoot, 'apps/web/.dockerignore'), 'utf8');
const deploymentDocs = [
    deployScript,
    readFileSync(resolve(repoRoot, 'AGENTS.md'), 'utf8'),
    readFileSync(resolve(repoRoot, 'CLAUDE.md'), 'utf8'),
    readFileSync(resolve(repoRoot, 'README.md'), 'utf8'),
    readFileSync(resolve(repoRoot, 'apps/web/README.md'), 'utf8'),
].join('\n');

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
        expect(deploymentDocs).toContain('./public/uploads');
        expect(deploymentDocs).toContain('./public/resources');
        expect(deploymentDocs).not.toContain('./public -> /app/apps/web/public');
        expect(deploymentDocs).not.toContain('/apps/web/public:/app/apps/web/public');
    });

    it('keeps remote deploy target config-driven', () => {
        expect(remoteDeployScript).toContain('ROOT_DEPLOY_ENV_FILE="$ROOT_DIR/.env.deploy"');
        expect(remoteDeployScript).toContain('DEFAULT_DEPLOY_ENV_FILE="$HOME/.gallerykit-secrets/gallery-deploy.env"');
        expect(remoteDeployScript).toContain('DEPLOY_HOST');
        expect(remoteDeployScript).toContain('DEPLOY_USER');
        expect(remoteDeployScript).toContain('DEPLOY_PATH');
        expect(remoteDeployScript).not.toMatch(/ssh\s+[-\w\s]*[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/);
    });

    it('packages immutable public assets while runtime public data stays mounted narrowly', () => {
        expect(dockerfile).toContain('COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public');
        expect(dockerfile).toContain('mkdir -p apps/web/public/uploads apps/web/public/resources');
        expect(deploymentDocs).toContain('./public/uploads');
        expect(deploymentDocs).toContain('./public/resources');
        expect(deploymentDocs).toContain('immutable public assets');
    });

    it('keeps mutable public data out of Docker build contexts', () => {
        expect(rootDockerignore).toContain('apps/web/public/uploads/**');
        expect(rootDockerignore).toContain('apps/web/public/resources/**');
        expect(appDockerignore).toContain('public/uploads/**');
        expect(appDockerignore).toContain('public/resources/**');
    });

    it('pins explicit Docker native optional dependency installs to lockfile versions', () => {
        const nativeInstallBlock = dockerfile.match(/npm install --workspace=apps\/web --include=optional --no-save \\\n(?<body>[\s\S]*?)\n\nFROM build-base AS prod-deps/);
        expect(nativeInstallBlock?.groups?.body).toBeTruthy();
        const packageTokens = nativeInstallBlock!.groups!.body
            .split(/\\\n/)
            .map((line) => line.trim())
            .filter(Boolean);

        for (const token of packageTokens) {
            expect(token, token).toMatch(/@\d+\.\d+\.\d+$/);
        }
    });
});
