'use server';

import * as argon2 from 'argon2';
import { db, adminUsers, sessions } from '@/db';
import { eq, desc, sql } from 'drizzle-orm';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { isMySQLError } from '@/lib/validation';
import { logAuditEvent } from '@/lib/audit';
import { revalidateLocalizedPaths } from '@/lib/revalidation';

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
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    const username = formData.get('username')?.toString() ?? '';
    const password = formData.get('password')?.toString() ?? '';

    if (!username || username.length < 3) return { error: 'Username must be at least 3 chars' };
    if (username.length > 64) return { error: 'Username is too long (max 64 chars)' };
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) return { error: 'Username can only contain letters, numbers, underscores, and hyphens' };
    if (!password || password.length < 12) return { error: 'Password must be at least 12 characters long' };
    if (password.length > 1024) return { error: 'Password is too long (max 1024 chars)' };

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

        revalidateLocalizedPaths('/admin/dashboard');
        return { success: true };
    } catch (e: unknown) {
        if (isMySQLError(e) && (e.code === 'ER_DUP_ENTRY' || e.message?.includes('users.username'))) {
            return { error: 'Username already exists' };
        }
        console.error('Create user failed', e);
        return { error: 'Failed to create user' };
    }
}

export async function deleteAdminUser(id: number) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return { error: 'Unauthorized' };

    if (!Number.isInteger(id) || id <= 0) {
        return { error: 'Invalid user ID' };
    }

    // Prevent deleting self
    if (currentUser.id === id) {
        return { error: 'Cannot delete your own account' };
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
        revalidateLocalizedPaths('/admin/dashboard');
        return { success: true };
    } catch (e: unknown) {
        if (e instanceof Error && e.message === 'LAST_ADMIN') {
            return { error: 'Cannot delete the last admin user' };
        }
        console.error('Delete user failed', e);
        return { error: 'Failed to delete user' };
    }
}
