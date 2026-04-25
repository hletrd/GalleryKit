'use server';

import * as argon2 from 'argon2';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { connection, db, adminUsers } from '@/db';
import { desc } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { hasMySQLErrorCode } from '@/lib/validation';
import { logAuditEvent } from '@/lib/audit';
import { revalidateLocalizedPaths } from '@/lib/revalidation';
import { stripControlChars } from '@/lib/sanitize';
import { getClientIp, checkRateLimit, decrementRateLimit, incrementRateLimit, isRateLimitExceeded } from '@/lib/rate-limit';
import { getRestoreMaintenanceMessage } from '@/lib/restore-maintenance';
import { requireSameOriginAdmin } from '@/lib/action-guards';

// In-memory rate limit for admin user creation (per admin IP, per window)
const USER_CREATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const USER_CREATE_MAX_ATTEMPTS = 10;
const USER_CREATE_RATE_LIMIT_MAX_KEYS = 500;
const userCreateRateLimit = new Map<string, { count: number; resetAt: number }>();

function pruneUserCreateRateLimit() {
    const now = Date.now();
    for (const [key, entry] of userCreateRateLimit) {
        if (entry.resetAt <= now) userCreateRateLimit.delete(key);
    }
    if (userCreateRateLimit.size > USER_CREATE_RATE_LIMIT_MAX_KEYS) {
        const excess = userCreateRateLimit.size - USER_CREATE_RATE_LIMIT_MAX_KEYS;
        let evicted = 0;
        for (const key of userCreateRateLimit.keys()) {
            if (evicted >= excess) break;
            userCreateRateLimit.delete(key);
            evicted++;
        }
    }
}

function checkUserCreateRateLimit(ip: string): boolean {
    pruneUserCreateRateLimit();
    const now = Date.now();
    const entry = userCreateRateLimit.get(ip);
    if (!entry || entry.resetAt <= now) {
        userCreateRateLimit.set(ip, { count: 1, resetAt: now + USER_CREATE_WINDOW_MS });
        return false;
    }
    entry.count++;
    return entry.count > USER_CREATE_MAX_ATTEMPTS;
}

function rollbackUserCreateRateLimitAttempt(ip: string) {
    const currentEntry = userCreateRateLimit.get(ip);
    if (currentEntry && currentEntry.count > 1) {
        currentEntry.count--;
    } else if (currentEntry) {
        userCreateRateLimit.delete(ip);
    }
}

async function rollbackUserCreateRateLimit(ip: string, reason: string) {
    rollbackUserCreateRateLimitAttempt(ip);
    await decrementRateLimit(ip, 'user_create', USER_CREATE_WINDOW_MS).catch((err) => {
        console.debug(`Failed to roll back user_create DB rate limit after ${reason}:`, err);
    });
}

// Admin User Management
/** @action-origin-exempt: read-only admin getter */
export async function getAdminUsers() {
    if (!(await isAdmin())) return [];

    return await db.select({
        id: adminUsers.id,
        username: adminUsers.username,
        created_at: adminUsers.created_at
    }).from(adminUsers)
      .orderBy(desc(adminUsers.created_at));
}

