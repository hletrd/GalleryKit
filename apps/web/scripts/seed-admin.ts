import * as dotenv from 'dotenv';
import path from 'path';

// Load .env.local file manually since this script runs outside Next.js context
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function main() {
    try {
        const passwordOrHash = process.env.ADMIN_PASSWORD;

        if (!passwordOrHash) {
            console.error('Error: ADMIN_PASSWORD not found in .env');
            process.exit(1);
        }

        // Import db after env vars are loaded
        const { db, adminUsers } = await import('@/db');

        console.log('Seeding admin user...');

        let hash = passwordOrHash;
        // Simple heuristic: Argon2 hashes usually start with $argon2
        if (!passwordOrHash.startsWith('$argon2')) {
            console.log('Detected plain text password. Hashing...');
            try {
                // Dynamic import for script execution context
                const argon2 = await import('argon2');
                hash = await argon2.hash(passwordOrHash);
            } catch (e) {
                console.error('Could not load argon2. Cannot hash password.', e);
                process.exit(1);
            }
        } else {
             console.log(`Using pre-hashed password (length: ${hash.length})`);
        }

        // Upsert the admin user
        // We use insert ... on duplicate key update to ensure idempotency
        await db.insert(adminUsers)
            .values({
                username: 'admin',
                password_hash: hash
            })
            .onDuplicateKeyUpdate({
                set: { password_hash: hash },
            });

        console.log('Admin user seeded successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Error seeding admin user:', err);
        process.exit(1);
    }
}

main();
