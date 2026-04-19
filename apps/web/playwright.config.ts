import path from 'path';
import dotenv from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

dotenv.config({ path: path.resolve(__dirname, '.env.local') });

const port = Number(process.env.E2E_PORT || 3100);
const host = '127.0.0.1';
const localBaseUrl = `http://${host}:${port}`;
const baseURL = process.env.E2E_BASE_URL?.trim() || 'https://gallery.atik.kr';
const parsedBaseUrl = new URL(baseURL);
const useLocalServer = ['127.0.0.1', 'localhost'].includes(parsedBaseUrl.hostname);
const localPort = parsedBaseUrl.port || String(port);

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
        command: `HOSTNAME=${host} PORT=${localPort} node .next/standalone/server.js`,
        cwd: __dirname,
        url: baseURL || localBaseUrl,
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
});
