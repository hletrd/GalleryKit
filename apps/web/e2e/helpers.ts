import { createHash, createHmac, randomBytes } from 'crypto';
import { expect, Page } from '@playwright/test';

const requestedBaseUrl = process.env.E2E_BASE_URL?.trim() || `http://127.0.0.1:${process.env.E2E_PORT || '3100'}`;
const parsedBaseUrl = new URL(requestedBaseUrl);
const DEFAULT_BASE_URL = (() => {
  if (!['127.0.0.1', 'localhost'].includes(parsedBaseUrl.hostname) || parsedBaseUrl.port) {
    return requestedBaseUrl.replace(/\/$/, '');
  }

  const url = new URL(requestedBaseUrl);
  url.port = process.env.E2E_PORT || '3100';
  return url.toString().replace(/\/$/, '');
})();
const ARGON2_HASH_PREFIX = /^\$argon2/i;

function isLocalOrigin(origin: string) {
  const hostname = new URL(origin).hostname;
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

function getOriginForCookies(page: Page) {
  const currentUrl = page.url();
  const baseUrl = currentUrl && currentUrl !== 'about:blank' ? currentUrl : DEFAULT_BASE_URL;
  return new URL(baseUrl).origin;
}

// C1R-07: auto-enable the admin E2E describe when the local test
// environment has known-safe plaintext credentials (so `npm run test:e2e`
// exercises admin flows by default). Explicit opt-out via
// E2E_ADMIN_ENABLED=false still works; remote admin E2E remains opt-in
// only via E2E_ALLOW_REMOTE_ADMIN.
const adminExplicitFlag = process.env.E2E_ADMIN_ENABLED?.toLowerCase();
function adminAutoEnable(): boolean {
    if (adminExplicitFlag === 'true') return true;
    if (adminExplicitFlag === 'false') return false;
    if (process.env.NODE_ENV === 'production') return false;
    if (!isLocalOrigin(DEFAULT_BASE_URL)) return false;
    const explicitE2EPassword = process.env.E2E_ADMIN_PASSWORD?.trim();
    if (explicitE2EPassword) return true;
    const adminPassword = process.env.ADMIN_PASSWORD?.trim();
    if (adminPassword && !ARGON2_HASH_PREFIX.test(adminPassword)) return true;
    return false;
}
export const adminE2EEnabled = adminAutoEnable();

function resolveAdminE2EPassword(origin: string) {
  const explicitE2EPassword = process.env.E2E_ADMIN_PASSWORD?.trim();
  const adminPassword = process.env.ADMIN_PASSWORD?.trim();

  if (!isLocalOrigin(origin)) {
    if (process.env.E2E_ALLOW_REMOTE_ADMIN !== 'true') {
      throw new Error('Remote admin E2E is disabled by default. Set E2E_ALLOW_REMOTE_ADMIN=true to opt in.');
    }
    if (!explicitE2EPassword) {
      throw new Error('Remote admin E2E requires a plaintext E2E_ADMIN_PASSWORD.');
    }
    return explicitE2EPassword;
  }

  if (explicitE2EPassword) {
    return explicitE2EPassword;
  }

  if (!adminPassword) {
    throw new Error('E2E_ADMIN_PASSWORD or ADMIN_PASSWORD must be set for Playwright admin E2E tests');
  }

  if (ARGON2_HASH_PREFIX.test(adminPassword)) {
    throw new Error('ADMIN_PASSWORD is an Argon2 hash. Set a plaintext E2E_ADMIN_PASSWORD for Playwright admin flows.');
  }

  return adminPassword;
}



const LOCAL_DB_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

type E2EMysqlConnectionOptions = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: { rejectUnauthorized: true };
};

function requiredDbEnv(name: 'DB_USER' | 'DB_PASSWORD' | 'DB_NAME') {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getE2EMysqlConnectionOptions(): E2EMysqlConnectionOptions {
  const host = process.env.DB_HOST?.trim() || '127.0.0.1';
  const sslDisabled = process.env.DB_SSL === 'false';
  const useTls = !LOCAL_DB_HOSTS.has(host) && !sslDisabled;

  return {
    host,
    port: Number(process.env.DB_PORT || '3306'),
    user: requiredDbEnv('DB_USER'),
    password: requiredDbEnv('DB_PASSWORD'),
    database: requiredDbEnv('DB_NAME'),
    ...(useTls ? { ssl: { rejectUnauthorized: true } } : {}),
  };
}

function generateE2ESessionToken(secret: string): string {
  const timestamp = Date.now().toString();
  const random = randomBytes(16).toString('hex');
  const data = `${timestamp}:${random}`;
  const signature = createHmac('sha256', secret).update(data).digest('hex');
  return `${data}:${signature}`;
}

export async function createAdminSessionCookie() {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be set for authenticated E2E requests');
  }

  const mysql = await import('mysql2/promise');
  const connection = await mysql.createConnection(getE2EMysqlConnectionOptions());

  try {
    const [queryRows] = await connection.execute('SELECT id FROM admin_users WHERE username = ? LIMIT 1', ['admin']);
    const rows = queryRows as Array<{ id: number }>;
    const admin = rows[0];
    if (!admin) {
      throw new Error('No admin user exists for authenticated E2E request');
    }

    const token = generateE2ESessionToken(secret);
    const sessionId = createHash('sha256').update(token).digest('hex');
    await connection.execute(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))',
      [sessionId, admin.id],
    );

    return `admin_session=${token}`;
  } finally {
    await connection.end();
  }
}


export async function waitForImageProcessed(userFilename: string, timeoutMs = 30_000) {
  const mysql = await import('mysql2/promise');
  const connection = await mysql.createConnection(getE2EMysqlConnectionOptions());

  const startedAt = Date.now();
  try {
    while (Date.now() - startedAt < timeoutMs) {
      const [queryRows] = await connection.execute(
        'SELECT processed FROM images WHERE user_filename = ? LIMIT 1',
        [userFilename],
      );
      const rows = queryRows as Array<{ processed: number | boolean }>;
      if (rows[0]?.processed === 1 || rows[0]?.processed === true) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } finally {
    await connection.end();
  }

  throw new Error(`Timed out waiting for ${userFilename} to finish image processing`);
}

export async function ensureEnglishLocale(page: Page) {
  await page.context().addCookies([{
    name: 'NEXT_LOCALE',
    value: 'en',
    url: getOriginForCookies(page),
  }]);
}

export async function loginAsAdmin(page: Page) {
  const origin = getOriginForCookies(page);
  const adminPassword = resolveAdminE2EPassword(origin);

  await ensureEnglishLocale(page);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByPlaceholder('Username')).toBeVisible();
  await page.getByPlaceholder('Username').fill('admin');
  await page.getByPlaceholder('Password').fill(adminPassword);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
  await expect(page.locator('#admin-content')).toBeVisible();
}

export async function expectNoNextError(page: Page) {
  await expect(page.locator('#__next_error__')).toHaveCount(0);
}
