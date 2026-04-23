import fs from 'node:fs';
import path from 'node:path';

const siteConfigPath = path.resolve(process.cwd(), 'src', 'site-config.json');

if (!fs.existsSync(siteConfigPath)) {
  console.error('Missing required src/site-config.json. Copy src/site-config.example.json and customize it before building or deploying.');
  process.exit(1);
}
