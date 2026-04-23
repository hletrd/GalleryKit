'use server';

import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { cookies, headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';
import { db, adminUsers, sessions } from '@/db';
import { eq, and, sql } from 'drizzle-orm';
import { cache } from 'react';
import { getTranslations } from 'next-intl/server';

import { COOKIE_NAME, hashSessionToken, generateSessionToken, verifySessionToken } from '@/lib/session';
import { stripControlChars } from '@/lib/sanitize';
import { getClientIp, pruneLoginRateLimit, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS, checkRateLimit, incrementRateLimit, resetRateLimit, decrementRateLimit, loginRateLimit, buildAccountRateLimitKey } from '@/lib/rate-limit';
import { clearSuccessfulLoginAttempts, getLoginRateLimitEntry, clearSuccessfulPasswordAttempts, getPasswordChangeRateLimitEntry, passwordChangeRateLimit, prunePasswordChangeRateLimit, PASSWORD_CHANGE_MAX_ATTEMPTS, rollbackLoginRateLimit, rollbackPasswordChangeRateLimit } from '@/lib/auth-rate-limit';
import { logAuditEvent } from '@/lib/audit';
import { isSupportedLocale, localizePath } from '@/lib/locale-path';
import { getRestoreMaintenanceMessage } from '@/lib/restore-maintenance';
import { hasTrustedSameOrigin } from '@/lib/request-origin';

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
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) {
        return { error: maintenanceError };
    }
    const username = stripControlChars(formData.get('username')?.toString() ?? '') ?? '';
    // Sanitize before use so the value matches what was stored during account
    // creation (stripControlChars is applied in createAdminUser, see C8-01).
    const password = stripControlChars(formData.get('password')?.toString() ?? '') ?? '';
    const rawLocale = formData.get('locale')?.toString() ?? '';
    const locale = isSupportedLocale(rawLocale) ? rawLocale : 'en';

    // Validate before consuming rate-limit attempts
    if (!username) {
        return { error: t('usernameRequired') };
    }
    if (!password) {
        return { error: t('passwordRequired') };
    }

    // Rate Limiting — in-memory Map as fast cache, DB as source of truth
    const requestHeaders = await headers();
    if (!hasTrustedSameOrigin(requestHeaders)) {
        return { error: t('authFailed') };
    }
    const ip = getClientIp(requestHeaders);
    const now = Date.now();

    pruneLoginRateLimit(now);

    const limitData = getLoginRateLimitEntry(ip, now);

    // Fast-path check from in-memory Map
    if (limitData.count >= LOGIN_MAX_ATTEMPTS) {
        return { error: t('tooManyAttempts') };
    }

    // DB-backed check for accuracy across restarts
    try {
        const dbLimit = await checkRateLimit(ip, 'login', LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
        if (dbLimit.limited) {
            return { error: t('tooManyAttempts') };
        }
    } catch {
        // DB unavailable — rely on in-memory Map
    }

    // ── Account-scoped rate limit: throttle per-username, not just per-IP ──
    // This prevents distributed brute-force attacks where each IP gets a fresh
    // budget but all target the same account. The bucket key is prefixed with
    // "acct:" to avoid collisions with IP-based buckets.
    const accountRateLimitKey = buildAccountRateLimitKey(username);
    try {
        const accountLimit = await checkRateLimit(accountRateLimitKey, 'login_account', LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
        if (accountLimit.limited) {
            return { error: t('tooManyAttempts') };
        }
    } catch {
        // DB unavailable — IP-based limit still applies
    }

    // ── Increment rate limit BEFORE the expensive Argon2 verify (TOCTOU fix) ──
    // Without this, concurrent requests all pass the check before any of them
    // record the failed attempt, allowing burst brute-force attacks.
    try {
        limitData.count += 1;
        limitData.lastAttempt = now;
        loginRateLimit.set(ip, limitData);
        await incrementRateLimit(ip, 'login', LOGIN_WINDOW_MS);
        // Also increment account-scoped bucket
        await incrementRateLimit(accountRateLimitKey, 'login_account', LOGIN_WINDOW_MS);
    } catch (err) {
        console.debug('Failed to pre-increment login rate limit:', err);
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
            // Rate limit already incremented above — no need to record again.
            await logAuditEvent(null, 'login_failure', 'user', username, ip).catch(console.debug);
            return { error: t('invalidCredentials') };
        }

        // Login succeeded — roll back the pre-incremented rate limit counters
        // (both IP-scoped and account-scoped)
        try {
            await clearSuccessfulLoginAttempts(ip);
        } catch (err) {
            console.error('Failed to reset login rate limit for IP:', ip, err);
        }
        try {
            await resetRateLimit(accountRateLimitKey, 'login_account', LOGIN_WINDOW_MS);
        } catch (err) {
            console.debug('Failed to reset account-scoped login rate limit:', err);
        }
        await logAuditEvent(user.id, 'login_success', 'user', String(user.id), ip).catch(console.debug);

        try {
            const cookieStore = await cookies();
            const sessionToken = await generateSessionToken();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
            const sessionId = hashSessionToken(sessionToken);

            // Insert new session and invalidate pre-existing sessions in an
            // explicit transaction to prevent session fixation. This ensures
            // the insert succeeds before deleting other sessions, avoiding the
            // edge case where both old and new sessions could be lost.
            await db.transaction(async (tx) => {
                await tx.insert(sessions).values({
                    id: sessionId,
                    userId: user.id,
                    expiresAt: expiresAt
                });

                // Invalidate pre-existing sessions to prevent session fixation
                await tx.delete(sessions).where(and(
                    eq(sessions.userId, user.id),
                    sql`${sessions.id} != ${sessionId}`
                ));
            });

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
            unstable_rethrow(e);
            console.error("Session creation failed after successful auth", e);
            return { error: t('authFailed') };
        }
    } catch (e) {
        unstable_rethrow(e);
        console.error("Login verification failed:", e instanceof Error ? e.message : 'Unknown error');
        // Roll back pre-incremented rate limit on unexpected errors —
        // the user didn't fail authentication, the infrastructure did.
        // Use decrement instead of delete so concurrent rollbacks don't lose counts (C1-07).
        try {
            await rollbackLoginRateLimit(ip);
        } catch (rollbackErr) {
            console.debug('Failed to roll back login rate limit after unexpected error:', rollbackErr);
        }
        try {
            await decrementRateLimit(accountRateLimitKey, 'login_account', LOGIN_WINDOW_MS);
        } catch (rollbackErr) {
            console.debug('Failed to roll back account-scoped login rate limit after unexpected error:', rollbackErr);
        }
        return { error: t('authFailed') };
    }
}

