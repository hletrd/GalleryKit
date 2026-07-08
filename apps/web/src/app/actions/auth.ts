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
import { getClientIp, pruneLoginRateLimit, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS, checkRateLimit, incrementRateLimit, loginRateLimit, buildAccountRateLimitKey, isRateLimitExceeded, getRateLimitBucketStart } from '@/lib/rate-limit';
import { clearSuccessfulLoginAttempts, getLoginRateLimitEntry, getAccountLoginRateLimitEntry, clearSuccessfulAccountLoginAttempts, accountLoginRateLimit, rollbackLoginRateLimit, rollbackAccountLoginRateLimit, pruneAccountLoginRateLimit, clearSuccessfulPasswordAttempts, getPasswordChangeRateLimitEntry, passwordChangeRateLimit, prunePasswordChangeRateLimit, PASSWORD_CHANGE_MAX_ATTEMPTS, rollbackPasswordChangeRateLimit } from '@/lib/auth-rate-limit';
import { logAuditEvent } from '@/lib/audit';
import { isSupportedLocale, localizePath } from '@/lib/locale-path';
import { getRestoreMaintenanceMessage } from '@/lib/restore-maintenance';
import { acquireAdminMutationSlot } from '@/lib/admin-mutation-barrier';
import { enqueuePendingSessionRevocation } from '@/lib/pending-session-revocations';
import { getTrustedRequestProtocol, hasTrustedSameOrigin } from '@/lib/request-origin';
import { countCodePoints } from '@/lib/utils';
import { PASSWORD_HASH_OPTIONS } from '@/lib/password-hashing';

function getAuthErrorLogDetail(err: unknown) {
    return { errorName: err instanceof Error ? err.name : typeof err };
}

/** @action-origin-exempt: read-only session lookup used by auth guard callers */
export async function getSession() {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;

    if (!token) return null;

    const session = await verifySessionToken(token);
    return session;
}

/** @action-origin-exempt: read-only cached current-user lookup used by auth guard callers */
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

/** @action-origin-exempt: read-only admin status lookup used by page/layout guards */
export async function isAdmin() {
    return !!(await getCurrentUser());
}

/**
 * Precomputed Argon2id hash used to equalize login timing between "user does
 * not exist" and "user exists, wrong password" branches. Computed once at
 * module initialization so concurrent logins after restart cannot race the
 * lazy initialization (AGG-M2 / TRC-M7). The parameters match whatever we
 * use in argon2.hash().
 */