export async function createAdminUser(formData: FormData) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };

    // AGG10R-RPL-01: validate form-field shape BEFORE the rate-limit
    // pre-increment, mirroring the AGG9R-RPL-01 fix applied to
    // `updatePassword` and the existing `login` ordering. Legitimate
    // authenticated-admin typos (empty field / regex mismatch / length
    // bounds / password mismatch) must not consume a rate-limit attempt
    // because no Argon2 hash will ever run for them. Without this ordering,
    // ten typo'd submissions burn the hour-long user_create budget.
    //
    // Sanitize before validation so length checks operate on the same value
    // that will be hashed (matches uploadImages tagsString pattern, see C46-01).
    // C0 controls in passwords are almost always accidental paste artifacts.
    const rawUsername = formData.get('username')?.toString() ?? '';
    const username = stripControlChars(rawUsername) ?? '';
    const password = stripControlChars(formData.get('password')?.toString() ?? '') ?? '';
    const confirmPassword = stripControlChars(formData.get('confirmPassword')?.toString() ?? '') ?? '';

    // Reject malformed input: if sanitization changes the value, the input
    // contained control characters and must not silently proceed (defense in
    // depth — matches updateTopic/deleteTopic pattern, see C7R2-05).
    if (username !== rawUsername) return { error: t('invalidUsernameFormat') };

    if (!username || username.length < 3) return { error: t('usernameTooShort') };
    if (username.length > 64) return { error: t('usernameTooLong') };
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) return { error: t('invalidUsernameFormat') };
    if (!password || password.length < 12) return { error: t('passwordTooShortCreate') };
    if (password.length > 1024) return { error: t('passwordTooLongCreate') };
    if (password !== confirmPassword) return { error: t('passwordsDoNotMatch') };

    // Rate limit admin user creation to prevent brute-force / CPU DoS.
    // Uses the same pre-increment pattern as login (A-01 fix) to prevent
    // TOCTOU between check and increment across concurrent requests.
    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    if (checkUserCreateRateLimit(ip)) {
        return { error: t('tooManyAttempts') };
    }
    // Pre-increment DB rate limit BEFORE the expensive Argon2 hash.
    // This ensures concurrent requests both increment the counter before
    // either can proceed, preventing burst attacks that exploit the gap
    // between check and increment.
    try {
        await incrementRateLimit(ip, 'user_create', USER_CREATE_WINDOW_MS);
        const dbLimit = await checkRateLimit(ip, 'user_create', USER_CREATE_MAX_ATTEMPTS, USER_CREATE_WINDOW_MS);
        if (isRateLimitExceeded(dbLimit.count, USER_CREATE_MAX_ATTEMPTS, true)) {
            await rollbackUserCreateRateLimit(ip, 'over-limit');
            return { error: t('tooManyAttempts') };
        }
    } catch {
        // DB unavailable — rely on in-memory Map (already incremented above)
    }

    try {
        const hash = await argon2.hash(password, { type: argon2.argon2id });
        const [result] = await db.insert(adminUsers).values({
            username,
            password_hash: hash
        });

        const currentUser = await getCurrentUser();
        const newUserId = Number(result.insertId);
        if (Number.isFinite(newUserId) && newUserId > 0) {
            logAuditEvent(currentUser?.id ?? null, 'user_create', 'user', String(newUserId)).catch(console.debug);
        }

        // Roll back only this pre-incremented attempt. Deleting the whole bucket
        // lets alternating success/duplicate requests erase concurrent pressure
        // and bypass the hourly user_create budget.
        await rollbackUserCreateRateLimit(ip, 'successful creation');

        revalidateLocalizedPaths('/admin/dashboard', '/admin/users');
        return { success: true };
    } catch (e: unknown) {
        if (hasMySQLErrorCode(e, 'ER_DUP_ENTRY')) {
            // C11R-FRESH-01: roll back BOTH counters on duplicate-username.
            // A legitimate admin typo (typing a username that already exists)
            // is a client-side user error, not a brute-force attempt. Without
            // rollback, ten duplicate-username typos within the 1-hour window
            // lock the admin out of user creation. Matches the precedent set
            // by AGG10R-RPL-01 (validation-before-increment) and AGG9R-RPL-01
            // (updatePassword validation ordering): legitimate user errors
            // must not consume rate-limit slots.
            await rollbackUserCreateRateLimit(ip, 'duplicate username');
            return { error: t('usernameExists') };
        }
        console.error('Create user failed', e);
        // Roll back DB rate limit on unexpected errors — the user didn't
        // fail due to brute-force, the infrastructure did.
        await rollbackUserCreateRateLimit(ip, 'unexpected create failure');
        return { error: t('failedToCreateUser') };
    }
}

export async function deleteAdminUser(id: number) {
    const t = await getTranslations('serverActions');
    const currentUser = await getCurrentUser();
    if (!currentUser) return { error: t('unauthorized') };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };

    if (!Number.isInteger(id) || id <= 0) {
        return { error: t('invalidUserId') };
    }

    // Prevent deleting self
    if (currentUser.id === id) {
        return { error: t('cannotDeleteSelf') };
    }

    // Serialize deletion through a DB advisory lock so concurrent requests
    // cannot both observe "more than one admin" and remove the final two rows.
    const conn = await connection.getConnection();
    let lockAcquired = false;

    try {
        const [lockRows] = await conn.query<(RowDataPacket & { acquired: number })[]>(
            "SELECT GET_LOCK('gallerykit_admin_delete', 5) AS acquired"
        );
        lockAcquired = (lockRows[0]?.acquired ?? 0) === 1;
        if (!lockAcquired) {
            throw new Error('DELETE_LOCK_TIMEOUT');
        }

        await conn.beginTransaction();
        const [adminCountRows] = await conn.query<(RowDataPacket & { count: number })[]>(
            'SELECT COUNT(*) AS count FROM admin_users'
        );
        if (Number(adminCountRows[0]?.count ?? 0) <= 1) {
            throw new Error('LAST_ADMIN');
        }

        const [targetRows] = await conn.query<(RowDataPacket & { id: number })[]>(
            'SELECT id FROM admin_users WHERE id = ? LIMIT 1',
            [id]
        );
        if (!targetRows[0]) {
            throw new Error('USER_NOT_FOUND');
        }

        await conn.query('DELETE FROM sessions WHERE user_id = ?', [id]);
        const [deleteResult] = await conn.query<ResultSetHeader>(
            'DELETE FROM admin_users WHERE id = ?',
            [id]
        );
        if (Number(deleteResult.affectedRows ?? 0) === 0) {
            throw new Error('USER_NOT_FOUND');
        }

        await conn.commit();
        logAuditEvent(currentUser.id, 'user_delete', 'user', String(id)).catch(console.debug);
        revalidateLocalizedPaths('/admin/dashboard', '/admin/users');
        return { success: true };
    } catch (e: unknown) {
        await conn.rollback().catch(() => {});
        if (e instanceof Error && e.message === 'DELETE_LOCK_TIMEOUT') {
            return { error: t('failedToDeleteUser') };
        }
        if (e instanceof Error && e.message === 'LAST_ADMIN') {
            return { error: t('cannotDeleteLastAdmin') };
        }
        if (e instanceof Error && e.message === 'USER_NOT_FOUND') {
            return { error: t('userNotFound') };
        }
        console.error('Delete user failed', e);
        return { error: t('failedToDeleteUser') };
    } finally {
        if (lockAcquired) {
            await conn.query("SELECT RELEASE_LOCK('gallerykit_admin_delete')").catch(() => {});
        }
        conn.release();
    }
}
