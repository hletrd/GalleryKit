/**
 * Admin Personal Access Tokens (PATs) for non-browser integrations such as
 * Lightroom-compatible external publish clients.
 *
 * Tokens are issued in the format `gk_<base64url(32 random bytes)>` (43 chars
 * after the prefix). Only the SHA-256 digest of the token is persisted in the
 * `admin_tokens` table; the plaintext is shown to the admin exactly once at
 * creation time and cannot be recovered. Verification re-derives the digest
 * with constant-time comparison and enforces the `expires_at` and scope set.
 *
 * The schema for `admin_tokens` is created in a Drizzle migration committed
 * after this file. Until that table exists at runtime, verification fails closed
 * while list/create callers surface a generic admin-facing error.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { db } from '@/db';
import { sql } from 'drizzle-orm';
import { safeInsertId } from '@/lib/validation';
import { acquireAdminMutationSlot } from '@/lib/admin-mutation-barrier';

export const TOKEN_PREFIX = 'gk_';
export const TOKEN_RANDOM_BYTES = 32;
/** base64url(32 bytes) is 43 chars; total length = prefix (3) + 43 = 46. */
export const TOKEN_PLAINTEXT_LENGTH = TOKEN_PREFIX.length + 43;

export type AdminTokenScope = 'lr:upload' | 'lr:read' | 'lr:delete';
// Only `lr:upload` has shipped routes today. `lr:read` and `lr:delete` are
// reserved so stored token scopes can remain forward-compatible when matching
// external-client routes are added.
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
 * expired). This function is side-effect-free; callers should mark usage only
 * after any route-specific scope check succeeds.
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
            SELECT at.id, at.user_id, at.label, at.token_hash, at.scopes, at.created_at, at.last_used_at, at.expires_at
            FROM admin_tokens AS at
            INNER JOIN admin_users AS au ON au.id = at.user_id
            WHERE at.token_hash = ${presentedHash}
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

    return {
        id: row.id,
        userId: row.user_id,
        scopes: parseScopes(row.scopes),
    };
}

export async function markTokenUsed(tokenId: number): Promise<void> {
    using mutationSlot = acquireAdminMutationSlot();
    if (!mutationSlot.acquired) return;
    try {
        await db.execute(sql`UPDATE admin_tokens SET last_used_at = NOW() WHERE id = ${tokenId}`);
    } catch (err: unknown) {
        console.debug('admin_tokens last_used_at update failed', err);
    }
}

/** List tokens for an admin user. Throws on DB/table failures so callers can surface a load error. */
export async function listTokensForUser(userId: number): Promise<Array<Omit<AdminTokenRecord, 'tokenHash'>>> {
    const result = await db.execute(sql`
        SELECT id, user_id, label, token_hash, scopes, created_at, last_used_at, expires_at
        FROM admin_tokens
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
    `);
    const rows = (Array.isArray(result) ? result[0] : result) as unknown as AdminTokenRow[];
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
    // R4C2 COR-R4C2-04: residual defense-in-depth truncation is now
    // code-point-safe (Array.from iterates by code point) so a 128-cap can
    // never bisect a surrogate pair into U+FFFD mojibake. The action layer
    // (createLrToken) REJECTS over-long labels before reaching here; this
    // truncation only guards direct lib callers.
    const cleanLabel = Array.from(opts.label.trim()).slice(0, 128).join('');
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
    // mysql2 can return insertId as number or BigInt depending on connection
    // flags. Use the repo-wide guard so audit targets never fall back to `0`
    // for a valid BigInt id.
    const header = (Array.isArray(result) ? result[0] : result) as { insertId?: unknown };
    const rawInsertId = header?.insertId;
    if (typeof rawInsertId !== 'number' && typeof rawInsertId !== 'bigint') {
        throw new Error('admin token insert did not return a valid insertId');
    }
    const insertId = safeInsertId(rawInsertId);
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
