import { existsSync } from 'node:fs';
import { cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function parseArgs(argv) {
  const args = new Map();
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) args.set(match[1], match[2]);
  }
  return args;
}

function resolveEnvPath() {
  const repoLocalEnvPath = path.resolve(appDir, '.env.local');
  const externalDefaultEnvPath = path.resolve(process.env.HOME || process.cwd(), '.gallerykit-secrets/gallery-web.env.local');
  return process.env.E2E_ENV_FILE
    ? path.resolve(process.env.E2E_ENV_FILE)
    : (existsSync(repoLocalEnvPath) ? repoLocalEnvPath : externalDefaultEnvPath);
}

function loadDotenvAsData() {
  const envPath = resolveEnvPath();
  if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
  }
}

function commandEnv(extra = {}) {
  const env = {
    ...process.env,
    TRUST_PROXY: 'true',
    ...extra,
  };
  delete env.NO_COLOR;
  delete env.FORCE_COLOR;
  return env;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: appDir,
      stdio: 'inherit',
      shell: false,
      env: commandEnv(options.env),
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? code}`));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const host = args.get('host') || '127.0.0.1';
  const port = args.get('port') || process.env.E2E_PORT || '3100';
  if (!/^(?:127\.0\.0\.1|localhost)$/.test(host)) {
    throw new Error(`Unsafe E2E host: ${host}`);
  }
  if (!/^\d{1,5}$/.test(port)) {
    throw new Error(`Unsafe E2E port: ${port}`);
  }

  loadDotenvAsData();
  await run('npm', ['run', 'init']);
  await run('npm', ['run', 'e2e:seed']);
  await run('npm', ['run', 'build'], {
    env: {
      // Local E2E builds need a non-placeholder public URL for metadata/site
      // config generation, but the server itself still listens on localhost.
      BASE_URL: process.env.E2E_PUBLIC_BASE_URL || 'https://gallerykit-e2e.invalid',
    },
  });

  await rm(path.join(appDir, '.next/standalone/apps/web/.next/static'), { recursive: true, force: true });
  await cp(path.join(appDir, '.next/static'), path.join(appDir, '.next/standalone/apps/web/.next/static'), { recursive: true });

  const server = spawn(process.execPath, ['.next/standalone/apps/web/server.js'], {
    cwd: appDir,
    stdio: 'inherit',
    shell: false,
    env: commandEnv({ HOSTNAME: host, PORT: port }),
  });

  const stopServer = () => {
    if (!server.killed) server.kill('SIGTERM');
  };
  process.on('SIGINT', stopServer);
  process.on('SIGTERM', stopServer);

  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.on('exit', (code, signal) => {
      if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') {
        resolve();
        return;
      }
      reject(new Error(`E2E server exited with ${signal ?? code}`));
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
