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
import { getClientIp, pruneLoginRateLimit, LOGIN_MAX_ATTEMPTS, checkRateLimit } from '@/lib/rate-limit';
import { clearSuccessfulLoginAttempts, getLoginRateLimitEntry, recordFailedLoginAttempt } from '@/lib/auth-rate-limit';
import { logAuditEvent } from '@/lib/audit';
import { isSupportedLocale, localizePath } from '@/lib/locale-path';

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
    const rawLocale = formData.get('locale')?.toString() ?? '';
    const locale = isSupportedLocale(rawLocale) ? rawLocale : 'en';

    // Validate before consuming rate-limit attempts
    if (!username) {
        return { error: 'Username is required' };
    }
    if (!password) {
        return { error: 'Password is required' };
    }

    // Rate Limiting — in-memory Map as fast cache, DB as source of truth
    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    const now = Date.now();

    pruneLoginRateLimit(now);

    const limitData = getLoginRateLimitEntry(ip, now);

    // Fast-path check from in-memory Map
    if (limitData.count >= LOGIN_MAX_ATTEMPTS) {
        return { error: 'Too many login attempts. Please try again later.' };
    }

    // DB-backed check for accuracy across restarts
    try {
        const dbLimit = await checkRateLimit(ip, 'login', LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
        if (dbLimit.limited) {
            return { error: 'Too many login attempts. Please try again later.' };
        }
    } catch {
        // DB unavailable — rely on in-memory Map
    }

    try {
        const [user] = await db.select({
            id: adminUsers.id,
            password_hash: adminUsers.password_hash,
        })
            .from(adminUsers)
            .where(eq(adminUsers.username, username))
            .limit(1);

        // Always verify Argon2 against a real or dummy hash to prevent
        // timing-based user enumeration (exists=~100ms, missing=~1ms).
        const hashToCheck = user?.password_hash ?? await getDummyHash();
        const verified = await argon2.verify(hashToCheck, password);

        if (!user || !verified) {
            try {
                await recordFailedLoginAttempt(ip, now);
            } catch (err) {
                console.debug('Failed to persist login rate limit attempt:', err);
            }
            logAuditEvent(null, 'login_failure', 'user', username, ip).catch(console.debug);
            return { error: 'Invalid credentials' };
        }

        try {
            await clearSuccessfulLoginAttempts(ip);
        } catch (err) {
            console.error('Failed to reset login rate limit for IP:', ip, err);
        }
        logAuditEvent(user.id, 'login_success', 'user', String(user.id), ip).catch(console.debug);

        try {
            const cookieStore = await cookies();
            const sessionToken = await generateSessionToken();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

            await db.insert(sessions).values({
                id: hashSessionToken(sessionToken),
                userId: user.id,
                expiresAt: expiresAt
            });

            // Invalidate pre-existing sessions to prevent session fixation
            await db.delete(sessions).where(and(
                eq(sessions.userId, user.id),
                sql`${sessions.id} != ${hashSessionToken(sessionToken)}`
            ));

            // Require Secure when behind TLS or in production.
            const forwardedProto = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
            const requestIsHttps = forwardedProto === 'https';
            const requireSecureCookie = requestIsHttps || process.env.NODE_ENV === 'production';

            cookieStore.set(COOKIE_NAME, sessionToken, {
                httpOnly: true,
                secure: requireSecureCookie,
                sameSite: 'lax',
                maxAge: 24 * 60 * 60, // 24 hours
                path: '/',
            });

            redirect(localizePath(locale, '/admin/dashboard'));
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

export async function logout(formData?: FormData) {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    const rawLocale = formData?.get('locale')?.toString() ?? '';
    const locale = isSupportedLocale(rawLocale) ? rawLocale : 'en';

    if (token) {
        await db.delete(sessions).where(eq(sessions.id, hashSessionToken(token))).catch(() => {});
    }

    cookieStore.delete({ name: COOKIE_NAME, path: '/' });
    redirect(localizePath(locale, '/admin'));
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
        // getCurrentUser doesn't return hash — fetch separately
        const userWithHash = await getAdminUserWithHash(currentUser.id);
        if (!userWithHash) {
            return { error: 'Unauthorized' };
        }

        const match = await argon2.verify(userWithHash.password_hash, currentPassword);

        if (!match) {
            return { error: 'Incorrect current password' };
        }

        const newHash = await argon2.hash(newPassword, { type: argon2.argon2id });

        await db.update(adminUsers)
            .set({ password_hash: newHash })
            .where(eq(adminUsers.id, currentUser.id));

        // Invalidate all sessions except the current one
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
