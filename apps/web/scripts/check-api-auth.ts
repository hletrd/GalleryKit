/**
 * CI check: verifies all /api/admin/ route files use withAdminAuth or isAdmin.
 * Run with: npx tsx scripts/check-api-auth.ts
 */
import * as fs from 'fs';
import * as path from 'path';

const API_ADMIN_DIR = path.resolve(__dirname, '../src/app/api/admin');

function findRouteFiles(dir: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...findRouteFiles(full));
        } else if (entry.name === 'route.ts' || entry.name === 'route.js') {
            results.push(full);
        }
    }
    return results;
}

let failed = false;
const routeFiles = findRouteFiles(API_ADMIN_DIR);

if (routeFiles.length === 0) {
    console.log('No admin API route files found — skipping check.');
    process.exit(0);
}

for (const file of routeFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const relative = path.relative(process.cwd(), file);
    if (!content.includes('withAdminAuth') && !content.includes('isAdmin')) {
        console.error(`MISSING AUTH: ${relative} does not use withAdminAuth or isAdmin`);
        failed = true;
    } else {
        console.log(`OK: ${relative}`);
    }
}

process.exit(failed ? 1 : 0);
