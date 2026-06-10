'use server';

import { getCurrentUser } from '@/app/actions/auth';
import { requireSameOriginAdmin } from '@/lib/action-guards';
import {
    createToken,
    revokeToken,
    listTokensForUser,
    normalizeScopes,
    type AdminTokenScope,
    type AdminTokenRecord,
} from '@/lib/admin-tokens';
import { logAuditEvent } from '@/lib/audit';
import { getClientIp } from '@/lib/rate-limit';
import { sanitizeAdminString } from '@/lib/sanitize';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';

export type LrTokenListItem = Omit<AdminTokenRecord, 'tokenHash'>;

/** @action-origin-exempt: token-create is a mutating action protected by requireSameOriginAdmin below */
export async function createLrToken(opts: {
    label: string;
    scopes: string[];
    expiresAt?: string | null;
}): Promise<{ plaintext: string; id: number } | { error: string }> {
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };

    const t = await getTranslations('serverActions');
    const user = await getCurrentUser();
    if (!user) return { error: t('unauthorized') };

    const scopes = normalizeScopes(opts.scopes);
    if (scopes.length === 0) return { error: 'At least one scope is required' };

    // R4C1 SEC-R4C1-01: the token label is an admin-controlled persistent
    // string rendered back in the tokens list (and its revoke aria-label) and
    // stored in audit metadata. Per the repo-wide admin-string policy
    // (C7R-RPL-11 → C3L-SEC-01 → … → C6L-SEC-01), reject C0/C1 controls and
    // Unicode bidi / zero-width formatting characters instead of persisting
    // a spoofable label on a credential-management surface.
    const { value: label, rejected: labelRejected } = sanitizeAdminString(opts.label);
    if (labelRejected || !label) {
        return { error: 'Invalid token label' };
    }

    // R4C1 SEC-R4C1-01: validate the expiry. `new Date('garbage')` yields an
    // Invalid Date whose getTime() is NaN; verifyToken's `expires_at.getTime()
    // <= Date.now()` comparison is then always false — a malformed expiry
    // would mint a never-expiring token. Past dates are equally a mistake.
    let expiresAt: Date | null = null;
    if (opts.expiresAt) {
        const parsed = new Date(opts.expiresAt);
        if (!Number.isFinite(parsed.getTime())) {
            return { error: 'Invalid expiry date' };
        }
        if (parsed.getTime() <= Date.now()) {
            return { error: 'Expiry date must be in the future' };
        }
        expiresAt = parsed;
    }

    try {
        const result = await createToken({
            userId: user.id,
            label,
            scopes: scopes as AdminTokenScope[],
            expiresAt,
        });
        const ip = getClientIp(await headers());
        await logAuditEvent(user.id, 'lr_token_created', 'admin_token', String(result.id), ip, {
            label,
            scopes,
        }).catch(console.debug);
        return result;
    } catch (err: unknown) {
        // R4C1 SEC-R4C1-01: never relay raw driver/DB error text to the
        // client; log server-side and return a generic message.
        console.error('createLrToken failed:', err);
        return { error: 'Failed to create token' };
    }
}

export async function revokeLrToken(tokenId: number): Promise<{ success: boolean } | { error: string }> {
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };

    const t = await getTranslations('serverActions');
    const user = await getCurrentUser();
    if (!user) return { error: t('unauthorized') };

    const deleted = await revokeToken({ userId: user.id, tokenId });
    if (!deleted) return { error: 'Token not found or already revoked' };

    const ip = getClientIp(await headers());
    await logAuditEvent(user.id, 'lr_token_revoked', 'admin_token', String(tokenId), ip).catch(console.debug);

    return { success: true };
}

/** @action-origin-exempt: read-only list action; no mutation, no side effects */
export async function listLrTokens(): Promise<LrTokenListItem[] | { error: string }> {
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };

    const t = await getTranslations('serverActions');
    const user = await getCurrentUser();
    if (!user) return { error: t('unauthorized') };

    return listTokensForUser(user.id);
}
