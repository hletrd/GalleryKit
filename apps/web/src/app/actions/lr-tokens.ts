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

    const expiresAt = opts.expiresAt ? new Date(opts.expiresAt) : null;

    try {
        const result = await createToken({
            userId: user.id,
            label: opts.label,
            scopes: scopes as AdminTokenScope[],
            expiresAt,
        });
        const ip = getClientIp(await headers());
        await logAuditEvent(user.id, 'lr_token_created', 'admin_token', String(result.id), ip, {
            label: opts.label,
            scopes,
        }).catch(console.debug);
        return result;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to create token';
        return { error: msg };
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