const dummyHashPromise: Promise<string> = argon2.hash(randomBytes(32).toString('hex'), PASSWORD_HASH_OPTIONS);
async function getDummyHash(): Promise<string> {
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

    using mutationSlot = acquireAdminMutationSlot();
    if (!mutationSlot.acquired) {
        return { error: t('restoreInProgress') };
    }

    const ip = getClientIp(requestHeaders);
    const now = Date.now();
    const loginBucketStart = getRateLimitBucketStart(now, LOGIN_WINDOW_MS);

    pruneLoginRateLimit(now);
    pruneAccountLoginRateLimit(now);

    const limitData = getLoginRateLimitEntry(ip, now);

    // Fast-path check from in-memory Map
    if (limitData.count >= LOGIN_MAX_ATTEMPTS) {
        return { error: t('tooManyAttempts') };
    }

    // ── Account-scoped rate limit: throttle per-username, not just per-IP ──
    // This prevents distributed brute-force attacks where each IP gets a fresh
    // budget but all target the same account. The bucket key is prefixed with
    // "acct:" to avoid collisions with IP-based buckets.
    const accountRateLimitKey = buildAccountRateLimitKey(username);
    const accountLimitData = getAccountLoginRateLimitEntry(accountRateLimitKey, now);

    // Fast-path check from in-memory account Map
    if (accountLimitData.count >= LOGIN_MAX_ATTEMPTS) {
        return { error: t('tooManyAttempts') };
    }

    // ── Increment rate limit BEFORE the expensive Argon2 verify (TOCTOU fix) ──
    // Without this, concurrent requests all pass the check before any of them
    // record the failed attempt, allowing burst brute-force attacks.
    try {
        limitData.count += 1;
        limitData.lastAttempt = now;
        loginRateLimit.set(ip, limitData);
        await incrementRateLimit(ip, 'login', LOGIN_WINDOW_MS, loginBucketStart);
        // Also increment account-scoped bucket (both in-memory and DB)
        accountLimitData.count += 1;
        accountLimitData.lastAttempt = now;
        accountLoginRateLimit.set(accountRateLimitKey, accountLimitData);
        await incrementRateLimit(accountRateLimitKey, 'login_account', LOGIN_WINDOW_MS, loginBucketStart);
    } catch (err) {
        console.debug('Failed to pre-increment login rate limit:', err);
    }

    // DB-backed check for accuracy across restarts. The DB counter already
    // includes this request, so use strict `>` semantics and roll back if this
    // request is rejected before authentication work is performed.
    try {
        const dbLimit = await checkRateLimit(ip, 'login', LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS, loginBucketStart);
        const accountLimit = await checkRateLimit(accountRateLimitKey, 'login_account', LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS, loginBucketStart);
        if (
            isRateLimitExceeded(dbLimit.count, LOGIN_MAX_ATTEMPTS, true)
            || isRateLimitExceeded(accountLimit.count, LOGIN_MAX_ATTEMPTS, true)
        ) {
            await Promise.allSettled([
                rollbackLoginRateLimit(ip, loginBucketStart),
                rollbackAccountLoginRateLimit(accountRateLimitKey, loginBucketStart),
            ]);
            return { error: t('tooManyAttempts') };
        }
    } catch {
        // DB unavailable — rely on in-memory Maps (both IP and account)
        if (limitData.count > LOGIN_MAX_ATTEMPTS || accountLimitData.count > LOGIN_MAX_ATTEMPTS) {
            rollbackLoginRateLimit(ip, loginBucketStart).catch((err) => console.debug('Login rollback failed:', err));
            rollbackAccountLoginRateLimit(accountRateLimitKey, loginBucketStart).catch((err) => console.debug('Account login rollback failed:', err));
            return { error: t('tooManyAttempts') };
        }
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
            await clearSuccessfulLoginAttempts(ip, loginBucketStart);
        } catch (err) {
            console.error('Failed to reset login rate limit for IP:', ip, err);
        }
        try {
            await clearSuccessfulAccountLoginAttempts(accountRateLimitKey, loginBucketStart);
        } catch (err) {
            // R15C15 CR-15: same operational significance as the IP-scoped reset
            // above (a stale entry could block a subsequent legitimate login in
            // the same window) — surface it to log shippers, not console.debug.
            console.error('Failed to reset account-scoped login rate limit:', err);
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

            // Require Secure when behind TLS or in production. Reuse the
            // same trusted-proxy protocol normalization as origin checks so
            // multi-hop X-Forwarded-Proto chains cannot disagree with the
            // CSRF/origin boundary.
            const requestIsHttps = getTrustedRequestProtocol(requestHeaders) === 'https';
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
            console.error("Session creation failed after successful auth", getAuthErrorLogDetail(e));
            return { error: t('authFailed') };
        }
    } catch (e) {
        unstable_rethrow(e);
        console.error("Login verification failed:", getAuthErrorLogDetail(e));
        // C1F-CR-04 / C1F-SR-01: do NOT roll back the pre-incremented rate-limit
        // counters on unexpected infrastructure errors. Rolling back reduces the
        // failed-attempt budget, giving an attacker extra attempts when they can
        // trigger infrastructure errors (e.g. by overloading the DB). The user can
        // simply retry — the 15-minute window is generous. The attempt counts as
        // a legitimate consumption of the rate-limit budget regardless of whether
        // the failure was caused by wrong credentials or by infrastructure.
        return { error: t('authFailed') };
    }
}

