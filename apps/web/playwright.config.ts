import path from 'path';
import { existsSync } from 'fs';
import { defineConfig, devices } from '@playwright/test';

const repoLocalEnvPath = path.resolve(__dirname, '.env.local');
const externalDefaultEnvPath = path.resolve(process.env.HOME || process.cwd(), '.gallerykit-secrets/gallery-web.env.local');
const envPath = process.env.E2E_ENV_FILE
  ? path.resolve(process.env.E2E_ENV_FILE)
  : (existsSync(repoLocalEnvPath) ? repoLocalEnvPath : externalDefaultEnvPath);
const loadEnvFile = (process as NodeJS.Process & { loadEnvFile?: (path: string) => void }).loadEnvFile;
if (existsSync(envPath) && typeof loadEnvFile === 'function') {
  loadEnvFile(envPath);
}

const port = Number(process.env.E2E_PORT || 3100);
const host = '127.0.0.1';
const localBaseUrl = `http://${host}:${port}`;
// Default to a local server so `npm run test:e2e` validates the current checkout.
// Remote smoke tests remain available by setting E2E_BASE_URL explicitly.
const requestedBaseUrl = process.env.E2E_BASE_URL?.trim() || localBaseUrl;
const parsedBaseUrl = new URL(requestedBaseUrl);
const useLocalServer = ['127.0.0.1', 'localhost'].includes(parsedBaseUrl.hostname);
const localPort = parsedBaseUrl.port || String(port);
const localServerUrl = (() => {
  const url = new URL(requestedBaseUrl);
  url.port = localPort;
  return url.toString().replace(/\/$/, '');
})();
const baseURL = useLocalServer ? localServerUrl : requestedBaseUrl;
const reuseExistingServer = process.env.E2E_REUSE_SERVER === 'true';

function parsePositiveIntegerEnv(name: string, fallback: number) {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) return fallback;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer number of milliseconds`);
  }
  return parsed;
}

const webServerTimeout = parsePositiveIntegerEnv('E2E_WEB_SERVER_TIMEOUT_MS', 900_000);

if (!useLocalServer && process.env.E2E_ADMIN_ENABLED === 'true' && process.env.E2E_ALLOW_REMOTE_ADMIN !== 'true') {
  throw new Error('Remote admin E2E is disabled by default. Set E2E_ALLOW_REMOTE_ADMIN=true to opt in.');
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
    locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: useLocalServer
    ? {
        command: `node scripts/run-e2e-server.mjs --host=${host} --port=${localPort}`,
        cwd: __dirname,
        url: baseURL,
        reuseExistingServer,
        timeout: webServerTimeout,
      }
    : undefined,
});
