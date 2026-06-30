import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..', '..', '..');
const deployScript = readFileSync(resolve(repoRoot, 'apps/web/deploy.sh'), 'utf8');
const remoteDeployScript = readFileSync(resolve(repoRoot, 'scripts/deploy-remote.sh'), 'utf8');
const dockerfile = readFileSync(resolve(repoRoot, 'apps/web/Dockerfile'), 'utf8');
const entrypointScript = readFileSync(resolve(repoRoot, 'apps/web/scripts/entrypoint.sh'), 'utf8');
const composeConfig = readFileSync(resolve(repoRoot, 'apps/web/docker-compose.yml'), 'utf8');
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
        const upIndex = deployScript.indexOf('docker compose --env-file apps/web/.env.local -f apps/web/docker-compose.yml up -d --build');
        const healthIndex = deployScript.indexOf('Waiting for gallerykit-web health');
        expect(upIndex).toBeGreaterThan(-1);
        expect(healthIndex).toBeGreaterThan(upIndex);
        for (const command of [
            'docker container prune -f',
            'docker image prune -af',
            'docker builder prune -af',
            'docker volume prune -f',
        ]) {
            const pruneIndex = deployScript.indexOf(command);
            expect(pruneIndex, command).toBeGreaterThan(-1);
            expect(pruneIndex, command).toBeGreaterThan(healthIndex);
        }
    });

    it('fails deploy before prune when the new container is not healthy', () => {
        const healthIndex = deployScript.indexOf('Waiting for gallerykit-web health');
        const failureIndex = deployScript.indexOf('gallerykit-web did not become healthy');
        const logsIndex = deployScript.indexOf('docker logs --tail 120 gallerykit-web');
        const pruneIndex = deployScript.indexOf('docker image prune -af');

        expect(healthIndex).toBeGreaterThan(-1);
        expect(deployScript).toContain('docker inspect');
        expect(deployScript).toContain('http://127.0.0.1:3000/api/live');
        expect(failureIndex).toBeGreaterThan(healthIndex);
        expect(logsIndex).toBeGreaterThan(failureIndex);
        expect(pruneIndex).toBeGreaterThan(logsIndex);
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

    it('refuses group/world-readable deploy env files before sourcing', () => {
        const checkIndex = remoteDeployScript.indexOf('if (( env_group_perms != 0 || env_world_perms != 0 )); then');
        const sourceIndex = remoteDeployScript.indexOf('source "$ENV_FILE"');

        expect(remoteDeployScript).toContain('env_group_perms=$(((env_perms / 10) % 10))');
        expect(remoteDeployScript).toContain('env_world_perms=$((env_perms % 10))');
        expect(checkIndex).toBeGreaterThan(-1);
        expect(sourceIndex).toBeGreaterThan(-1);
        expect(checkIndex).toBeLessThan(sourceIndex);
        expect(remoteDeployScript).toContain('Run: chmod 600 \\"$ENV_FILE\\"');
    });

    it('feeds Docker Compose the runtime env file and forwards build-time upload limits', () => {
        expect(deployScript).toContain('docker compose --env-file apps/web/.env.local -f apps/web/docker-compose.yml up -d --build');
        expect(composeConfig).toContain('NEXT_UPLOAD_BODY_MAX_BYTES: ${NEXT_UPLOAD_BODY_MAX_BYTES:-}');
        expect(dockerfile).toContain('ARG NEXT_UPLOAD_BODY_MAX_BYTES');
        expect(dockerfile).toContain('ENV NEXT_UPLOAD_BODY_MAX_BYTES=${NEXT_UPLOAD_BODY_MAX_BYTES}');
        expect(deploymentDocs).toContain('NEXT_UPLOAD_BODY_MAX_BYTES=278921216');
        expect(deploymentDocs).toContain('BASE_URL`, `IMAGE_BASE_URL`, `UPLOAD_MAX_TOTAL_BYTES`, or `NEXT_UPLOAD_BODY_MAX_BYTES`');
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

    it('does not recursively chown large bind-mounted data during normal startup', () => {
        expect(entrypointScript).toContain('ensure_node_writable_dir');
        expect(entrypointScript).toContain('gosu node sh -c "test -w');
        expect(entrypointScript).not.toContain('chown -R node:node /app/data');
        expect(entrypointScript).not.toContain('chown -R node:node /app/apps/web/public/uploads');
        expect(entrypointScript).not.toContain('chown -R node:node /app/apps/web/public/resources');
        expect(entrypointScript).not.toContain('chown -R node:node /app/apps/web/.next');
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
