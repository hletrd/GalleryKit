'use server';

import * as argon2 from 'argon2';
import { db, adminUsers, sessions } from '@/db';
import { eq, desc, sql } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { isMySQLError } from '@/lib/validation';
import { logAuditEvent } from '@/lib/audit';
import { revalidateLocalizedPaths } from '@/lib/revalidation';
import { getClientIp, checkRateLimit, incrementRateLimit, resetRateLimit } from '@/lib/rate-limit';

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

// Admin User Management
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
        if (dbLimit.limited) {
            // Roll back in-memory pre-increment to stay consistent with DB source of truth.
            const currentEntry = userCreateRateLimit.get(ip);
            if (currentEntry && currentEntry.count > 1) {
                currentEntry.count--;
            } else {
                userCreateRateLimit.delete(ip);
            }
            return { error: t('tooManyAttempts') };
        }
    } catch {
        // DB unavailable — rely on in-memory Map (already incremented above)
    }

    const username = formData.get('username')?.toString() ?? '';
    const password = formData.get('password')?.toString() ?? '';

    if (!username || username.length < 3) return { error: t('usernameTooShort') };
    if (username.length > 64) return { error: t('usernameTooLong') };
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) return { error: t('invalidUsernameFormat') };
    if (!password || password.length < 12) return { error: t('passwordTooShortCreate') };
    if (password.length > 1024) return { error: t('passwordTooLongCreate') };

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

        // Roll back DB rate limit on successful creation — this was a legitimate
        // action, not a brute-force attempt. Matches login pattern (A-01 fix).
        try {
            await resetRateLimit(ip, 'user_create', USER_CREATE_WINDOW_MS);
        } catch {
            // DB unavailable — in-memory Map will expire naturally
        }

        revalidateLocalizedPaths('/admin/dashboard', '/admin/users');
        return { success: true };
    } catch (e: unknown) {
        if (isMySQLError(e) && (e.code === 'ER_DUP_ENTRY' || e.message?.includes('users.username'))) {
            return { error: t('usernameExists') };
        }
        console.error('Create user failed', e);
        // Roll back DB rate limit on unexpected errors — the user didn't
        // fail due to brute-force, the infrastructure did.
        try {
            await resetRateLimit(ip, 'user_create', USER_CREATE_WINDOW_MS);
        } catch {
            // DB unavailable — in-memory Map will expire naturally
        }
        return { error: t('failedToCreateUser') };
    }
}

export async function deleteAdminUser(id: number) {
    const t = await getTranslations('serverActions');
    const currentUser = await getCurrentUser();
    if (!currentUser) return { error: t('unauthorized') };

    if (!Number.isInteger(id) || id <= 0) {
        return { error: t('invalidUserId') };
    }

    // Prevent deleting self
    if (currentUser.id === id) {
        return { error: t('cannotDeleteSelf') };
    }

    // Atomically check last-admin and delete inside a transaction to prevent TOCTOU race
    try {
        await db.transaction(async (tx) => {
            const [adminCount] = await tx.select({ count: sql<number>`count(*)` }).from(adminUsers);
            if (Number(adminCount.count) <= 1) {
                throw new Error('LAST_ADMIN');
            }
            // Explicitly delete sessions before user (defense in depth alongside FK cascade)
            await tx.delete(sessions).where(eq(sessions.userId, id));
            await tx.delete(adminUsers).where(eq(adminUsers.id, id));
        });
        logAuditEvent(currentUser.id, 'user_delete', 'user', String(id)).catch(console.debug);
        revalidateLocalizedPaths('/admin/dashboard', '/admin/users');
        return { success: true };
    } catch (e: unknown) {
        if (e instanceof Error && e.message === 'LAST_ADMIN') {
            return { error: t('cannotDeleteLastAdmin') };
        }
        console.error('Delete user failed', e);
        return { error: t('failedToDeleteUser') };
    }
}
