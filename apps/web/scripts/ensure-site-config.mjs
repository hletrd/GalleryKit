import fs from 'node:fs';
import path from 'node:path';

const siteConfigPath = path.resolve(process.cwd(), 'src', 'site-config.json');

if (!fs.existsSync(siteConfigPath)) {
  console.error('Missing required src/site-config.json. Copy src/site-config.example.json and customize it before building or deploying.');
  process.exit(1);
}

const siteConfig = JSON.parse(fs.readFileSync(siteConfigPath, 'utf8'));
const configuredUrl = String(process.env.BASE_URL || siteConfig.url || '').trim();
const isProductionBuild = process.env.NODE_ENV === 'production';
const placeholderHosts = new Set([
  'example.com',
  'www.example.com',
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
]);

if (isProductionBuild && !configuredUrl) {
  console.error('Missing production base URL. Set BASE_URL or customize src/site-config.json before building.');
  process.exit(1);
}

if (isProductionBuild) {
  try {
    const parsed = new URL(configuredUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      console.error('Production base URL must use http or https.');
      process.exit(1);
    }
    if (placeholderHosts.has(parsed.hostname)) {
      console.error('Refusing to build production assets with a placeholder base URL. Set BASE_URL or customize src/site-config.json.');
      process.exit(1);
    }
  } catch {
    console.error('Production base URL must be absolute. Set BASE_URL to an absolute URL or customize src/site-config.json.');
    process.exit(1);
  }
}
