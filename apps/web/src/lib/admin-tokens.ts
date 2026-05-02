/**
 * Admin Personal Access Tokens (PATs) for non-browser integrations such as
 * the Lightroom Classic publish plugin.
 *
 * Tokens are issued in the format `gk_<base64url(32 random bytes)>` (43 chars
 * after the prefix). Only the SHA-256 digest of the token is persisted in the
 * `admin_tokens` table; the plaintext is shown to the admin exactly once at
 * creation time and cannot be recovered. Verification re-derives the digest
 * with constant-time comparison and enforces the `expires_at` and scope set.
 *
 * The schema for `admin_tokens` is created in a Drizzle migration committed
 * after this file. Until that table exists at runtime, all functions here
 * fail closed (verify returns null, list returns []).
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { db } from '@/db';
import { sql } from 'drizzle-orm';

export const TOKEN_PREFIX = 'gk_';
export const TOKEN_RANDOM_BYTES = 32;
/** base64url(32 bytes) is 43 chars; total length = prefix (3) + 43 = 46. */
export const TOKEN_PLAINTEXT_LENGTH = TOKEN_PREFIX.length + 43;

export type AdminTokenScope = 'lr:upload' | 'lr:read' | 'lr:delete';
export const ALL_SCOPES: readonly AdminTokenScope[] = ['lr:upload', 'lr:read', 'lr:delete'] as const;

export interface AdminTokenRecord {
    id: number;
    userId: number;
    label: string;
    tokenHash: string;
    scopes: AdminTokenScope[];
    createdAt: Date;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
}

export interface VerifiedToken {
    id: number;
    userId: number;
    scopes: AdminTokenScope[];
}

/**
 * Generate a fresh plaintext token. Returns the plaintext (to be shown to the
 * admin once) and the SHA-256 hash (stored in the DB).
 */
export function generateToken(): { plaintext: string; hash: string } {
    const random = randomBytes(TOKEN_RANDOM_BYTES);
    const plaintext = TOKEN_PREFIX + random.toString('base64url');
    const hash = hashToken(plaintext);
    return { plaintext, hash };
}

/** SHA-256 hex digest of the plaintext token. */
export function hashToken(plaintext: string): string {
    return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of two hex digests. Returns false if lengths differ
 * or either is not a valid hex string of the expected length.
 */
export function tokenHashesEqual(a: string, b: string): boolean {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
    try {
        return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
    } catch {
        return false;
    }
}

/**
 * Validate the surface format of a presented token without touching the DB.
 * Used to short-circuit obviously bad inputs before the DB lookup.
 */
export function isWellFormedToken(value: string): boolean {
    if (typeof value !== 'string') return false;
    if (value.length !== TOKEN_PLAINTEXT_LENGTH) return false;
    if (!value.startsWith(TOKEN_PREFIX)) return false;
    const body = value.slice(TOKEN_PREFIX.length);
    return /^[A-Za-z0-9_-]+$/.test(body);
}

/** Filter and de-duplicate scope strings against the allowed scope set. */
export function normalizeScopes(input: unknown): AdminTokenScope[] {
    const allowed = new Set<string>(ALL_SCOPES);
    const result: AdminTokenScope[] = [];
    if (!Array.isArray(input)) return result;
    for (const candidate of input) {
        if (typeof candidate !== 'string') continue;
        if (!allowed.has(candidate)) continue;
        const scope = candidate as AdminTokenScope;
        if (!result.includes(scope)) result.push(scope);
    }
    return result;
}

/** True when the token's stored scopes include the required scope. */
export function tokenHasScope(scopes: AdminTokenScope[], required: AdminTokenScope): boolean {
    return scopes.includes(required);
}

interface AdminTokenRow {
    id: number;
    user_id: number;
    label: string;
    token_hash: string;
    scopes: string | null;
    created_at: Date;
    last_used_at: Date | null;
    expires_at: Date | null;
}

function parseScopes(raw: string | null): AdminTokenScope[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return normalizeScopes(parsed);
    } catch {
        return [];
    }
}

