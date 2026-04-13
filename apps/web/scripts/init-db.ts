import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import path from 'path';

function resolveAppRoot() {
    const candidates = [
        process.cwd(),
        path.join(process.cwd(), 'apps', 'web'),
    ];

    return candidates.find((candidate) => candidate.endsWith(path.join('apps', 'web'))) ?? candidates[0];
}

const appRoot = resolveAppRoot();
dotenv.config({ path: path.join(appRoot, '.env.local') });

function formatError(error: unknown) {
    if (error instanceof Error) {
        return { name: error.name, message: error.message };
    }
    return { message: String(error) };
}

try {
    console.log('🔄 Initializing database...');
    execSync('node scripts/migrate.js', {
        cwd: appRoot,
        stdio: 'inherit',
        env: process.env,
    });
    console.log('✅ Initialization complete.');
} catch (error) {
    console.error('❌ Initialization failed:', formatError(error));
    process.exit(1);
}