export async function logout(formData?: FormData) {
    const requestHeaders = await headers();
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    const rawLocale = formData?.get('locale')?.toString() ?? '';
    const locale = isSupportedLocale(rawLocale) ? rawLocale : 'en';

    if (!hasTrustedSameOrigin(requestHeaders)) {
        redirect(localizePath(locale, '/admin'));
    }

    using mutationSlot = acquireAdminMutationSlot();
    if (!mutationSlot.acquired) {
        if (token) {
            // C7-01 (run-10 cycle 7b): a restore window blocked the DB-side
            // revocation. Queue it so the post-restore flush (which runs
            // AFTER the import replaces the sessions table — a pre-import
            // delete would be undone anyway) or the hourly maintenance sweep
            // actually kills the server-side session instead of silently
            // leaving the token verifiable for its remaining lifetime.
            enqueuePendingSessionRevocation(hashSessionToken(token));
        }
        cookieStore.delete({ name: COOKIE_NAME, path: '/' });
        return redirect(localizePath(locale, '/admin'));
    }

    if (token) {
        const maintenanceError = getRestoreMaintenanceMessage('restore in progress');
        let revoked = false;
        if (!maintenanceError) {
            const session = await verifySessionToken(token);
            if (session) {
                logAuditEvent(session.userId, 'logout', 'user', String(session.userId)).catch(console.debug);
            }
            try {
                await db.delete(sessions).where(eq(sessions.id, hashSessionToken(token)));
                revoked = true;
            } catch (err) {
                console.debug('Failed to delete session during logout; queuing revocation:', err);
            }
        }
        if (!revoked) {
            // C7-01 (run-10 cycle 7b): a restore window blocked the DB-side
            // revocation. Queue it so the post-restore flush (which runs
            // AFTER the import replaces the sessions table — a pre-import
            // delete would be undone anyway) or the hourly maintenance sweep
            // actually kills the server-side session instead of silently
            // leaving the token verifiable for its remaining lifetime.
            enqueuePendingSessionRevocation(hashSessionToken(token));
        }
    }

    cookieStore.delete({ name: COOKIE_NAME, path: '/' });
    redirect(localizePath(locale, '/admin'));
}