/**
 * Look up a token by its presented plaintext value and return the verified
 * record on success. Returns null on any failure (bad format, unknown hash,
 * expired). On success, asynchronously updates `last_used_at` (best-effort).
 *
 * The presented plaintext is hashed locally and the lookup is done by hash;
 * the plaintext never reaches a query parameter, so no plaintext appears in
 * slow-query logs even on malformed inputs.
 */
export async function verifyToken(plaintext: string): Promise<VerifiedToken | null> {
    if (!isWellFormedToken(plaintext)) return null;
    const presentedHash = hashToken(plaintext);
    let rows: AdminTokenRow[];
    try {
        const result = await db.execute(sql`
            SELECT id, user_id, label, token_hash, scopes, created_at, last_used_at, expires_at
            FROM admin_tokens
            WHERE token_hash = ${presentedHash}
            LIMIT 1
        `);
        rows = (Array.isArray(result) ? result[0] : result) as unknown as AdminTokenRow[];
    } catch {
        // Table may not yet exist (migration not yet applied) — fail closed.
        return null;
    }
    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    if (!tokenHashesEqual(row.token_hash, presentedHash)) return null;
    if (row.expires_at && row.expires_at.getTime() <= Date.now()) return null;

    // Best-effort touch of last_used_at; never block verification on it.
    db.execute(sql`UPDATE admin_tokens SET last_used_at = NOW() WHERE id = ${row.id}`)
        .catch((err: unknown) => { console.debug('admin_tokens last_used_at update failed', err); });

    return {
        id: row.id,
        userId: row.user_id,
        scopes: parseScopes(row.scopes),
    };
}

/** List tokens for an admin user. Returns [] if the table is missing. */
export async function listTokensForUser(userId: number): Promise<Array<Omit<AdminTokenRecord, 'tokenHash'>>> {
    let rows: AdminTokenRow[];
    try {
        const result = await db.execute(sql`
            SELECT id, user_id, label, token_hash, scopes, created_at, last_used_at, expires_at
            FROM admin_tokens
            WHERE user_id = ${userId}
            ORDER BY created_at DESC
        `);
        rows = (Array.isArray(result) ? result[0] : result) as unknown as AdminTokenRow[];
    } catch {
        return [];
    }
    return rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        label: row.label,
        scopes: parseScopes(row.scopes),
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        expiresAt: row.expires_at,
    }));
}

/**
 * Insert a freshly generated token row. Returns the plaintext exactly once.
 * Throws if the underlying table is missing — callers should surface a clear
 * "migration not yet applied" error.
 */
export async function createToken(opts: {
    userId: number;
    label: string;
    scopes: AdminTokenScope[];
    expiresAt?: Date | null;
}): Promise<{ plaintext: string; id: number }> {
    const cleanLabel = opts.label.trim().slice(0, 128);
    if (!cleanLabel) throw new Error('Token label is required');
    const cleanScopes = normalizeScopes(opts.scopes);
    if (cleanScopes.length === 0) throw new Error('At least one scope is required');
    const { plaintext, hash } = generateToken();
    const scopesJson = JSON.stringify(cleanScopes);
    const expiresAt = opts.expiresAt ?? null;
    const result = await db.execute(sql`
        INSERT INTO admin_tokens (user_id, label, token_hash, scopes, expires_at)
        VALUES (${opts.userId}, ${cleanLabel}, ${hash}, ${scopesJson}, ${expiresAt})
    `);
    // mysql2 returns ResultSetHeader with insertId for INSERT.
    const header = (Array.isArray(result) ? result[0] : result) as { insertId?: number };
    const insertId = typeof header?.insertId === 'number' ? header.insertId : 0;
    return { plaintext, id: insertId };
}

/** Revoke (delete) a token. Returns true if a row was deleted. */
export async function revokeToken(opts: { userId: number; tokenId: number }): Promise<boolean> {
    try {
        const result = await db.execute(sql`
            DELETE FROM admin_tokens WHERE id = ${opts.tokenId} AND user_id = ${opts.userId}
        `);
        const header = (Array.isArray(result) ? result[0] : result) as { affectedRows?: number };
        return typeof header?.affectedRows === 'number' && header.affectedRows > 0;
    } catch {
        return false;
    }
}
