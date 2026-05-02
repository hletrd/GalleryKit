import * as dotenv from 'dotenv';
import path from 'path';

// Load .env.local BEFORE importing db
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Remove static import
// import { db, adminUsers } from '../src/db';
import * as argon2 from 'argon2';
import { PASSWORD_HASH_OPTIONS } from '../src/lib/password-hashing';

const WEAK_PLAINTEXT_PASSWORDS = new Set([
    'password',
    'admin',
    'changeme',
    'gallerykit',
    '12345678',
    '123456789',
    'qwerty123',
]);

function assertStrongBootstrapPassword(secret: string) {
    if (secret.startsWith('$argon2')) return;

    const normalized = secret.trim();
    if (normalized.length < 16 || WEAK_PLAINTEXT_PASSWORDS.has(normalized.toLowerCase())) {
        throw new Error('ADMIN_PASSWORD plaintext must be a strong 16+ character secret or an Argon2 hash.');
    }
}

async function main() {
    console.log('Starting migration used to seed admin user...');

    let adminPasswordHash = process.env.ADMIN_PASSWORD;

    if (!adminPasswordHash) {
        console.error('ADMIN_PASSWORD env var not found. Cannot migrate.');
        process.exit(1);
    }

    // Handle double-escaped $$ as seen in actions.ts
    if (adminPasswordHash.startsWith('$$argon2')) {
        adminPasswordHash = adminPasswordHash.split('$$').join('$');
    }

    // Check if it's already a hash or plaintext
    if (!adminPasswordHash.startsWith('$argon2')) {
        assertStrongBootstrapPassword(adminPasswordHash);
        console.log('ADMIN_PASSWORD is plain text, hashing it...');
        adminPasswordHash = await argon2.hash(adminPasswordHash, PASSWORD_HASH_OPTIONS);
    }

    // Dynamic import to ensure env vars are loaded first
    const { db, adminUsers } = await import('../src/db');

    console.log('Seeding admin user...');

    try {
        await db.insert(adminUsers).values({
            username: 'admin',
            password_hash: adminPasswordHash,
        }).onDuplicateKeyUpdate({
            set: {
                password_hash: adminPasswordHash
            }
        });

        console.log('Admin user seeded successfully.');
    } catch (e) {
        console.error('Failed to seed admin user:', e);
        process.exit(1);
    }

    console.log('Migration complete.');
    process.exit(0);
}

main();
