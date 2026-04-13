'use server';

import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { db, adminUsers, sessions } from '@/db';
import { eq, and, sql } from 'drizzle-orm';
import { cache } from 'react';

import { COOKIE_NAME, hashSessionToken, generateSessionToken, verifySessionToken } from '@/lib/session';
import { getClientIp, pruneLoginRateLimit, loginRateLimit, LOGIN_WINDOW_MS, LOGIN_MAX_ATTEMPTS } from '@/lib/rate-limit';

export async function getSession() {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;

    if (!token) return null;

    const session = await verifySessionToken(token);
    return session;
}

export const getCurrentUser = cache(async function getCurrentUser() {
    const session = await getSession();
    if (!session) return null;

    const [user] = await db.select({
        id: adminUsers.id,
        username: adminUsers.username,
        created_at: adminUsers.created_at,
    }).from(adminUsers).where(eq(adminUsers.id, session.userId));
    return user || null;
});

/** Fetch only id + password_hash — only for internal auth verification (never cache or export to client). */
async function getAdminUserWithHash(userId: number) {
    const [user] = await db.select({
        id: adminUsers.id,
        password_hash: adminUsers.password_hash,
    }).from(adminUsers).where(eq(adminUsers.id, userId));
    return user || null;
}

export async function isAdmin() {
    return !!(await getCurrentUser());
}

/**
 * Precomputed Argon2id hash used to equalize login timing between "user does
 * not exist" and "user exists, wrong password" branches. Lazily initialized
 * once per process so the first call doesn't pay the hash cost and we don't
 * block import. The parameters must match whatever we use in argon2.hash().
 */
let dummyHashPromise: Promise<string> | null = null;
async function getDummyHash(): Promise<string> {
    if (!dummyHashPromise) {
        dummyHashPromise = argon2.hash(randomBytes(32).toString('hex'), { type: argon2.argon2id });
    }
    return dummyHashPromise;
}

export async function login(prevState: { error?: string } | null, formData: FormData) {
    const username = formData.get('username')?.toString() ?? '';
    const password = formData.get('password')?.toString() ?? '';

    // Validate inputs before touching rate-limit state so that missing-field
    // requests don't consume rate-limit attempts.
    if (!username) {
        return { error: 'Username is required' };
    }
    if (!password) {
        return { error: 'Password is required' };
    }

    // Rate Limiting
    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    const now = Date.now();

    pruneLoginRateLimit(now);

    const limitData = loginRateLimit.get(ip) || { count: 0, lastAttempt: 0 };

    // Reset if window passed
    if (now - limitData.lastAttempt > LOGIN_WINDOW_MS) {
        limitData.count = 0;
    }

    if (limitData.count >= LOGIN_MAX_ATTEMPTS) {
        return { error: 'Too many login attempts. Please try again later.' };
    }

    // Increment count and re-insert to maintain Map insertion order (LRU eviction)
    limitData.count++;
    limitData.lastAttempt = now;
    loginRateLimit.delete(ip);
    loginRateLimit.set(ip, limitData);

    try {
        const [user] = await db.select({
            id: adminUsers.id,
            password_hash: adminUsers.password_hash,
        })
            .from(adminUsers)
            .where(eq(adminUsers.username, username))
            .limit(1);

        // Always run Argon2 verification against either the real hash or a
        // precomputed dummy hash so both branches take the same wall time.
        // Without this, the "user does not exist" branch returns in ~1ms while
        // the "user exists, wrong password" branch takes ~100ms, enabling
        // user enumeration via timing side-channel.
        const hashToCheck = user?.password_hash ?? await getDummyHash();
        const verified = await argon2.verify(hashToCheck, password);

        if (!user || !verified) {
            return { error: 'Invalid credentials' };
        }

        // Successful auth: drop any accumulated failures for this IP.
        loginRateLimit.delete(ip);

        try {
            const cookieStore = await cookies();
            const sessionToken = await generateSessionToken();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

            await db.insert(sessions).values({
                id: hashSessionToken(sessionToken),
                userId: user.id,
                expiresAt: expiresAt
            });

            // Require HTTPS for the session cookie whenever the underlying
            // request came in over TLS (via the reverse proxy), and always
            // require it in production regardless of NODE_ENV introspection.
            // This prevents session cookies from being emitted without Secure
            // if someone misconfigures NODE_ENV on a prod box.
            const forwardedProto = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
            const requestIsHttps = forwardedProto === 'https';
            const requireSecureCookie = requestIsHttps || process.env.NODE_ENV === 'production';

            // Set secure cookie with proper attributes
            cookieStore.set(COOKIE_NAME, sessionToken, {
                httpOnly: true,
                secure: requireSecureCookie,
                sameSite: 'lax',
                maxAge: 24 * 60 * 60, // 24 hours
                path: '/',
            });

            redirect('/admin/dashboard');
        } catch (e) {
            if (isRedirectError(e)) throw e;
            console.error("Session creation failed after successful auth", e);
            return { error: 'Login succeeded but session creation failed. Please try again.' };
        }
    } catch (e) {
        if (isRedirectError(e)) throw e;
        console.error("Login verification failed:", e instanceof Error ? e.message : 'Unknown error');
    }

    return { error: 'Invalid credentials' };
}

export async function logout() {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;

    // Delete session from database if it exists
    if (token) {
        await db.delete(sessions).where(eq(sessions.id, hashSessionToken(token))).catch(() => {});
    }

    cookieStore.delete({ name: COOKIE_NAME, path: '/' });
    redirect('/admin');
}

export async function updatePassword(prevState: { error?: string; success?: boolean; message?: string } | null, formData: FormData) {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        return { error: 'Unauthorized' };
    }

    const currentPassword = formData.get('currentPassword')?.toString() ?? '';
    const newPassword = formData.get('newPassword')?.toString() ?? '';
    const confirmPassword = formData.get('confirmPassword')?.toString() ?? '';

    if (!currentPassword || !newPassword || !confirmPassword) {
        return { error: 'All fields are required' };
    }

    if (newPassword !== confirmPassword) {
        return { error: 'New passwords do not match' };
    }

    if (newPassword.length < 12) {
        return { error: 'New password must be at least 12 characters long' };
    }

    if (newPassword.length > 1024) {
        return { error: 'Password is too long (max 1024 characters)' };
    }

    try {
        // Fetch user with hash for password verification (getCurrentUser no longer returns hash)
        const userWithHash = await getAdminUserWithHash(currentUser.id);
        if (!userWithHash) {
            return { error: 'Unauthorized' };
        }

        // Verify current password
        const match = await argon2.verify(userWithHash.password_hash, currentPassword);

        if (!match) {
            return { error: 'Incorrect current password' };
        }

        // Hash new password
        const newHash = await argon2.hash(newPassword, { type: argon2.argon2id });

        // Update password
        await db.update(adminUsers)
            .set({ password_hash: newHash })
            .where(eq(adminUsers.id, currentUser.id));

        // Invalidate all sessions for this user EXCEPT the current one
        const currentSession = await getSession();
        if (currentSession) {
             await db.delete(sessions).where(and(
                 eq(sessions.userId, currentUser.id),
                 sql`${sessions.id} != ${currentSession.id}`
             ));
        } else {
             await db.delete(sessions).where(eq(sessions.userId, currentUser.id));
        }

        return { success: true, message: 'Password updated successfully.' };

    } catch (e) {
        console.error("Failed to update password:", e instanceof Error ? e.message : 'Unknown error');
        return { error: 'Failed to update password' };
    }
}