export async function logout(formData?: FormData) {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    const rawLocale = formData?.get('locale')?.toString() ?? '';
    const locale = isSupportedLocale(rawLocale) ? rawLocale : 'en';

    if (token) {
        const session = await verifySessionToken(token);
        if (session) {
            logAuditEvent(session.userId, 'logout', 'user', String(session.userId)).catch(console.debug);
        }
        await db.delete(sessions).where(eq(sessions.id, hashSessionToken(token))).catch(() => {});
    }

    cookieStore.delete({ name: COOKIE_NAME, path: '/' });
    redirect(localizePath(locale, '/admin'));
}

export async function updatePassword(prevState: { error?: string; success?: boolean; message?: string } | null, formData: FormData) {
    const t = await getTranslations('serverActions');
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        return { error: t('unauthorized') };
    }
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) {
        return { error: maintenanceError };
    }

    // Rate limit password change attempts (separate map from login)
    const requestHeaders = await headers();
    if (!hasTrustedSameOrigin(requestHeaders)) {
        return { error: t('unauthorized') };
    }
    const ip = getClientIp(requestHeaders);
    const now = Date.now();
    prunePasswordChangeRateLimit(now);
    const limitData = getPasswordChangeRateLimitEntry(ip, now);
    if (limitData.count >= PASSWORD_CHANGE_MAX_ATTEMPTS) {
        return { error: t('tooManyAttempts') };
    }
    try {
        const dbLimit = await checkRateLimit(ip, 'password_change', PASSWORD_CHANGE_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
        if (dbLimit.limited) {
            return { error: t('tooManyAttempts') };
        }
    } catch {
        // DB unavailable — rely on in-memory Map
    }

    // ── Increment rate limit BEFORE the expensive Argon2 verify (TOCTOU fix) ──
    // Without this, concurrent requests all pass the check before any of them
    // record the failed attempt, allowing burst brute-force attacks.
    // (Same pattern as login fix — commit 1036d7b)
    try {
        limitData.count += 1;
        limitData.lastAttempt = now;
        passwordChangeRateLimit.set(ip, limitData);
        await incrementRateLimit(ip, 'password_change', LOGIN_WINDOW_MS);
    } catch (err) {
        console.debug('Failed to pre-increment password change rate limit:', err);
    }

    // Sanitize before validation so length checks operate on the same value
    // that will be hashed (matches createAdminUser pattern, see C8-01).
    const currentPassword = stripControlChars(formData.get('currentPassword')?.toString() ?? '') ?? '';
    const newPassword = stripControlChars(formData.get('newPassword')?.toString() ?? '') ?? '';
    const confirmPassword = stripControlChars(formData.get('confirmPassword')?.toString() ?? '') ?? '';

    if (!currentPassword || !newPassword || !confirmPassword) {
        return { error: t('allFieldsRequired') };
    }

    if (newPassword !== confirmPassword) {
        return { error: t('passwordsDoNotMatch') };
    }

    if (newPassword.length < 12) {
        return { error: t('passwordTooShort') };
    }

    if (newPassword.length > 1024) {
        return { error: t('passwordTooLong') };
    }

    try {
        // getCurrentUser doesn't return hash — fetch separately
        const userWithHash = await getAdminUserWithHash(currentUser.id);
        if (!userWithHash) {
            return { error: t('unauthorized') };
        }

        const match = await argon2.verify(userWithHash.password_hash, currentPassword);

        if (!match) {
            // Rate limit already incremented above — no need to record again.
            return { error: t('incorrectPassword') };
        }

        const newHash = await argon2.hash(newPassword, { type: argon2.argon2id });

        // Invalidate all sessions except the current one — fetch before the
        // transaction so getSession() doesn't execute inside the tx boundary.
        const currentSession = await getSession();

        // Wrap password update + session invalidation in a transaction so that
        // if session deletion fails, the password change is also rolled back.
        // This prevents old sessions from surviving a password change on DB error.
        await db.transaction(async (tx) => {
            await tx.update(adminUsers)
                .set({ password_hash: newHash })
                .where(eq(adminUsers.id, currentUser.id));

            if (currentSession) {
                await tx.delete(sessions).where(and(
                    eq(sessions.userId, currentUser.id),
                    sql`${sessions.id} != ${currentSession.id}`
                ));
            } else {
                await tx.delete(sessions).where(eq(sessions.userId, currentUser.id));
            }
        });

        // Only clear the rate-limit bucket AFTER the password/session
        // transaction has committed successfully (C1R-02). If we cleared
        // before the transaction and the transaction then failed, prior
        // accumulated failed-attempt pressure in the same window would be
        // irrecoverably lost — the catch-branch rollback only decrements
        // once.
        try {
            await clearSuccessfulPasswordAttempts(ip);
        } catch (err) {
            console.error('Failed to reset password change rate limit for IP:', ip, err);
        }

        logAuditEvent(currentUser.id, 'password_change', 'user', String(currentUser.id)).catch(console.debug);

        return { success: true, message: t('passwordUpdated') };

    } catch (e) {
        // C2R-01: rethrow Next.js internal control-flow signals (NEXT_REDIRECT,
        // NEXT_NOT_FOUND, dynamic-rendering bailouts) before the generic-failure
        // fallback, matching the login path above. Without this, a future
        // refactor that places redirect/notFound/revalidatePath inside the
        // transaction (or inside getCurrentUser/logAuditEvent) would silently
        // swallow the signal and the user would see a toast instead of the
        // intended redirect.
        unstable_rethrow(e);
        console.error("Failed to update password:", e instanceof Error ? e.message : 'Unknown error');
        // Roll back pre-incremented rate limit on unexpected errors —
        // the user didn't fail authentication, the infrastructure did.
        // Use decrement instead of delete so concurrent rollbacks don't lose counts (C1-07).
        try {
            await rollbackPasswordChangeRateLimit(ip);
        } catch (rollbackErr) {
            console.debug('Failed to roll back password change rate limit after unexpected error:', rollbackErr);
        }
        return { error: t('failedToUpdatePassword') };
    }
}