export async function updatePassword(prevState: { error?: string; success?: boolean; message?: string } | null, formData: FormData) {
    const t = await getTranslations('serverActions');
    // Match the non-auth mutating action contract: reject hostile origins
    // before any session/user read.
    const requestHeaders = await headers();
    if (!hasTrustedSameOrigin(requestHeaders)) {
        return { error: t('unauthorized') };
    }

    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) {
        return { error: maintenanceError };
    }

    const currentUser = await getCurrentUser();
    if (!currentUser) {
        return { error: t('unauthorized') };
    }

    using mutationSlot = acquireAdminMutationSlot();
    if (!mutationSlot.acquired) {
        return { error: t('restoreInProgress') };
    }

    // C9R-RPL-01 / AGG9R-RPL-01: validate form-field shape BEFORE the
    // rate-limit pre-increment. Matches the `login` ordering above —
    // legitimate admin typos (empty field / mismatch / length bounds)
    // must not consume a password_change attempt, since no Argon2
    // verify will ever run for them. Without this ordering, ten
    // typo'd confirm-password submissions lock the admin out for
    // 15 minutes purely from client-side mistakes.
    //
    // Sanitize before validation so length checks operate on the same
    // value that will be hashed (matches createAdminUser pattern, see C8-01).
    const currentPassword = stripControlChars(formData.get('currentPassword')?.toString() ?? '') ?? '';
    const newPassword = stripControlChars(formData.get('newPassword')?.toString() ?? '') ?? '';
    const confirmPassword = stripControlChars(formData.get('confirmPassword')?.toString() ?? '') ?? '';

    if (!currentPassword || !newPassword || !confirmPassword) {
        return { error: t('allFieldsRequired') };
    }

    if (newPassword !== confirmPassword) {
        return { error: t('passwordsDoNotMatch') };
    }

    // C20-AGG-01: use countCodePoints for password length validation so
    // supplementary characters (emoji, rare CJK) count as one character
    // each, matching the countCodePoints pattern used for title, description,
    // label, and SEO fields. JS `.length` counts UTF-16 code units (2 per
    // surrogate pair), so a 6-emoji password would pass the 12-char minimum
    // despite having only 6 actual characters (reduced effective entropy).
    if (countCodePoints(newPassword) < 12) {
        return { error: t('passwordTooShort') };
    }

    if (countCodePoints(newPassword) > 1024) {
        return { error: t('passwordTooLong') };
    }

    const ip = getClientIp(requestHeaders);
    const now = Date.now();
    const passwordBucketStart = getRateLimitBucketStart(now, LOGIN_WINDOW_MS);
    prunePasswordChangeRateLimit(now);
    const limitData = getPasswordChangeRateLimitEntry(ip, now);
    if (limitData.count >= PASSWORD_CHANGE_MAX_ATTEMPTS) {
        return { error: t('tooManyAttempts') };
    }
    // ── Increment rate limit BEFORE the expensive Argon2 verify (TOCTOU fix) ──
    // Without this, concurrent requests all pass the check before any of them
    // record the failed attempt, allowing burst brute-force attacks.
    // (Same pattern as login fix — commit 1036d7b)
    try {
        limitData.count += 1;
        limitData.lastAttempt = now;
        passwordChangeRateLimit.set(ip, limitData);
        await incrementRateLimit(ip, 'password_change', LOGIN_WINDOW_MS, passwordBucketStart);
    } catch (err) {
        console.debug('Failed to pre-increment password change rate limit:', err);
    }

    try {
        const dbLimit = await checkRateLimit(ip, 'password_change', PASSWORD_CHANGE_MAX_ATTEMPTS, LOGIN_WINDOW_MS, passwordBucketStart);
        if (isRateLimitExceeded(dbLimit.count, PASSWORD_CHANGE_MAX_ATTEMPTS, true)) {
            await rollbackPasswordChangeRateLimit(ip, passwordBucketStart);
            return { error: t('tooManyAttempts') };
        }
    } catch {
        // DB unavailable — rely on in-memory Map
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

        const newHash = await argon2.hash(newPassword, PASSWORD_HASH_OPTIONS);
        const newSessionToken = await generateSessionToken();
        const newSessionId = hashSessionToken(newSessionToken);
        const newSessionExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        // Rotate every session on password change, including the currently
        // presented cookie, then insert one fresh session for this browser.
        // Preserving the active session lets a stolen cookie survive credential
        // rotation; doing the delete+insert inside one transaction avoids
        // stranding the user if session creation fails.
        await db.transaction(async (tx) => {
            await tx.update(adminUsers)
                .set({ password_hash: newHash })
                .where(eq(adminUsers.id, currentUser.id));

            await tx.delete(sessions).where(eq(sessions.userId, currentUser.id));
            await tx.insert(sessions).values({
                id: newSessionId,
                userId: currentUser.id,
                expiresAt: newSessionExpiresAt,
            });
        });

        const cookieStore = await cookies();
        cookieStore.set(COOKIE_NAME, newSessionToken, {
            httpOnly: true,
            secure: getTrustedRequestProtocol(requestHeaders) === 'https' || process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 24 * 60 * 60,
            path: '/',
        });

        // Only clear the rate-limit bucket AFTER the password/session
        // transaction has committed successfully (C1R-02). If we cleared
        // before the transaction and the transaction then failed, prior
        // accumulated failed-attempt pressure in the same window would be
        // irrecoverably lost — the catch-branch rollback only decrements
        // once.
        try {
            await clearSuccessfulPasswordAttempts(ip, passwordBucketStart);
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
        console.error("Failed to update password:", getAuthErrorLogDetail(e));
        // C1F-CR-04 / C1F-SR-01: do NOT roll back the pre-incremented rate-limit
        // counter on unexpected infrastructure errors, matching the login path above.
        // Rolling back reduces the failed-attempt budget. The attempt counts as
        // legitimate consumption of the rate-limit budget regardless of the cause.
        return { error: t('failedToUpdatePassword') };
    }
}
