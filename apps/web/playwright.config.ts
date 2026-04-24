import path from 'path';
import { existsSync } from 'fs';
import { defineConfig, devices } from '@playwright/test';

const envPath = path.resolve(__dirname, '.env.local');
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
        command: `env -u NO_COLOR -u FORCE_COLOR TRUST_PROXY=true npm run init && env -u NO_COLOR -u FORCE_COLOR TRUST_PROXY=true npm run e2e:seed && env -u NO_COLOR -u FORCE_COLOR TRUST_PROXY=true npm run build && rm -rf .next/standalone/apps/web/.next/static && cp -R .next/static .next/standalone/apps/web/.next/static && env -u NO_COLOR -u FORCE_COLOR TRUST_PROXY=true sh -c '. ./.env.local && HOSTNAME=${host} PORT=${localPort} node .next/standalone/apps/web/server.js'`,
        cwd: __dirname,
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
      }
    : undefined,
});
