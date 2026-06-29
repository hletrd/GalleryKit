/**
 * Run-4 cycle 1 (SEC-R4C1-01): behavioral lock for createLrToken input
 * hygiene.
 *  - Token labels are admin-controlled persistent strings rendered back in
 *    the tokens list / revoke aria-label and stored in audit metadata, so
 *    they MUST go through sanitizeAdminString (repo admin-string policy,
 *    C7R-RPL-11 → C3L-SEC-01 → … → C6L-SEC-01 lineage).
 *  - expiresAt must reject Invalid Dates: `new Date('garbage').getTime()` is
 *    NaN and verifyToken's `expires_at.getTime() <= Date.now()` is then
 *    always false — a malformed expiry would mint a never-expiring token.
 *  - DB errors must not leak raw driver text to the client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createTokenMock, revokeTokenMock, requireSameOriginAdminMock, isAdminMock, getRestoreMaintenanceMessageMock } = vi.hoisted(() => ({
    createTokenMock: vi.fn(async () => ({ plaintext: 'gk_test', id: 7 })),
    revokeTokenMock: vi.fn(async () => true),
    requireSameOriginAdminMock: vi.fn(async () => null),
    isAdminMock: vi.fn(async () => true),
    getRestoreMaintenanceMessageMock: vi.fn(() => null),
}));

vi.mock('@/app/actions/auth', () => ({
    isAdmin: isAdminMock,
    getCurrentUser: vi.fn(async () => ({ id: 1, username: 'admin' })),
}));

vi.mock('@/lib/action-guards', () => ({
    requireSameOriginAdmin: requireSameOriginAdminMock,
}));

vi.mock('@/lib/admin-tokens', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
        ...actual,
        createToken: createTokenMock,
        revokeToken: revokeTokenMock,
        listTokensForUser: vi.fn(async () => []),
    };
});

vi.mock('@/lib/audit', () => ({
    logAuditEvent: vi.fn(async () => undefined),
}));

vi.mock('@/lib/rate-limit', () => ({
    getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('next/headers', () => ({
    headers: vi.fn(async () => new Headers()),
}));

vi.mock('next-intl/server', () => ({
    getTranslations: vi.fn(async () => (key: string) => key),
}));

vi.mock('@/lib/restore-maintenance', () => ({
    getRestoreMaintenanceMessage: getRestoreMaintenanceMessageMock,
}));

import { createLrToken, revokeLrToken } from '@/app/actions/lr-tokens';

// R4C4 I18N-R4C4-05: the action's error strings are localized via
// getTranslations('serverActions'); this suite's next-intl mock returns the
// KEY, so assertions are key-equality (the EN/KO texts live in messages/).
describe('createLrToken input hygiene (SEC-R4C1-01)', () => {
    beforeEach(() => {
        createTokenMock.mockClear();
        createTokenMock.mockResolvedValue({ plaintext: 'gk_test', id: 7 });
        revokeTokenMock.mockClear();
        revokeTokenMock.mockResolvedValue(true);
        requireSameOriginAdminMock.mockClear();
        requireSameOriginAdminMock.mockResolvedValue(null);
        isAdminMock.mockClear();
        isAdminMock.mockResolvedValue(true);
        getRestoreMaintenanceMessageMock.mockClear();
        getRestoreMaintenanceMessageMock.mockReturnValue(null);
    });

    it('short-circuits token create and revoke during restore maintenance', async () => {
        getRestoreMaintenanceMessageMock.mockReturnValue('restoreInProgress');

        await expect(createLrToken({ label: 'Lightroom on my Mac', scopes: ['lr:upload'] }))
            .resolves.toEqual({ error: 'restoreInProgress' });
        await expect(revokeLrToken(7)).resolves.toEqual({ error: 'restoreInProgress' });

        expect(requireSameOriginAdminMock).not.toHaveBeenCalled();
        expect(isAdminMock).not.toHaveBeenCalled();
        expect(createTokenMock).not.toHaveBeenCalled();
        expect(revokeTokenMock).not.toHaveBeenCalled();
    });

    it('creates a token for a clean label', async () => {
        const result = await createLrToken({ label: 'Lightroom on my Mac', scopes: ['lr:upload'] });
        expect(result).toEqual({ plaintext: 'gk_test', id: 7 });
        expect(createTokenMock).toHaveBeenCalledWith(
            expect.objectContaining({ label: 'Lightroom on my Mac', userId: 1 }),
        );
    });

    it('rejects labels containing bidi override characters', async () => {
        const result = await createLrToken({ label: 'demo\u202Etoken', scopes: ['lr:upload'] });
        expect(result).toEqual({ error: 'lrTokenInvalidLabel' });
        expect(createTokenMock).not.toHaveBeenCalled();
    });

    it('rejects labels containing zero-width characters', async () => {
        const result = await createLrToken({ label: 'demo\u200Btoken', scopes: ['lr:upload'] });
        expect(result).toEqual({ error: 'lrTokenInvalidLabel' });
        expect(createTokenMock).not.toHaveBeenCalled();
    });

    it('rejects labels containing C0 control characters', async () => {
        const result = await createLrToken({ label: 'demo\u0007token', scopes: ['lr:upload'] });
        expect(result).toEqual({ error: 'lrTokenInvalidLabel' });
        expect(createTokenMock).not.toHaveBeenCalled();
    });

    it('rejects empty / whitespace-only labels', async () => {
        const result = await createLrToken({ label: '   ', scopes: ['lr:upload'] });
        expect(result).toEqual({ error: 'lrTokenInvalidLabel' });
        expect(createTokenMock).not.toHaveBeenCalled();
    });

    // R4C2 COR-R4C2-04: code-point length validation — no silent UTF-16
    // truncation (which could bisect a surrogate pair into U+FFFD) on the
    // credential-management surface.
    it('rejects labels longer than 128 code points', async () => {
        const result = await createLrToken({ label: '📷'.repeat(129), scopes: ['lr:upload'] });
        expect(result).toEqual({ error: 'lrTokenInvalidLabel' });
        expect(createTokenMock).not.toHaveBeenCalled();
    });

    it('accepts a 128-code-point label and passes it through unsliced', async () => {
        const label = '📷'.repeat(128); // 256 UTF-16 units, 128 code points
        const result = await createLrToken({ label, scopes: ['lr:upload'] });
        expect(result).toEqual({ plaintext: 'gk_test', id: 7 });
        expect(createTokenMock).toHaveBeenCalledWith(
            expect.objectContaining({ label }),
        );
    });

    it('rejects an unparseable expiry date instead of minting a never-expiring token', async () => {
        const result = await createLrToken({
            label: 'expiring',
            scopes: ['lr:upload'],
            expiresAt: 'not-a-date',
        });
        expect(result).toEqual({ error: 'lrTokenInvalidExpiry' });
        expect(createTokenMock).not.toHaveBeenCalled();
    });

    it('rejects a past expiry date', async () => {
        const result = await createLrToken({
            label: 'expired',
            scopes: ['lr:upload'],
            expiresAt: '2001-01-01T00:00:00.000Z',
        });
        expect(result).toEqual({ error: 'lrTokenExpiryInPast' });
        expect(createTokenMock).not.toHaveBeenCalled();
    });

    it('accepts a valid future expiry date', async () => {
        const future = new Date(Date.now() + 86_400_000).toISOString();
        const result = await createLrToken({
            label: 'expiring',
            scopes: ['lr:upload'],
            expiresAt: future,
        });
        expect(result).toEqual({ plaintext: 'gk_test', id: 7 });
        expect(createTokenMock).toHaveBeenCalledWith(
            expect.objectContaining({ expiresAt: expect.any(Date) }),
        );
    });

    it('returns a generic message (not raw driver text) when token persistence fails', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        createTokenMock.mockRejectedValueOnce(
            new Error("ER_ACCESS_DENIED: Access denied for user 'gallery'@'10.0.0.1'"),
        );
        const result = await createLrToken({ label: 'ok label', scopes: ['lr:upload'] });
        expect(result).toEqual({ error: 'lrTokenCreateFailed' });
        consoleSpy.mockRestore();
    });
});
