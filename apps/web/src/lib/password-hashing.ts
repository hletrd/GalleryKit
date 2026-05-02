import * as argon2 from 'argon2';

/**
 * Shared Argon2id work-factor policy for admin credentials.
 *
 * Keep login timing dummy hashes, password changes, admin creation, and
 * bootstrap/seed scripts on the same explicit parameters so a library-default
 * change cannot silently weaken or skew one path.
 */
export const PASSWORD_HASH_OPTIONS = {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 4,
} satisfies argon2.Options;
